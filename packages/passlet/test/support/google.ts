import { generateKeyPairSync } from "node:crypto";
import { onTestFinished, vi } from "vitest";
import type { GoogleObjectType } from "../../src/providers/google/api";
import type { GoogleCredentials } from "../../src/types/credentials";

export const ISSUER_ID = "3388000000022801234";
export const CLIENT_EMAIL = "test@test-project.iam.gserviceaccount.com";
export const LOGO_URL = "https://example.com/logo.png";

const WALLET_BASE = "https://walletobjects.googleapis.com/walletobjects/v1";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

let privateKey: string | undefined;

/**
 * Service-account style credentials backed by an RSA-2048 PKCS#8 key,
 * generated once per test file.
 *
 * The Wallet client caches OAuth tokens per `issuerId:clientEmail` for the
 * life of the module, so tests that count token requests must pass a
 * distinct `clientEmail`.
 */
export function googleCredentials(
	overrides?: Partial<GoogleCredentials>
): GoogleCredentials {
	privateKey ??= generateKeyPairSync("rsa", {
		modulusLength: 2048,
		privateKeyEncoding: { type: "pkcs8", format: "pem" },
		publicKeyEncoding: { type: "spki", format: "pem" },
	}).privateKey;
	return {
		issuerId: ISSUER_ID,
		clientEmail: CLIENT_EMAIL,
		privateKey,
		...overrides,
	};
}

export interface WalletRequest {
	body: Record<string, unknown> | undefined;
	/** Request headers with lower-cased names. */
	headers: Record<string, string>;
	method: string;
	/** Path relative to the Wallet API base, e.g. `/loyaltyClass/123.abc`. */
	path: string;
}

export type WalletResponder = (request: WalletRequest) => Response | undefined;

export interface GoogleFetchStub {
	/** Body of the first Wallet request matching `method` and `path` substring. */
	body(method: string, path: string): Record<string, unknown>;
	/** Wallet API requests in call order. OAuth token requests are not recorded. */
	requests: WalletRequest[];
	/** OAuth token requests made so far. */
	tokenRequests: number;
}

export interface StubGoogleFetchOptions {
	/** Overrides the OAuth token response; the default is 200 with a fake token. */
	token?: () => Response;
}

/**
 * Replaces global `fetch` with a Google Wallet API stand-in until the current
 * test finishes.
 *
 * Defaults: the OAuth token endpoint returns a fake token; `GET` requests
 * return 404 so class creation takes the `POST` path; everything else returns
 * 200 `{}`. `respond` gets first chance at every Wallet request and may return
 * `undefined` to fall through to the defaults.
 */
export function stubGoogleFetch(
	respond?: WalletResponder,
	{ token }: StubGoogleFetchOptions = {}
): GoogleFetchStub {
	const stub: GoogleFetchStub = {
		requests: [],
		tokenRequests: 0,
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

	vi.stubGlobal(
		"fetch",
		vi.fn((input: string | URL | Request, init?: RequestInit) => {
			const url = String(input);
			if (url.startsWith(TOKEN_URL)) {
				stub.tokenRequests += 1;
				return Promise.resolve(
					token?.() ?? Response.json({ access_token: "test-token" })
				);
			}
			if (!url.startsWith(WALLET_BASE)) {
				return Promise.reject(new Error(`unexpected fetch: ${url}`));
			}
			const request: WalletRequest = {
				method: init?.method ?? "GET",
				path: url.slice(WALLET_BASE.length),
				headers: Object.fromEntries(new Headers(init?.headers)),
				body: init?.body
					? (JSON.parse(String(init.body)) as Record<string, unknown>)
					: undefined,
			};
			stub.requests.push(request);
			const response =
				respond?.(request) ??
				(request.method === "GET"
					? new Response("", { status: 404 })
					: Response.json({}));
			return Promise.resolve(response);
		})
	);
	onTestFinished(() => {
		vi.unstubAllGlobals();
	});

	return stub;
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

/** The single Wallet object embedded in a save-to-wallet JWT. */
export function decodeJwtObject(
	jwt: string,
	objectType: GoogleObjectType
): Record<string, unknown> {
	const payload = decodeJwt(jwt).claims.payload as Record<
		string,
		Record<string, unknown>[]
	>;
	const object = payload[`${objectType}s`]?.[0];
	if (!object) {
		throw new Error(`JWT payload has no ${objectType}s entry`);
	}
	return object;
}
