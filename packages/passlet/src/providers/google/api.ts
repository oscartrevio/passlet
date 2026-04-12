import { importPKCS8, SignJWT } from "jose";
import { WalletError } from "../../errors";
import type { GoogleCredentials } from "../../types/credentials";

const WALLET_BASE = "https://walletobjects.googleapis.com/walletobjects/v1";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const WALLET_SCOPE = "https://www.googleapis.com/auth/wallet_object.issuer";

// Cache access tokens for 55 minutes (tokens expire in 60).
const tokenCache = new Map<string, { token: string; expiresAt: number }>();

export async function importGoogleKey(
	credentials: GoogleCredentials
): Promise<CryptoKey> {
	try {
		return await importPKCS8(credentials.privateKey, "RS256");
	} catch (cause) {
		throw new WalletError("GOOGLE_INVALID_PRIVATE_KEY", undefined, { cause });
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
		throw new WalletError("GOOGLE_SIGNING_FAILED", undefined, { cause });
	}

	const response = await fetch(TOKEN_URL, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
			assertion,
		}).toString(),
	});

	if (!response.ok) {
		const text = await response.text();
		throw new WalletError(
			"GOOGLE_API_ERROR",
			`Failed to obtain access token (${response.status}): ${extractGoogleDetail(text)}`
		);
	}

	const data = (await response.json()) as { access_token: string };
	tokenCache.set(cacheKey, {
		token: data.access_token,
		expiresAt: Date.now() + 55 * 60 * 1000,
	});
	return data.access_token;
}

async function walletRequest(
	method: string,
	path: string,
	credentials: GoogleCredentials,
	privateKey: CryptoKey,
	body?: Record<string, unknown>
): Promise<Response> {
	const accessToken = await getAccessToken(credentials, privateKey);
	return fetch(`${WALLET_BASE}${path}`, {
		method,
		headers: {
			Authorization: `Bearer ${accessToken}`,
			"Content-Type": "application/json",
		},
		body: body === undefined ? undefined : JSON.stringify(body),
	});
}

function extractGoogleDetail(text: string): string {
	try {
		const body = JSON.parse(text) as { error?: { message?: string } };
		if (body.error?.message) {
			return body.error.message;
		}
	} catch {
		// not JSON — fall through to raw text
	}
	return text;
}

async function assertOk(response: Response): Promise<void> {
	if (!response.ok) {
		const text = await response.text();
		const detail = extractGoogleDetail(text);
		throw new WalletError(
			"GOOGLE_API_ERROR",
			`Google Wallet API error (${response.status}): ${detail}`
		);
	}
}

// Ensure a Google Wallet class exists, creating or updating it as needed.
export async function ensureClass(
	classType: string,
	classId: string,
	classBody: Record<string, unknown>,
	credentials: GoogleCredentials,
	privateKey: CryptoKey
): Promise<void> {
	const existing = await walletRequest(
		"GET",
		`/${classType}/${classId}`,
		credentials,
		privateKey
	);

	if (existing.ok) {
		const existingClass = (await existing.json()) as Record<string, unknown>;
		// Class exists — PUT the body so template updates are reflected.
		// Google Wallet requires the full body for PUT requests, so we merge
		// our new attributes with the existing class from their API.
		const updateBody = { ...existingClass, ...classBody };

		// Note: reviewStatus must be 'UNDER_REVIEW' or 'DRAFT' for updates
		if ("reviewStatus" in updateBody && updateBody.reviewStatus !== "DRAFT") {
			updateBody.reviewStatus = "UNDER_REVIEW";
		}

		await assertOk(
			await walletRequest(
				"PUT",
				`/${classType}/${classId}`,
				credentials,
				privateKey,
				{
					id: classId,
					...updateBody,
				}
			)
		);
		return;
	}

	if (existing.status !== 404) {
		const text = await existing.text();
		throw new WalletError(
			"GOOGLE_API_ERROR",
			`Google Wallet API error (${existing.status}): ${extractGoogleDetail(text)}`
		);
	}

	await assertOk(
		await walletRequest("POST", `/${classType}`, credentials, privateKey, {
			id: classId,
			...classBody,
		})
	);
}

export async function deleteObject(
	objectType: string,
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
	// 404 = already deleted — treat as success (idempotent)
	if (response.status === 404) {
		await response.body?.cancel();
		return;
	}
	await assertOk(response);
	await response.body?.cancel();
}

export async function patchObject(
	objectType: string,
	objectId: string,
	patch: Record<string, unknown>,
	credentials: GoogleCredentials,
	privateKey: CryptoKey
): Promise<void> {
	const response = await walletRequest(
		"PATCH",
		`/${objectType}/${objectId}`,
		credentials,
		privateKey,
		patch
	);
	await assertOk(response);
}
