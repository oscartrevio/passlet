import { SignJWT } from "jose";
import { beforeAll, describe, expect, it, onTestFinished, vi } from "vitest";
import { WalletError } from "../../../src/errors";
import {
	deleteObject,
	ensureClass,
	importGoogleKey,
	patchObject,
	publishClass,
} from "../../../src/providers/google/api";
import type { GoogleCredentials } from "../../../src/types/credentials";
import {
	type GoogleFetchStub,
	googleCredentials,
	ISSUER_ID,
	stubGoogleFetch,
} from "../../support/google";

const CLASS_ID = `${ISSUER_ID}.api-class`;
const OBJECT_ID = `${ISSUER_ID}.api-object`;
const credentials = googleCredentials();
let privateKey: CryptoKey;

beforeAll(async () => {
	privateKey = await importGoogleKey(credentials);
});

function googleError(status: number, message: string): Response {
	return Response.json({ error: { code: status, message } }, { status });
}

/** `[method, path, body]` of every Wallet request, in order. */
function calls(stub: GoogleFetchStub): unknown[][] {
	return stub.requests.map((r) => [r.method, r.path, r.body]);
}

describe("ensureClass", () => {
	it("creates the class when Google has none", async () => {
		const stub = stubGoogleFetch();
		await ensureClass(
			"loyaltyClass",
			CLASS_ID,
			{ issuerName: "Acme" },
			credentials,
			privateKey
		);
		expect(calls(stub)).toEqual([
			["GET", `/loyaltyClass/${CLASS_ID}`, undefined],
			["POST", "/loyaltyClass", { id: CLASS_ID, issuerName: "Acme" }],
		]);
	});

	it("leaves an existing shared class untouched", async () => {
		const stub = stubGoogleFetch(() =>
			Response.json({
				id: CLASS_ID,
				issuerName: "Managed in the console",
				reviewStatus: "APPROVED",
			})
		);
		await ensureClass(
			"loyaltyClass",
			CLASS_ID,
			{ issuerName: "Older local template", reviewStatus: "UNDER_REVIEW" },
			credentials,
			privateKey
		);
		expect(calls(stub)).toEqual([
			["GET", `/loyaltyClass/${CLASS_ID}`, undefined],
		]);
	});

	it("rejects a class payload that is not an object", async () => {
		const stub = stubGoogleFetch(() => Response.json([]));
		await expect(
			ensureClass("loyaltyClass", CLASS_ID, {}, credentials, privateKey)
		).rejects.toMatchObject({
			code: "GOOGLE_INVALID_RESPONSE",
			status: 502,
		});
		expect(calls(stub)).toEqual([
			["GET", `/loyaltyClass/${CLASS_ID}`, undefined],
		]);
	});

	it("surfaces a failed lookup without attempting class creation", async () => {
		const stub = stubGoogleFetch(() => googleError(500, "Backend Error"));
		await expect(
			ensureClass("loyaltyClass", CLASS_ID, {}, credentials, privateKey)
		).rejects.toMatchObject({
			code: "GOOGLE_UNAVAILABLE",
			status: 500,
		});
		expect(calls(stub)).toEqual([
			["GET", `/loyaltyClass/${CLASS_ID}`, undefined],
		]);
	});

	it("reports a creation conflict instead of overwriting the class", async () => {
		const stub = stubGoogleFetch(({ method }) =>
			method === "POST" ? googleError(409, "Already exists") : undefined
		);
		await expect(
			ensureClass("loyaltyClass", CLASS_ID, {}, credentials, privateKey)
		).rejects.toMatchObject({
			code: "GOOGLE_CONFLICT",
			status: 409,
		});
		expect(calls(stub)).toEqual([
			["GET", `/loyaltyClass/${CLASS_ID}`, undefined],
			["POST", "/loyaltyClass", { id: CLASS_ID }],
		]);
	});
});

