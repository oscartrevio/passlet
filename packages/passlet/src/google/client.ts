import { createPrivateKey, type KeyObject } from "node:crypto";
import { WalletError, type WalletErrorCode } from "../errors";
import { discardBody } from "../http";
import type { ParsedGooglePassMessage } from "../schema/parts";
import type { GoogleCredentials } from "../schema/settings";
import { signJwt } from "./jwt";

const WALLET_BASE = "https://walletobjects.googleapis.com/walletobjects/v1";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const WALLET_SCOPE = "https://www.googleapis.com/auth/wallet_object.issuer";
const BEARER_TOKEN_RE = /^[A-Za-z0-9._~+/-]+=*$/;
const RETRY_SECONDS_RE = /^\d+$/;
const HTTP_DATE_PREFIX_RE = /^[A-Za-z]/;

type WalletMethod = "GET" | "POST" | "PUT" | "PATCH";
type GoogleVertical =
	| "loyalty"
	| "eventTicket"
	| "flight"
	| "offer"
	| "giftCard"
	| "generic"
	| "transit";

export type GoogleClassType = `${GoogleVertical}Class`;
export type GoogleObjectType = `${GoogleVertical}Object`;

// Access tokens are reused until shortly before the `expires_in` Google sends
// with each one: "Access tokens can be reused during the duration window
// specified by the expires_in value."
// https://developers.google.com/identity/protocols/oauth2/service-account
const TOKEN_EXPIRY_MARGIN_MS = 5 * 60 * 1000;

interface AccessToken {
	/** Whether the token came from the cache rather than a fresh exchange. */
	cached: boolean;
	token: string;
}

export function importGoogleKey(credentials: GoogleCredentials): KeyObject {
	try {
		// Service-account JSON copied into env vars may retain literal "\n".
		// PEM cannot contain backslashes, so unescaping leaves valid keys untouched.
		const privateKey = credentials.privateKey.replace(/\\n/g, "\n");
		const key = createPrivateKey({ key: privateKey, format: "pem" });
		// RS256 needs an RSA key; reject EC/Ed keys at import like before.
		if (key.asymmetricKeyType !== "rsa") {
			throw new Error(`Expected an RSA key, got ${key.asymmetricKeyType}`);
		}
		return key;
	} catch (cause) {
		throw new WalletError("GOOGLE_INVALID_PRIVATE_KEY", undefined, {
			cause: cause instanceof Error ? cause : undefined,
		});
	}
}

/**
 * Google Wallet API calls for one service account. Its access token is cached
 * on the client and reused until shortly before it expires.
 */
export class GoogleClient {
	/** The service account key, imported once; also signs save links. */
	readonly privateKey: KeyObject;
	readonly #credentials: GoogleCredentials;
	#token: { token: string; expiresAt: number } | undefined;

	/**
	 * @throws {WalletError} `GOOGLE_INVALID_PRIVATE_KEY` if the key is not an
	 * RSA PEM private key.
	 */
	constructor(credentials: GoogleCredentials) {
		this.#credentials = credentials;
		this.privateKey = importGoogleKey(credentials);
	}

