import { importPKCS8, SignJWT } from "jose";
import { WalletError, type WalletErrorCode } from "../../errors";
import type { GoogleCredentials } from "../../types/credentials";

const WALLET_BASE = "https://walletobjects.googleapis.com/walletobjects/v1";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const WALLET_SCOPE = "https://www.googleapis.com/auth/wallet_object.issuer";
const BEARER_TOKEN_RE = /^[A-Za-z0-9._~+/-]+=*$/;
const RETRY_SECONDS_RE = /^\d+$/;
const HTTP_DATE_PREFIX_RE = /^[A-Za-z]/;

type WalletMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
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

export async function importGoogleKey(
	credentials: GoogleCredentials
): Promise<CryptoKey> {
	try {
		// Service-account JSON copied into env vars may retain literal "\n".
		// PEM cannot contain backslashes, so unescaping leaves valid keys untouched.
		const privateKey = credentials.privateKey.replace(/\\n/g, "\n");
		return await importPKCS8(privateKey, "RS256");
	} catch (cause) {
		throw new WalletError("GOOGLE_INVALID_PRIVATE_KEY", undefined, {
			cause: cause instanceof Error ? cause : undefined,
		});
	}
}

async function getAccessToken(
	credentials: GoogleCredentials,
	privateKey: CryptoKey
): Promise<string> {
	const cacheKey = `${credentials.issuerId}:${credentials.clientEmail}`;
	const cached = tokenCache.get(cacheKey);
	if (cached && Date.now() < cached.expiresAt) {
		return cached.token;
	}

	let assertion: string;
	try {
		assertion = await new SignJWT({ scope: WALLET_SCOPE })
			.setProtectedHeader({ alg: "RS256" })
			.setIssuedAt()
			.setExpirationTime("1h")
			.setIssuer(credentials.clientEmail)
			.setAudience(TOKEN_URL)
			.sign(privateKey);
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

	await assertOk(response, "GOOGLE_AUTH_FAILED");
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
	privateKey: CryptoKey,
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

async function assertOk(
	response: Response,
	fallback: "GOOGLE_API_ERROR" | "GOOGLE_AUTH_FAILED" = "GOOGLE_API_ERROR"
): Promise<void> {
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
	await response.body?.cancel().catch(() => undefined);
	throw error;
}

async function getClass(
	classType: GoogleClassType,
	classId: string,
	credentials: GoogleCredentials,
	privateKey: CryptoKey
): Promise<Record<string, unknown> | null> {
	const response = await walletRequest(
		"GET",
		`/${classType}/${classId}`,
		credentials,
		privateKey
	);
	if (response.status === 404) {
		await response.body?.cancel().catch(() => undefined);
		return null;
	}
	await assertOk(response);
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
	privateKey: CryptoKey
): Promise<void> {
	if (await getClass(classType, classId, credentials, privateKey)) {
		return;
	}
	await assertOk(
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
	privateKey: CryptoKey
): Promise<void> {
	const existing = await getClass(classType, classId, credentials, privateKey);
	if (!existing) {
		await assertOk(
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
	await assertOk(
		await walletRequest(
			"PUT",
			`/${classType}/${classId}`,
			credentials,
			privateKey,
			updateBody
		)
	);
}

export async function deleteObject(
	objectType: GoogleObjectType,
	objectId: string,
	credentials: GoogleCredentials,
	privateKey: CryptoKey
): Promise<void> {
	const response = await walletRequest(
		"DELETE",
		`/${objectType}/${objectId}`,
		credentials,
		privateKey
	);
	// A missing object is already deleted, so deletion is idempotent.
	if (response.status !== 404) {
		await assertOk(response);
	}
	await response.body?.cancel().catch(() => undefined);
}

export async function patchObject(
	objectType: GoogleObjectType,
	objectId: string,
	patch: Record<string, unknown>,
	credentials: GoogleCredentials,
	privateKey: CryptoKey,
	options?: { notify?: boolean }
): Promise<void> {
	const response = await walletRequest(
		"PATCH",
		`/${objectType}/${objectId}`,
		credentials,
		privateKey,
		// notifyPreference is a request-body field on the object, not a query
		// parameter. It is ephemeral: Google requires it on every PATCH/UPDATE
		// that should trigger a field-update notification.
		options?.notify ? { ...patch, notifyPreference: "NOTIFY_ON_UPDATE" } : patch
	);
	await assertOk(response);
}
