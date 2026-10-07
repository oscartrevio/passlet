import { beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { WalletError } from "../../../src/errors";
import { GoogleClient } from "../../../src/google/client";
import { signJwt } from "../../../src/google/jwt";
import type { GoogleCredentials } from "../../../src/schema/settings";
import {
	type GoogleFetchStub,
	googleCredentials,
	ISSUER_ID,
	stubGoogleFetch,
} from "../../support/google";

vi.mock("../../../src/google/jwt", async (importOriginal) => {
	const actual = await importOriginal<{ signJwt: typeof signJwt }>();
	return { signJwt: vi.fn(actual.signJwt) };
});

const CLASS_ID = `${ISSUER_ID}.api-class`;
const OBJECT_ID = `${ISSUER_ID}.api-object`;
const credentials = googleCredentials();
let client: GoogleClient;

// A client per test, so no test reuses another's access token.
beforeEach(() => {
	client = new GoogleClient(credentials);
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
		await client.ensureClass("loyaltyClass", CLASS_ID, { issuerName: "Acme" });
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
		await client.ensureClass("loyaltyClass", CLASS_ID, {
			issuerName: "Older local template",
			reviewStatus: "UNDER_REVIEW",
		});
		expect(calls(stub)).toEqual([
			["GET", `/loyaltyClass/${CLASS_ID}`, undefined],
		]);
	});

	it("rejects a class payload that is not an object", async () => {
		const stub = stubGoogleFetch(() => Response.json([]));
		await expect(
			client.ensureClass("loyaltyClass", CLASS_ID, {})
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
			client.ensureClass("loyaltyClass", CLASS_ID, {})
		).rejects.toMatchObject({
			code: "GOOGLE_UNAVAILABLE",
			status: 500,
		});
		expect(calls(stub)).toEqual([
			["GET", `/loyaltyClass/${CLASS_ID}`, undefined],
		]);
	});

	// Two issues from a new template can both find the class missing; the
	// later insert answers 409 because the class now exists.
	it("accepts a creation conflict as the class another issue just created", async () => {
		const stub = stubGoogleFetch(({ method }) =>
			method === "POST" ? googleError(409, "Already exists") : undefined
		);
		await expect(
			client.ensureClass("loyaltyClass", CLASS_ID, {})
		).resolves.toBeUndefined();
		expect(calls(stub)).toEqual([
			["GET", `/loyaltyClass/${CLASS_ID}`, undefined],
			["POST", "/loyaltyClass", { id: CLASS_ID }],
		]);
	});

	// "This field can be set to draft or underReview using the insert, patch,
	// or update API calls."
	// https://developers.google.com/wallet/reference/rest/v1/loyaltyclass
	it.each([
		{ requested: "APPROVED", sent: "UNDER_REVIEW" },
		{ requested: "REJECTED", sent: "UNDER_REVIEW" },
		{ requested: "DRAFT", sent: "DRAFT" },
	])("creates a class requested as $requested with reviewStatus $sent", async ({
		requested,
		sent,
	}) => {
		const stub = stubGoogleFetch();
		await client.ensureClass("loyaltyClass", CLASS_ID, {
			reviewStatus: requested,
		});
		await client.publishClass("loyaltyClass", CLASS_ID, {
			reviewStatus: requested,
		});
		expect(
			stub.requests
				.filter((r) => r.method === "POST")
				.map((r) => r.body?.reviewStatus)
		).toEqual([sent, sent]);
	});
});