	// Issuance may create a missing class, but never rewrites a shared template.
	async ensureClass(
		classType: GoogleClassType,
		classId: string,
		classBody: Record<string, unknown>
	): Promise<void> {
		if (await this.#getClass(classType, classId)) {
			return;
		}
		const response = await this.#request(
			"POST",
			`/${classType}`,
			classWrite(classId, classBody)
		);
		// Concurrent issues can both find the class missing. Google answers 409
		// to the later insert because the ID now exists, so the class is there.
		// https://developers.google.com/wallet/retail/loyalty-cards/resources/error-codes
		if (response.status === 409) {
			discardBody(response);
			return;
		}
		assertOk(response);
	}

	async publishClass(
		classType: GoogleClassType,
		classId: string,
		classBody: Record<string, unknown>
	): Promise<void> {
		const existing = await this.#getClass(classType, classId);
		if (!existing) {
			assertOk(
				await this.#request(
					"POST",
					`/${classType}`,
					classWrite(classId, classBody)
				)
			);
			return;
		}

		// update (PUT) replaces the whole class, unlike patch: keep the
		// attributes passlet does not own, and let every key passlet owns,
		// `undefined` when the template leaves it unset, drop out of the body so
		// Google clears it.
		// https://developers.google.com/wallet/reference/rest/v1/loyaltyclass/update
		assertOk(
			await this.#request(
				"PUT",
				`/${classType}/${classId}`,
				classWrite(classId, { ...existing, ...classBody })
			)
		);
	}

	/** Write the given fields of an object; `undefined` ones are cleared. */
	async patchObject(
		objectType: GoogleObjectType,
		objectId: string,
		patch: Record<string, unknown>,
		options?: { notify?: boolean }
	): Promise<void> {
		const body = patchBody(patch);
		const response = await this.#request(
			"PATCH",
			`/${objectType}/${objectId}`,
			// notifyPreference is a request-body field on the object, not a query
			// parameter. It is ephemeral: Google requires it on every PATCH/UPDATE
			// that should trigger a field-update notification.
			options?.notify ? { ...body, notifyPreference: "NOTIFY_ON_UPDATE" } : body
		);
		assertOk(response);
	}

	/**
	 * Add a message to an object's details through Google's AddMessage
	 * endpoint. Google documents the TEXT_AND_NOTIFY push for messages sent
	 * this way, not for messages written with the object.
	 * https://developers.google.com/wallet/generic/use-cases/trigger-push-notifications
	 * https://developers.google.com/wallet/reference/rest/v1/loyaltyobject/addmessage
	 */
	async addObjectMessage(
		objectType: GoogleObjectType,
		objectId: string,
		message: ParsedGooglePassMessage
	): Promise<void> {
		assertOk(
			await this.#request("POST", `/${objectType}/${objectId}/addMessage`, {
				message,
			})
		);
	}

	/**
	 * Bring an object to exactly this content, creating it if Google has none.
	 * Patching first suits updates, where the object almost always exists; the
	 * insert covers objects never created through the API, so updates work
	 * before the holder saves the pass.
	 * https://developers.google.com/wallet/retail/loyalty-cards/resources/error-codes
	 */
	async upsertObject(
		objectType: GoogleObjectType,
		objectId: string,
		body: Record<string, unknown>,
		options?: { notify?: boolean }
	): Promise<"updated" | "created"> {
		try {
			await this.patchObject(objectType, objectId, body, options);
			return "updated";
		} catch (error) {
			if (
				!(error instanceof WalletError && error.code === "GOOGLE_NOT_FOUND")
			) {
				throw error;
			}
		}
		// A new object has no holder to notify, so the flag is not sent.
		assertOk(await this.#request("POST", `/${objectType}`, insertBody(body)));
		return "created";
	}

	/**
	 * Create an object, updating it instead if Google already has one.
	 * Inserting first suits issuing, where the object is usually new: one
	 * request instead of a 404 patch plus an insert. Google answers 409 for an
	 * existing ID.
	 * https://developers.google.com/wallet/retail/loyalty-cards/resources/error-codes
	 */
	async insertObject(
		objectType: GoogleObjectType,
		objectId: string,
		body: Record<string, unknown>
	): Promise<void> {
		const response = await this.#request(
			"POST",
			`/${objectType}`,
			insertBody(body)
		);
		if (response.status !== 409) {
			assertOk(response);
			return;
		}
		discardBody(response);
		// The patch carries no state, so re-issuing an expired pass keeps it
		// expired.
		await this.patchObject(objectType, objectId, body);
	}

	async #getClass(
		classType: GoogleClassType,
		classId: string
	): Promise<Record<string, unknown> | null> {
		const response = await this.#request("GET", `/${classType}/${classId}`);
		if (response.status === 404) {
			discardBody(response);
			return null;
		}
		assertOk(response);
		const body = await readGoogleResponse(response);
		if (body.id !== classId) {
			throw new WalletError("GOOGLE_INVALID_RESPONSE", undefined, {
				retryAfter: retryAfterSeconds(response),
			});
		}
		return body;
	}

	async #request(
		method: WalletMethod,
		path: string,
		body?: Record<string, unknown>
	): Promise<Response> {
		const send = (accessToken: string) =>
			googleFetch(`${WALLET_BASE}${path}`, {
				method,
				headers: {
					Authorization: `Bearer ${accessToken}`,
					"Content-Type": "application/json",
				},
				body: body === undefined ? undefined : JSON.stringify(body),
			});
		const first = await this.#accessToken();
		const response = await send(first.token);
		if (response.status !== 401 || !first.cached) {
			return response;
		}
		// A cached token can stop working before its expires_in, e.g. when the
		// key is rotated. Retry once with a freshly exchanged token; a 401 on a
		// fresh token is a real authentication failure.
		discardBody(response);
		const fresh = await this.#accessToken(first.token);
		return await send(fresh.token);
	}

	/** A token for this service account; `rejected` names one Google refused. */
	async #accessToken(rejected?: string): Promise<AccessToken> {
		const cached = this.#token;
		if (cached && cached.token !== rejected && Date.now() < cached.expiresAt) {
			return { token: cached.token, cached: true };
		}

		let assertion: string;
		try {
			const iat = Math.floor(Date.now() / 1000);
			assertion = signJwt(
				{
					scope: WALLET_SCOPE,
					iat,
					exp: iat + 3600,
					iss: this.#credentials.clientEmail,
					aud: TOKEN_URL,
				},
				this.privateKey
			);
		} catch (cause) {
			throw new WalletError("GOOGLE_SIGNING_FAILED", undefined, {
				cause: cause instanceof Error ? cause : undefined,
			});
		}

		const response = await googleFetch(TOKEN_URL, {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
				assertion,
			}).toString(),
		});

		assertOk(response, "GOOGLE_AUTH_FAILED");
		const data = await readGoogleResponse(response);
		const token = data.access_token;
		if (typeof token !== "string" || !BEARER_TOKEN_RE.test(token)) {
			throw new WalletError("GOOGLE_INVALID_RESPONSE", undefined, {
				retryAfter: retryAfterSeconds(response),
			});
		}
		// Without a lifetime the token is used once rather than cached on a
		// guess.
		const expiresIn = data.expires_in;
		if (typeof expiresIn === "number" && Number.isFinite(expiresIn)) {
			this.#token = {
				token,
				expiresAt: Date.now() + expiresIn * 1000 - TOKEN_EXPIRY_MARGIN_MS,
			};
		}
		return { token, cached: false };
	}
}

