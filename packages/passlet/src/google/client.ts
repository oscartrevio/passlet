import { createPrivateKey, type KeyObject } from "node:crypto";
import type { GoogleCredentials } from "../config";
import { WalletError, type WalletErrorCode } from "../errors";
import { discardBody } from "../http";
import type { ParsedGooglePassMessage } from "../schema/google";
import { signJwt } from "./jwt";
import { type GoogleVertical, patchBody } from "./utils";

const WALLET_BASE = "https://walletobjects.googleapis.com/walletobjects/v1";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const WALLET_SCOPE = "https://www.googleapis.com/auth/wallet_object.issuer";
const BEARER_TOKEN_RE = /^[A-Za-z0-9._~+/-]+=*$/;
const RETRY_SECONDS_RE = /^\d+$/;
const HTTP_DATE_PREFIX_RE = /^[A-Za-z]/;

type WalletMethod = "GET" | "POST" | "PATCH";

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

function importGoogleKey(privateKey: string): KeyObject {
	try {
		// Service-account JSON copied into env vars may retain literal "\n".
		// PEM cannot contain backslashes, so unescaping leaves valid keys untouched.
		const key = createPrivateKey({
			key: privateKey.replace(/\\n/g, "\n"),
			format: "pem",
		});
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
 * on the client and reused until shortly before it expires; concurrent calls
 * share one exchange.
 */
export class GoogleClient {
	readonly clientEmail: string;
	/** The service account key, imported once; also signs save links. */
	readonly privateKey: KeyObject;
	#token: { token: string; expiresAt: number } | undefined;
	#exchange: Promise<string> | undefined;

	/**
	 * @throws {WalletError} `GOOGLE_INVALID_PRIVATE_KEY` if the key is not an
	 * RSA PEM private key.
	 */
	constructor({ clientEmail, privateKey }: GoogleCredentials) {
		this.clientEmail = clientEmail;
		this.privateKey = importGoogleKey(privateKey);
	}

	/**
	 * Create the class if Google has none. Issuance never rewrites a shared
	 * class, so `build` runs only when the class must be inserted.
	 */
	async ensureClass(
		vertical: GoogleVertical,
		classId: string,
		build: () => Record<string, unknown>
	): Promise<void> {
		if (
			(await this.#send(
				"GET",
				`/${vertical}Class/${classId}`,
				undefined,
				404
			)) !== 404
		) {
			return;
		}
		// Concurrent issues can both find the class missing. Google answers 409
		// to the later insert because the ID now exists, so the class is there.
		// https://developers.google.com/wallet/retail/loyalty-cards/resources/error-codes
		await this.#send(
			"POST",
			`/${vertical}Class`,
			classWrite(classId, build()),
			409
		);
	}

	/**
	 * Write the class as the template states it, creating it if Google has
	 * none. A patch merges into nested objects, so fields passlet does not own
	 * (a flight's `origin.gate`, an event's `dateTime.doorsOpen`) keep their
	 * remote values while every owned field passlet leaves unset is cleared.
	 * https://developers.google.com/wallet/reference/rest/v1/loyaltyclass/patch
	 */
	async publishClass(
		vertical: GoogleVertical,
		classId: string,
		body: Record<string, unknown>
	): Promise<void> {
		const write = classWrite(classId, body);
		if (
			(await this.#send(
				"PATCH",
				`/${vertical}Class/${classId}`,
				patchBody(write),
				404
			)) === 404
		) {
			await this.#send("POST", `/${vertical}Class`, write);
		}
	}

	/**
	 * Create an object, updating it instead if Google already has one.
	 * Inserting first suits issuing, where the object is usually new: one
	 * request instead of a 404 patch plus an insert. Google answers 409 for an
	 * existing ID.
	 * https://developers.google.com/wallet/retail/loyalty-cards/resources/error-codes
	 */
	async insertObject(
		vertical: GoogleVertical,
		objectId: string,
		body: Record<string, unknown>
	): Promise<void> {
		// A new object starts ACTIVE; `state` is required on insert. Only inserts
		// set it, so neither an update nor a re-issue revives a pass that
		// expire() moved to EXPIRED.
		// https://developers.google.com/wallet/reference/rest/v1/loyaltyobject
		if (
			(await this.#send(
				"POST",
				`/${vertical}Object`,
				{ ...body, state: "ACTIVE" },
				409
			)) === 409
		) {
			await this.patchObject(vertical, objectId, body);
		}
	}

	/**
	 * Bring an existing object to exactly this content; `false` when Google
	 * has no such object. `notify` asks Google to alert holders about
	 * allowlisted field changes: notifyPreference is a request-body field and
	 * ephemeral, so only the request carrying it notifies.
	 * https://developers.google.com/wallet/reference/rest/v1/loyaltyobject
	 */
	async updateObject(
		vertical: GoogleVertical,
		objectId: string,
		body: Record<string, unknown>,
		notify: boolean
	): Promise<boolean> {
		const patch = patchBody(body);
		const status = await this.#send(
			"PATCH",
			`/${vertical}Object/${objectId}`,
			notify ? { ...patch, notifyPreference: "NOTIFY_ON_UPDATE" } : patch,
			404
		);
		return status !== 404;
	}

	/** Write the given fields of an object; `undefined` ones are cleared. */
	async patchObject(
		vertical: GoogleVertical,
		objectId: string,
		patch: Record<string, unknown>
	): Promise<void> {
		await this.#send(
			"PATCH",
			`/${vertical}Object/${objectId}`,
			patchBody(patch)
		);
	}

	/**
	 * Add a message to an object's details through Google's AddMessage
	 * endpoint. Google documents the TEXT_AND_NOTIFY push for messages sent
	 * this way, not for messages written with the object.
	 * https://developers.google.com/wallet/generic/use-cases/trigger-push-notifications
	 * https://developers.google.com/wallet/reference/rest/v1/loyaltyobject/addmessage
	 */
	async addObjectMessage(
		vertical: GoogleVertical,
		objectId: string,
		message: ParsedGooglePassMessage
	): Promise<void> {
		await this.#send("POST", `/${vertical}Object/${objectId}/addMessage`, {
			message,
		});
	}

	/**
	 * Send one Wallet request and release its body. Returns the status, which
	 * is either successful or `tolerated`; any other failure throws.
	 */
	async #send(
		method: WalletMethod,
		path: string,
		body?: Record<string, unknown>,
		tolerated?: 404 | 409
	): Promise<number> {
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
		let response = await send(first.token);
		if (response.status === 401 && first.cached) {
			// A cached token can stop working before its expires_in, e.g. when the
			// key is rotated. Retry once with a freshly exchanged token; a 401 on a
			// fresh token is a real authentication failure.
			discardBody(response);
			response = await send((await this.#accessToken(first.token)).token);
		}
		if (response.status !== tolerated) {
			assertOk(response);
		}
		discardBody(response);
		return response.status;
	}

	/** A token for this service account; `rejected` names one Google refused. */
	async #accessToken(rejected?: string): Promise<AccessToken> {
		const cached = this.#token;
		if (cached && cached.token !== rejected && Date.now() < cached.expiresAt) {
			return { token: cached.token, cached: true };
		}
		this.#exchange ??= this.#exchangeToken().finally(() => {
			this.#exchange = undefined;
		});
		return { token: await this.#exchange, cached: false };
	}

	// https://developers.google.com/identity/protocols/oauth2/service-account#httprest
	async #exchangeToken(): Promise<string> {
		const iat = Math.floor(Date.now() / 1000);
		const assertion = signJwt(
			{
				scope: WALLET_SCOPE,
				iat,
				exp: iat + 3600,
				iss: this.clientEmail,
				aud: TOKEN_URL,
			},
			this.privateKey
		);
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
		return token;
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
	return {
		...body,
		id: classId,
		...(body.reviewStatus !== undefined &&
			body.reviewStatus !== "DRAFT" && { reviewStatus: "UNDER_REVIEW" }),
	};
}