describe("publishClass", () => {
	it("creates a missing class", async () => {
		const stub = stubGoogleFetch();
		await client.publishClass("loyaltyClass", CLASS_ID, { issuerName: "Acme" });
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
		await client.publishClass("loyaltyClass", CLASS_ID, { issuerName: "Acme" });
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
		await client.publishClass("loyaltyClass", CLASS_ID, {
			reviewStatus: "DRAFT",
		});
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
			client.publishClass("loyaltyClass", CLASS_ID, {})
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
		const error = await client
			.publishClass("loyaltyClass", CLASS_ID, {})
			.catch((cause: unknown) => cause);
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

describe("patchObject", () => {
	// notifyPreference is a body field, not a query parameter, and Google only
	// honours it on the request that carries it.
	it("asks for an update notification in the body only when requested", async () => {
		const stub = stubGoogleFetch();
		const patch = { state: "EXPIRED" };
		await client.patchObject("loyaltyObject", OBJECT_ID, patch, {
			notify: true,
		});
		await client.patchObject("loyaltyObject", OBJECT_ID, patch);
		expect(calls(stub)).toEqual([
			[
				"PATCH",
				`/loyaltyObject/${OBJECT_ID}`,
				{ state: "EXPIRED", notifyPreference: "NOTIFY_ON_UPDATE" },
			],
			["PATCH", `/loyaltyObject/${OBJECT_ID}`, { state: "EXPIRED" }],
		]);
	});

	// Google merges a PATCH into the stored object, nested objects included,
	// so an omitted field would keep its old value; null clears it.
	it("sends undefined fields as null, inside nested objects but not lists", async () => {
		const stub = stubGoogleFetch();
		await client.patchObject("loyaltyObject", OBJECT_ID, {
			state: "ACTIVE",
			loyaltyPoints: undefined,
			barcode: { type: "QR_CODE", value: "1", alternateText: undefined },
			textModulesData: [{ header: "Tier", body: "Gold", id: undefined }],
		});
		expect(stub.body("PATCH", OBJECT_ID)).toStrictEqual({
			state: "ACTIVE",
			loyaltyPoints: null,
			barcode: { type: "QR_CODE", value: "1", alternateText: null },
			textModulesData: [{ header: "Tier", body: "Gold" }],
		});
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
			client.patchObject("loyaltyObject", OBJECT_ID, { state: "EXPIRED" })
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
			client.patchObject("loyaltyObject", OBJECT_ID, {})
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
		const error = await client
			.patchObject("loyaltyObject", OBJECT_ID, {})
			.catch((cause: unknown) => cause);
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
		await expect(
			client.patchObject("loyaltyObject", OBJECT_ID, {})
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
			client.publishClass("loyaltyClass", CLASS_ID, {})
		).rejects.toMatchObject({
			code: "GOOGLE_NETWORK_ERROR",
			status: 502,
			cause,
		});
	});

	it("normalizes a missing runtime PEM instead of leaking a TypeError", () => {
		const missing = {
			...credentials,
			privateKey: undefined,
		} as unknown as GoogleCredentials;
		expect(() => new GoogleClient(missing)).toThrow(
			expect.objectContaining({
				code: "GOOGLE_INVALID_PRIVATE_KEY",
				cause: expect.any(Error),
			})
		);
	});
});

describe("inside Next.js", () => {
	// Next.js's patched fetch returns one tee() branch of every body and never
	// reads the other, so cancelling the returned body never settles.
	const unreadBranches: ReadableStream[] = [];
	function nextJsResponse(response: Response): Response {
		if (!response.body) {
			return response;
		}
		const [body, unread] = response.body.tee();
		unreadBranches.push(unread);
		return new Response(body, {
			status: response.status,
			headers: response.headers,
		});
	}

	it("creates a missing class", async () => {
		const stub = stubGoogleFetch(({ method }) =>
			nextJsResponse(
				method === "GET" ? new Response("", { status: 404 }) : Response.json({})
			)
		);
		await client.ensureClass("loyaltyClass", CLASS_ID, {});
		expect(calls(stub)).toEqual([
			["GET", `/loyaltyClass/${CLASS_ID}`, undefined],
			["POST", "/loyaltyClass", { id: CLASS_ID }],
		]);
	});

	it("patches an object", async () => {
		stubGoogleFetch(() => nextJsResponse(Response.json({})));
		await expect(
			client.patchObject("loyaltyObject", OBJECT_ID, {})
		).resolves.toBeUndefined();
	});

	it("surfaces a Google failure", async () => {
		stubGoogleFetch(() => nextJsResponse(googleError(400, "Invalid")));
		await expect(
			client.patchObject("loyaltyObject", OBJECT_ID, {})
		).rejects.toMatchObject({ code: "GOOGLE_API_ERROR", status: 400 });
	});
});

describe("access token", () => {
	it("exchanges one token per credentials and sends it as a bearer on every request", async () => {
		const stub = stubGoogleFetch();
		await client.patchObject("loyaltyObject", OBJECT_ID, {});
		await client.patchObject("loyaltyObject", OBJECT_ID, {});
		expect(stub.tokenRequests).toBe(1);
		expect(stub.requests.map((r) => r.headers.authorization)).toEqual([
			"Bearer test-token",
			"Bearer test-token",
		]);
	});

	// "Access tokens can be reused during the duration window specified by the
	// expires_in value."
	// https://developers.google.com/identity/protocols/oauth2/service-account
	it("reuses a token only until shortly before its expires_in", async () => {
		vi.useFakeTimers({ toFake: ["Date"] });
		onTestFinished(() => {
			vi.useRealTimers();
		});
		const stub = stubGoogleFetch(undefined, {
			token: () =>
				Response.json({ access_token: "hour-token", expires_in: 3600 }),
		});
		await client.patchObject("loyaltyObject", OBJECT_ID, {});
		vi.advanceTimersByTime(50 * 60 * 1000);
		await client.patchObject("loyaltyObject", OBJECT_ID, {});
		expect(stub.tokenRequests).toBe(1);
		vi.advanceTimersByTime(6 * 60 * 1000);
		await client.patchObject("loyaltyObject", OBJECT_ID, {});
		expect(stub.tokenRequests).toBe(2);
	});

	it("does not reuse a token whose response has no expires_in", async () => {
		const stub = stubGoogleFetch(undefined, {
			token: () => Response.json({ access_token: "once-token" }),
		});
		await client.patchObject("loyaltyObject", OBJECT_ID, {});
		await client.patchObject("loyaltyObject", OBJECT_ID, {});
		expect(stub.tokenRequests).toBe(2);
	});

	it("replaces a cached token Google rejects and retries the request once", async () => {
		let issued = 0;
		let revoked = false;
		const stub = stubGoogleFetch(
			({ headers }) =>
				revoked && headers.authorization === "Bearer token-1"
					? googleError(401, "Invalid Credentials")
					: undefined,
			{
				token: () => {
					issued += 1;
					return Response.json({
						access_token: `token-${issued}`,
						expires_in: 3600,
					});
				},
			}
		);
		await client.patchObject("loyaltyObject", OBJECT_ID, {});
		revoked = true;
		await client.patchObject("loyaltyObject", OBJECT_ID, {});
		await client.patchObject("loyaltyObject", OBJECT_ID, {});
		expect(stub.tokenRequests).toBe(2);
		expect(stub.requests.map((r) => r.headers.authorization)).toEqual([
			"Bearer token-1",
			"Bearer token-1",
			"Bearer token-2",
			"Bearer token-2",
		]);
	});

	it("does not retry when Google rejects a freshly exchanged token", async () => {
		const stub = stubGoogleFetch(() => googleError(401, "Invalid Credentials"));
		await expect(
			client.patchObject("loyaltyObject", OBJECT_ID, {})
		).rejects.toMatchObject({ code: "GOOGLE_AUTH_FAILED", status: 401 });
		expect(stub.tokenRequests).toBe(1);
		expect(stub.requests).toHaveLength(1);
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
		const error = await client
			.patchObject("loyaltyObject", OBJECT_ID, {})
			.catch((cause: unknown) => cause);
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
	])("never caches a malformed $label token response", async ({ body }) => {
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
		const error = await client
			.patchObject("loyaltyObject", OBJECT_ID, {})
			.catch((cause: unknown) => cause);
		expect(error).toBeInstanceOf(WalletError);
		expect(error).toMatchObject({
			code: "GOOGLE_INVALID_RESPONSE",
			status: 502,
		});
		expect(error).not.toHaveProperty("cause");
		expect(String(error)).not.toContain(body);
		expect(JSON.stringify(error)).not.toContain(body);
		expect(stub.requests).toEqual([]);

		await client.patchObject("loyaltyObject", OBJECT_ID, {});
		expect(stub.tokenRequests).toBe(2);
		expect(
			stub.requests.map((request) => request.headers.authorization)
		).toEqual(["Bearer recovered-token"]);
	});

	it("normalizes OAuth assertion signing failures before sending credentials", async () => {
		const cause = new Error("Signing unavailable");
		vi.mocked(signJwt).mockImplementationOnce(() => {
			throw cause;
		});
		const stub = stubGoogleFetch();
		await expect(
			client.patchObject("loyaltyObject", OBJECT_ID, {})
		).rejects.toMatchObject({ code: "GOOGLE_SIGNING_FAILED", cause });
		expect(stub.tokenRequests).toBe(0);
		expect(stub.requests).toEqual([]);
	});
});
