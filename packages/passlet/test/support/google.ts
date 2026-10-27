import {
	createPublicKey,
	generateKeyPairSync,
	type KeyObject,
	verify,
} from "node:crypto";
import { vi } from "vitest";
import type { GoogleCredentials } from "../../src/config";
import type { GoogleVertical } from "../../src/google/utils";
import { assertWalletRequest } from "./google-schema";

export const ISSUER_ID = "3388000000022801234";
export const CLIENT_EMAIL = "test@test-project.iam.gserviceaccount.com";
export const LOGO_URL = "https://example.com/logo.png";

const WALLET_BASE = "https://walletobjects.googleapis.com/walletobjects/v1";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

let privateKey: string | undefined;

function testKey(): string {
	privateKey ??= generateKeyPairSync("rsa", {
		modulusLength: 2048,
		privateKeyEncoding: { type: "pkcs8", format: "pem" },
		publicKeyEncoding: { type: "spki", format: "pem" },
	}).privateKey;
	return privateKey;
}

/**
 * Service-account style credentials backed by an RSA-2048 PKCS#8 key,
 * generated once per test file.
 */
export function googleCredentials(
	overrides?: Partial<GoogleCredentials>
): GoogleCredentials {
	return {
		issuerId: ISSUER_ID,
		clientEmail: CLIENT_EMAIL,
		privateKey: testKey(),
		...overrides,
	};
}

/** The public half of {@link googleCredentials}' key, for verifying JWTs. */
export function googlePublicKey(): KeyObject {
	return createPublicKey(testKey());
}

export interface WalletRequest {
	body: Record<string, unknown> | undefined;
	/**
	 * How many Wallet round trips deep the request was sent: one more than
	 * the deepest response delivered before it.
	 */
	depth: number;
	/** Request headers with lower-cased names. */
	headers: Record<string, string>;
	method: string;
	/** Path relative to the Wallet API base, e.g. `/loyaltyClass/123.abc`. */
	path: string;
}

export type WalletResponder = (request: WalletRequest) => Response | undefined;

export interface GoogleFetchStub {
	/** Claims of each OAuth assertion, verified against the test key. */
	assertions: Record<string, unknown>[];
	/** Body of the first Wallet request matching `method` and `path` substring. */
	body(method: string, path: string): Record<string, unknown>;
	/** Most Wallet requests awaiting a response at the same time. */
	maxInFlight: number;
	/** Wallet API requests in call order. OAuth token requests are not recorded. */
	requests: WalletRequest[];
	/** OAuth token requests made so far. */
	tokenRequests: number;
}

export interface StubGoogleFetchOptions {
	/**
	 * Overrides the OAuth token response; the default is 200 with a fake token
	 * that, like Google's, expires in an hour.
	 */
	token?: () => Response;
}

// Google's token endpoint rejects an assertion it cannot verify.
// https://developers.google.com/identity/protocols/oauth2/service-account#httprest
function tokenResponse(
	stub: GoogleFetchStub,
	init: RequestInit | undefined,
	token: (() => Response) | undefined
): Response {
	const form = new URLSearchParams(String(init?.body));
	try {
		if (
			form.get("grant_type") !== "urn:ietf:params:oauth:grant-type:jwt-bearer"
		) {
			throw new Error("unexpected grant_type");
		}
		stub.assertions.push(
			verifyJwt(form.get("assertion") ?? "", googlePublicKey()).claims
		);
	} catch {
		return Response.json({ error: "invalid_grant" }, { status: 400 });
	}
	return (
		token?.() ?? Response.json({ access_token: "test-token", expires_in: 3599 })
	);
}

/**
 * Replaces global `fetch` with a Google Wallet API stand-in.
 *
 * Defaults: the OAuth token endpoint verifies the assertion and returns a
 * fake token; `GET` requests return 404 so class creation takes the `POST`
 * path; everything else returns 200 `{}`. `respond` gets first chance at
 * every Wallet request and may return `undefined` to fall through to the
 * defaults. Every Wallet body is checked against Google's discovery document,
 * and a body Google would not accept fails the request. Responses arrive on a
 * later macrotask, so requests sent together are observed in flight together.
 */