describe("publishClass", () => {
	it("creates a missing class", async () => {
		const stub = stubGoogleFetch();
		await publishClass(
			"loyaltyClass",
			CLASS_ID,
			{ issuerName: "Acme" },
			credentials,
			privateKey
		);
		expect(calls(stub)).toEqual([
			["GET", `/loyaltyClass/${CLASS_ID}`, undefined],
			["POST", "/loyaltyClass", { id: CLASS_ID, issuerName: "Acme" }],
		]);
	});

	// Google rejects updates unless reviewStatus is UNDER_REVIEW or DRAFT.
	it.each([
		{ existing: "APPROVED", sent: "UNDER_REVIEW" },
		{ existing: "DRAFT", sent: "DRAFT" },
	])("publishes over an $existing class as $sent while preserving remote attributes", async ({
		existing,
		sent,
	}) => {
		const stub = stubGoogleFetch(({ method }) =>
			method === "GET"
				? Response.json({
						id: CLASS_ID,
						issuerName: "Stale",
						enableSmartTap: true,
						reviewStatus: existing,
					})
				: undefined
		);
		await publishClass(
			"loyaltyClass",
			CLASS_ID,
			{ issuerName: "Acme" },
			credentials,
			privateKey
		);
		expect(calls(stub)).toEqual([
			["GET", `/loyaltyClass/${CLASS_ID}`, undefined],
			[
				"PUT",
				`/loyaltyClass/${CLASS_ID}`,
				{
					id: CLASS_ID,
					issuerName: "Acme",
					enableSmartTap: true,
					reviewStatus: sent,
				},
			],
		]);
	});

	it("honors an explicitly requested draft over the remote review status", async () => {
		const stub = stubGoogleFetch(({ method }) =>
			method === "GET"
				? Response.json({ id: CLASS_ID, reviewStatus: "APPROVED" })
				: undefined
		);
		await publishClass(
			"loyaltyClass",
			CLASS_ID,
			{ reviewStatus: "DRAFT" },
			credentials,
			privateKey
		);
		expect(stub.body("PUT", CLASS_ID)).toEqual({
			id: CLASS_ID,
			reviewStatus: "DRAFT",
		});
	});

	it("refuses to publish a response identifying a different class", async () => {
		const stub = stubGoogleFetch(() =>
			Response.json({ id: `${ISSUER_ID}.different-class` })
		);
		await expect(
			publishClass("loyaltyClass", CLASS_ID, {}, credentials, privateKey)
		).rejects.toMatchObject({
			code: "GOOGLE_INVALID_RESPONSE",
			status: 502,
		});
		expect(calls(stub)).toEqual([
			["GET", `/loyaltyClass/${CLASS_ID}`, undefined],
		]);
	});

	it("does not expose malformed class JSON through parser errors", async () => {
		const secret = "private-key-or-signed-image-url";
		const stub = stubGoogleFetch(
			() => new Response(secret, { headers: { "Retry-After": "2" } })
		);
		const error = await publishClass(
			"loyaltyClass",
			CLASS_ID,
			{},
			credentials,
			privateKey
		).catch((cause: unknown) => cause);
		expect(error).toBeInstanceOf(WalletError);
		expect(error).toMatchObject({
			code: "GOOGLE_INVALID_RESPONSE",
			status: 502,
			retryAfter: 2,
		});
		expect(error).not.toHaveProperty("cause");
		expect(String(error)).not.toContain(secret);
		expect(JSON.stringify(error)).not.toContain(secret);
		expect(calls(stub)).toEqual([
			["GET", `/loyaltyClass/${CLASS_ID}`, undefined],
		]);
	});
});

describe("deleteObject", () => {
	it("treats a missing object as already deleted but surfaces other failures", async () => {
		const stub = stubGoogleFetch(({ path }) => {
			if (path.endsWith(".gone")) {
				return new Response("", { status: 404 });
			}
			if (path.endsWith(".locked")) {
				return googleError(403, "The caller does not have permission");
			}
			return;
		});
		await expect(
			deleteObject(
				"loyaltyObject",
				`${ISSUER_ID}.gone`,
				credentials,
				privateKey
			)
		).resolves.toBeUndefined();
		await expect(
			deleteObject(
				"loyaltyObject",
				`${ISSUER_ID}.locked`,
				credentials,
				privateKey
			)
		).rejects.toMatchObject({
			code: "GOOGLE_ACCESS_DENIED",
			status: 403,
		});
		expect(calls(stub)).toEqual([
			["DELETE", `/loyaltyObject/${ISSUER_ID}.gone`, undefined],
			["DELETE", `/loyaltyObject/${ISSUER_ID}.locked`, undefined],
		]);
	});
});