async function googleFetch(url: string, init: RequestInit): Promise<Response> {
	try {
		return await fetch(url, init);
	} catch (cause) {
		throw new WalletError("GOOGLE_NETWORK_ERROR", undefined, {
			cause: cause instanceof Error ? cause : undefined,
		});
	}
}

async function readGoogleResponse(
	response: Response
): Promise<Record<string, unknown>> {
	let data: unknown;
	try {
		data = await response.json();
	} catch (cause) {
		// JSON parser errors may quote the response body, including secrets.
		if (cause instanceof SyntaxError) {
			throw new WalletError("GOOGLE_INVALID_RESPONSE", undefined, {
				retryAfter: retryAfterSeconds(response),
			});
		}
		throw new WalletError("GOOGLE_NETWORK_ERROR", undefined, {
			retryAfter: retryAfterSeconds(response),
			cause: cause instanceof Error ? cause : undefined,
		});
	}
	if (!data || typeof data !== "object" || Array.isArray(data)) {
		throw new WalletError("GOOGLE_INVALID_RESPONSE", undefined, {
			retryAfter: retryAfterSeconds(response),
		});
	}
	return data as Record<string, unknown>;
}

function retryAfterSeconds(response: Response): number | undefined {
	const value = response.headers.get("Retry-After")?.trim();
	if (!value) {
		return;
	}
	if (RETRY_SECONDS_RE.test(value)) {
		const seconds = Number(value);
		return Number.isFinite(seconds) ? seconds : undefined;
	}
	if (!HTTP_DATE_PREFIX_RE.test(value)) {
		return;
	}
	const date = Date.parse(value);
	return Number.isNaN(date)
		? undefined
		: Math.max(0, Math.ceil((date - Date.now()) / 1000));
}

const HTTP_ERROR_CODES: Partial<Record<number, WalletErrorCode>> = {
	401: "GOOGLE_AUTH_FAILED",
	403: "GOOGLE_ACCESS_DENIED",
	404: "GOOGLE_NOT_FOUND",
	409: "GOOGLE_CONFLICT",
	429: "GOOGLE_RATE_LIMITED",
};

function assertOk(
	response: Response,
	fallback: "GOOGLE_API_ERROR" | "GOOGLE_AUTH_FAILED" = "GOOGLE_API_ERROR"
): void {
	if (response.ok) {
		return;
	}
	const code =
		response.status >= 500 && response.status <= 599
			? "GOOGLE_UNAVAILABLE"
			: (HTTP_ERROR_CODES[response.status] ?? fallback);
	const error = new WalletError(code, undefined, {
		status: response.status,
		retryAfter: retryAfterSeconds(response),
	});
	// Discard untrusted diagnostics; cleanup must not hide the API failure.
	discardBody(response);
	throw error;
}

/**
 * A class body as Google accepts it on a write. reviewStatus "can be set to
 * `draft` or `underReview` using the insert, patch, or update API calls";
 * Google sets `approved` itself, and an approved class is updated as
 * `underReview`. Every other status is sent as UNDER_REVIEW.
 * https://developers.google.com/wallet/reference/rest/v1/loyaltyclass
 */
function classWrite(
	classId: string,
	body: Record<string, unknown>
): Record<string, unknown> {
	const write: Record<string, unknown> = { ...body, id: classId };
	if (write.reviewStatus !== undefined && write.reviewStatus !== "DRAFT") {
		write.reviewStatus = "UNDER_REVIEW";
	}
	return write;
}

/**
 * The PATCH body for an object write: every `undefined` field becomes `null`.
 * Google merges a PATCH into the stored object, recursing into nested objects,
 * so an omitted field keeps its old value and only `null` clears it. Lists are
 * replaced whole, so their entries are sent as they are.
 */
export function patchBody(body: object): Record<string, unknown> {
	const patch: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(body)) {
		if (value === undefined) {
			patch[key] = null;
		} else if (
			typeof value === "object" &&
			value !== null &&
			!Array.isArray(value)
		) {
			patch[key] = patchBody(value);
		} else {
			patch[key] = value;
		}
	}
	return patch;
}

/**
 * A new object starts ACTIVE; `state` is required on insert. Only inserts set
 * it, so an update never revives a pass that expire() moved to EXPIRED.
 * https://developers.google.com/wallet/reference/rest/v1/loyaltyobject
 */
function insertBody(body: Record<string, unknown>): Record<string, unknown> {
	return { ...body, state: "ACTIVE" };
}