export function stubGoogleFetch(
	respond?: WalletResponder,
	{ token }: StubGoogleFetchOptions = {}
): GoogleFetchStub {
	const stub: GoogleFetchStub = {
		assertions: [],
		requests: [],
		tokenRequests: 0,
		maxInFlight: 0,
		body(method, path) {
			const match = stub.requests.find(
				(r) => r.method === method && r.path.includes(path)
			);
			if (!match?.body) {
				throw new Error(`no ${method} body recorded for ${path}`);
			}
			return match.body;
		},
	};
	let inFlight = 0;
	let deliveredDepth = 0;

	vi.stubGlobal(
		"fetch",
		vi.fn((input: string | URL | Request, init?: RequestInit) => {
			const url = String(input);
			if (url.startsWith(TOKEN_URL)) {
				stub.tokenRequests += 1;
				return Promise.resolve(tokenResponse(stub, init, token));
			}
			if (!url.startsWith(WALLET_BASE)) {
				return Promise.reject(new Error(`unexpected fetch: ${url}`));
			}
			const request: WalletRequest = {
				method: init?.method ?? "GET",
				path: url.slice(WALLET_BASE.length),
				headers: Object.fromEntries(new Headers(init?.headers)),
				body: init?.body ? JSON.parse(String(init.body)) : undefined,
				depth: deliveredDepth + 1,
			};
			stub.requests.push(request);
			assertWalletRequest(request.method, request.path, request.body);
			const response =
				respond?.(request) ??
				(request.method === "GET"
					? new Response("", { status: 404 })
					: Response.json({}));
			inFlight += 1;
			stub.maxInFlight = Math.max(stub.maxInFlight, inFlight);
			return new Promise<Response>((resolve) => {
				setTimeout(() => {
					inFlight -= 1;
					deliveredDepth = Math.max(deliveredDepth, request.depth);
					resolve(response);
				});
			});
		})
	);

	return stub;
}

/**
 * Google's PATCH as observed against the live API: nested objects merge,
 * null clears, and lists and scalars replace.
 * https://developers.google.com/wallet/retail/loyalty-cards/use-cases/updates
 */
export function applyGooglePatch(
	stored: object,
	patch: object
): Record<string, unknown> {
	const result: Record<string, unknown> = { ...stored };
	for (const [key, value] of Object.entries(patch)) {
		const current = result[key];
		if (value === null) {
			result[key] = undefined;
		} else if (typeof value === "object" && !Array.isArray(value)) {
			const base =
				typeof current === "object" &&
				current !== null &&
				!Array.isArray(current)
					? current
					: {};
			result[key] = applyGooglePatch(base, value);
		} else {
			result[key] = value;
		}
	}
	return result;
}
/**
 * Responder under which every class already exists, as after the first pass
 * was issued from a template. Other requests fall through to the defaults.
 */
export function existingClasses(request: WalletRequest): Response | undefined {
	const [, resource, id] = request.path.split("/");
	return request.method === "GET" && resource?.endsWith("Class")
		? Response.json({ id })
		: undefined;
}

export interface DecodedJwt {
	claims: Record<string, unknown>;
	header: Record<string, unknown>;
}

export function decodeJwt(jwt: string): DecodedJwt {
	const [header, claims] = jwt.split(".");
	if (!(header && claims)) {
		throw new Error("malformed JWT");
	}
	const decode = (segment: string): Record<string, unknown> =>
		JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
	return { header: decode(header), claims: decode(claims) };
}

/** Verifies an RS256 JWT signature independently of the library's signer. */
export function verifyJwt(jwt: string, publicKey: KeyObject): DecodedJwt {
	const [header, claims, signature, ...rest] = jwt.split(".");
	if (!(header && claims && signature) || rest.length > 0) {
		throw new Error("malformed JWT");
	}
	const decoded = decodeJwt(jwt);
	if (decoded.header.alg !== "RS256") {
		throw new Error(`unexpected JWT alg ${String(decoded.header.alg)}`);
	}
	const valid = verify(
		"sha256",
		Buffer.from(`${header}.${claims}`),
		publicKey,
		Buffer.from(signature, "base64url")
	);
	if (!valid) {
		throw new Error("JWT signature does not verify");
	}
	return decoded;
}

/** The single Wallet object embedded in a save-to-wallet JWT. */
export function decodeJwtObject(
	jwt: string,
	vertical: GoogleVertical
): Record<string, unknown> {
	const payload = decodeJwt(jwt).claims.payload as Record<
		string,
		Record<string, unknown>[]
	>;
	const object = payload[`${vertical}Objects`]?.[0];
	if (!object) {
		throw new Error(`JWT payload has no ${vertical}Objects entry`);
	}
	return object;
}