describe("patchObject", () => {
	// notifyPreference is a body field, not a query parameter, and Google only
	// honours it on the request that carries it.
	it("asks for an update notification in the body only when requested", async () => {
		const stub = stubGoogleFetch();
		const patch = { state: "EXPIRED" };
		await patchObject(
			"loyaltyObject",
			OBJECT_ID,
			patch,
			credentials,
			privateKey,
			{ notify: true }
		);
		await patchObject(
			"loyaltyObject",
			OBJECT_ID,
			patch,
			credentials,
			privateKey
		);
		expect(calls(stub)).toEqual([
			[
				"PATCH",
				`/loyaltyObject/${OBJECT_ID}`,
				{ state: "EXPIRED", notifyPreference: "NOTIFY_ON_UPDATE" },
			],
			["PATCH", `/loyaltyObject/${OBJECT_ID}`, { state: "EXPIRED" }],
		]);
	});

	it.each([
		{ status: 400, code: "GOOGLE_API_ERROR" },
		{ status: 401, code: "GOOGLE_AUTH_FAILED" },
		{ status: 403, code: "GOOGLE_ACCESS_DENIED" },
		{ status: 404, code: "GOOGLE_NOT_FOUND" },
		{ status: 409, code: "GOOGLE_CONFLICT" },
		{ status: 429, code: "GOOGLE_RATE_LIMITED" },
		{ status: 503, code: "GOOGLE_UNAVAILABLE" },
	])("classifies HTTP $status as $code", async ({ status, code }) => {
		stubGoogleFetch(() => googleError(status, "Provider diagnostic"));
		await expect(
			patchObject(
				"loyaltyObject",
				OBJECT_ID,
				{ state: "EXPIRED" },
				credentials,
				privateKey
			)
		).rejects.toMatchObject({ code, status });
	});
});

describe("Google failures", () => {
	it.each([
		{ label: "delay seconds", value: "75", expected: 75 },
		{
			label: "HTTP date",
			value: "Mon, 07 Sep 2026 12:01:15 GMT",
			expected: 75,
		},
		{
			label: "past HTTP date",
			value: "Mon, 07 Sep 2026 11:00:00 GMT",
			expected: 0,
		},
		{ label: "invalid negative delay", value: "-1", expected: undefined },
	])("exposes Retry-After $label in seconds", async ({ value, expected }) => {
		const clock = vi
			.spyOn(Date, "now")
			.mockReturnValue(Date.UTC(2026, 8, 7, 12));
		onTestFinished(() => {
			clock.mockRestore();
		});
		stubGoogleFetch(
			() =>
				new Response("Busy", {
					status: 429,
					headers: { "Retry-After": value },
				})
		);
		await expect(
			patchObject("loyaltyObject", OBJECT_ID, {}, credentials, privateKey)
		).rejects.toMatchObject({
			code: "GOOGLE_RATE_LIMITED",
			status: 429,
			retryAfter: expected,
		});
	});

	it.each([
		"json",
		"text",
	])("does not echo untrusted %s error bodies or store them as causes", async (format) => {
		const secret = "private-key-or-signed-image-url";
		stubGoogleFetch(() =>
			format === "json"
				? googleError(400, secret)
				: new Response(secret, { status: 400 })
		);
		const error = await patchObject(
			"loyaltyObject",
			OBJECT_ID,
			{},
			credentials,
			privateKey
		).catch((cause: unknown) => cause);
		expect(error).toBeInstanceOf(WalletError);
		expect(error).toMatchObject({ code: "GOOGLE_API_ERROR", status: 400 });
		expect(error).not.toHaveProperty("cause");
		expect(String(error)).not.toContain(secret);
		expect(JSON.stringify(error)).not.toContain(secret);
	});

	it.each([
		"oauth",
		"wallet",
	])("preserves the Error cause of an %s transport failure", async (endpoint) => {
		const cause = new TypeError("Connection reset");
		const fail = () => {
			throw cause;
		};
		stubGoogleFetch(endpoint === "wallet" ? fail : undefined, {
			token: endpoint === "oauth" ? fail : undefined,
		});
		const scoped = googleCredentials({
			clientEmail: `network-${endpoint}@test-project.iam.gserviceaccount.com`,
		});
		await expect(
			deleteObject("loyaltyObject", OBJECT_ID, scoped, privateKey)
		).rejects.toMatchObject({ code: "GOOGLE_NETWORK_ERROR", cause });
	});

	it("preserves a transport failure while reading a class response", async () => {
		const cause = new TypeError("Connection closed during response");
		stubGoogleFetch(
			() =>
				new Response(
					new ReadableStream({
						start(controller) {
							controller.error(cause);
						},
					})
				)
		);
		await expect(
			publishClass("loyaltyClass", CLASS_ID, {}, credentials, privateKey)
		).rejects.toMatchObject({
			code: "GOOGLE_NETWORK_ERROR",
			status: 502,
			cause,
		});
	});

	it("normalizes a missing runtime PEM instead of leaking a TypeError", async () => {
		const missing = {
			...credentials,
			privateKey: undefined,
		} as unknown as GoogleCredentials;
		await expect(importGoogleKey(missing)).rejects.toMatchObject({
			code: "GOOGLE_INVALID_PRIVATE_KEY",
			cause: expect.any(Error),
		});
	});
});

