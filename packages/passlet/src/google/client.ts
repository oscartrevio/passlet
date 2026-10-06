import { createPrivateKey, type KeyObject } from "node:crypto";
import { WalletError, type WalletErrorCode } from "../errors";
import { discardBody } from "../http";
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

// Cache access tokens for 55 minutes (tokens expire in 60).
const tokenCache = new Map<string, { token: string; expiresAt: number }>();

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

async function getAccessToken(
	credentials: GoogleCredentials,
	privateKey: KeyObject
): Promise<string> {
	const cacheKey = `${credentials.issuerId}:${credentials.clientEmail}`;
	const cached = tokenCache.get(cacheKey);
	if (cached && Date.now() < cached.expiresAt) {
		return cached.token;
	}

	let assertion: string;
	try {
		const iat = Math.floor(Date.now() / 1000);
		assertion = signJwt(
			{
				scope: WALLET_SCOPE,
				iat,
				exp: iat + 3600,
				iss: credentials.clientEmail,
				aud: TOKEN_URL,
			},
			privateKey
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
	tokenCache.set(cacheKey, {
		token,
		expiresAt: Date.now() + 55 * 60 * 1000,
	});
	return token;
}

async function walletRequest(
	method: WalletMethod,
	path: string,
	credentials: GoogleCredentials,
	privateKey: KeyObject,
	body?: Record<string, unknown>
): Promise<Response> {
	const accessToken = await getAccessToken(credentials, privateKey);
	return googleFetch(`${WALLET_BASE}${path}`, {
		method,
		headers: {
			Authorization: `Bearer ${accessToken}`,
			"Content-Type": "application/json",
		},
		body: body === undefined ? undefined : JSON.stringify(body),
	});
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

async function getClass(
	classType: GoogleClassType,
	classId: string,
	credentials: GoogleCredentials,
	privateKey: KeyObject
): Promise<Record<string, unknown> | null> {
	const response = await walletRequest(
		"GET",
		`/${classType}/${classId}`,
		credentials,
		privateKey
	);
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

// Issuance may create a missing class, but never rewrites a shared template.
export async function ensureClass(
	classType: GoogleClassType,
	classId: string,
	classBody: Record<string, unknown>,
	credentials: GoogleCredentials,
	privateKey: KeyObject
): Promise<void> {
	if (await getClass(classType, classId, credentials, privateKey)) {
		return;
	}
	assertOk(
		await walletRequest("POST", `/${classType}`, credentials, privateKey, {
			...classBody,
			id: classId,
		})
	);
}

export async function publishClass(
	classType: GoogleClassType,
	classId: string,
	classBody: Record<string, unknown>,
	credentials: GoogleCredentials,
	privateKey: KeyObject
): Promise<void> {
	const existing = await getClass(classType, classId, credentials, privateKey);
	if (!existing) {
		assertOk(
			await walletRequest("POST", `/${classType}`, credentials, privateKey, {
				...classBody,
				id: classId,
			})
		);
		return;
	}

	// Google requires a full body for PUT; preserve attributes we do not own.
	const updateBody = { ...existing, ...classBody, id: classId };
	// Updates accept only UNDER_REVIEW or DRAFT.
	if ("reviewStatus" in updateBody && updateBody.reviewStatus !== "DRAFT") {
		updateBody.reviewStatus = "UNDER_REVIEW";
	}
	assertOk(
		await walletRequest(
			"PUT",
			`/${classType}/${classId}`,
			credentials,
			privateKey,
			updateBody
		)
	);
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

/** Write the given fields of an object; `undefined` ones are cleared. */
export async function patchObject(
	objectType: GoogleObjectType,
	objectId: string,
	patch: Record<string, unknown>,
	credentials: GoogleCredentials,
	privateKey: KeyObject,
	options?: { notify?: boolean }
): Promise<void> {
	const body = patchBody(patch);
	const response = await walletRequest(
		"PATCH",
		`/${objectType}/${objectId}`,
		credentials,
		privateKey,
		// notifyPreference is a request-body field on the object, not a query
		// parameter. It is ephemeral: Google requires it on every PATCH/UPDATE
		// that should trigger a field-update notification.
		options?.notify ? { ...body, notifyPreference: "NOTIFY_ON_UPDATE" } : body
	);
	assertOk(response);
}

/**
 * Bring an object to exactly this content, creating it if Google has none.
 * Patching first suits updates, where the object almost always exists; the
 * insert covers objects never created through the API, so updates work before
 * the holder saves the pass.
 * https://developers.google.com/wallet/retail/loyalty-cards/resources/error-codes
 */
export async function upsertObject(
	objectType: GoogleObjectType,
	objectId: string,
	body: Record<string, unknown>,
	credentials: GoogleCredentials,
	privateKey: KeyObject,
	options?: { notify?: boolean }
): Promise<"updated" | "created"> {
	try {
		await patchObject(
			objectType,
			objectId,
			body,
			credentials,
			privateKey,
			options
		);
		return "updated";
	} catch (error) {
		if (!(error instanceof WalletError && error.code === "GOOGLE_NOT_FOUND")) {
			throw error;
		}
	}
	// A new object has no holder to notify, so the flag is not sent.
	assertOk(
		await walletRequest(
			"POST",
			`/${objectType}`,
			credentials,
			privateKey,
			insertBody(body)
		)
	);
	return "created";
}

/**
 * Create an object, updating it instead if Google already has one. Inserting
 * first suits issuing, where the object is usually new: one request instead
 * of a 404 patch plus an insert. Google answers 409 for an existing ID.
 * https://developers.google.com/wallet/retail/loyalty-cards/resources/error-codes
 */
export async function insertObject(
	objectType: GoogleObjectType,
	objectId: string,
	body: Record<string, unknown>,
	credentials: GoogleCredentials,
	privateKey: KeyObject
): Promise<void> {
	const response = await walletRequest(
		"POST",
		`/${objectType}`,
		credentials,
		privateKey,
		insertBody(body)
	);
	if (response.status !== 409) {
		assertOk(response);
		return;
	}
	discardBody(response);
	// The patch carries no state, so re-issuing an expired pass keeps it expired.
	await patchObject(objectType, objectId, body, credentials, privateKey);
}

/**
 * A new object starts ACTIVE; `state` is required on insert. Only inserts set
 * it, so an update never revives a pass that expire() moved to EXPIRED.
 * https://developers.google.com/wallet/reference/rest/v1/loyaltyobject
 */
function insertBody(body: Record<string, unknown>): Record<string, unknown> {
	return { ...body, state: "ACTIVE" };
}