describe("access token", () => {
	it("exchanges one token per credentials and sends it as a bearer on every request", async () => {
		const stub = stubGoogleFetch();
		const shared = googleCredentials({
			clientEmail: "cache@test-project.iam.gserviceaccount.com",
		});
		await deleteObject("loyaltyObject", OBJECT_ID, shared, privateKey);
		await deleteObject("loyaltyObject", OBJECT_ID, shared, privateKey);
		expect(stub.tokenRequests).toBe(1);
		expect(stub.requests.map((r) => r.headers.authorization)).toEqual([
			"Bearer test-token",
			"Bearer test-token",
		]);
	});

	it("classifies a rejected OAuth assertion without echoing its diagnostics", async () => {
		const secret = "secret-jwt-assertion";
		const stub = stubGoogleFetch(undefined, {
			token: () =>
				Response.json(
					{ error: "invalid_grant", error_description: secret },
					{ status: 400 }
				),
		});
		const revoked = googleCredentials({
			clientEmail: "revoked@test-project.iam.gserviceaccount.com",
		});
		const error = await deleteObject(
			"loyaltyObject",
			OBJECT_ID,
			revoked,
			privateKey
		).catch((cause: unknown) => cause);
		expect(error).toBeInstanceOf(WalletError);
		expect(error).toMatchObject({ code: "GOOGLE_AUTH_FAILED", status: 400 });
		expect(error).not.toHaveProperty("cause");
		expect(String(error)).not.toContain(secret);
		expect(JSON.stringify(error)).not.toContain(secret);
		expect(stub.requests).toEqual([]);
	});

	it.each([
		{ label: "json", body: "secret-invalid-json" },
		{ label: "missing", body: "{}" },
		{ label: "type", body: '{"access_token":123}' },
		{
			label: "whitespace",
			body: JSON.stringify({ access_token: "token\r\ninjected: secret" }),
		},
	])("never caches a malformed $label token response", async ({
		label,
		body,
	}) => {
		let first = true;
		const stub = stubGoogleFetch(undefined, {
			token: () => {
				if (first) {
					first = false;
					return new Response(body);
				}
				return Response.json({ access_token: "recovered-token" });
			},
		});
		const scoped = googleCredentials({
			clientEmail: `malformed-${label}@test-project.iam.gserviceaccount.com`,
		});
		const error = await deleteObject(
			"loyaltyObject",
			OBJECT_ID,
			scoped,
			privateKey
		).catch((cause: unknown) => cause);
		expect(error).toBeInstanceOf(WalletError);
		expect(error).toMatchObject({
			code: "GOOGLE_INVALID_RESPONSE",
			status: 502,
		});
		expect(error).not.toHaveProperty("cause");
		expect(String(error)).not.toContain(body);
		expect(JSON.stringify(error)).not.toContain(body);
		expect(stub.requests).toEqual([]);

		await deleteObject("loyaltyObject", OBJECT_ID, scoped, privateKey);
		expect(stub.tokenRequests).toBe(2);
		expect(
			stub.requests.map((request) => request.headers.authorization)
		).toEqual(["Bearer recovered-token"]);
	});

	it("normalizes OAuth assertion signing failures before sending credentials", async () => {
		const cause = new Error("Signing unavailable");
		const sign = vi
			.spyOn(SignJWT.prototype, "sign")
			.mockRejectedValueOnce(cause);
		onTestFinished(() => {
			sign.mockRestore();
		});
		const stub = stubGoogleFetch();
		const scoped = googleCredentials({
			clientEmail: "oauth-signing@test-project.iam.gserviceaccount.com",
		});
		await expect(
			deleteObject("loyaltyObject", OBJECT_ID, scoped, privateKey)
		).rejects.toMatchObject({ code: "GOOGLE_SIGNING_FAILED", cause });
		expect(stub.tokenRequests).toBe(0);
		expect(stub.requests).toEqual([]);
	});
});
