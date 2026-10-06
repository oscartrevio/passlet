import { describe, expect, it } from "vitest";
import type {
	AppleCredentials,
	AppleWebService,
	PassRegistrations,
} from "../../src/index";
import { Wallet } from "../../src/wallet";
import {
	PASS_TYPE_IDENTIFIER,
	TEAM_ID,
	UNSIGNED_APPLE_CREDENTIALS,
} from "../support/apple";

const SECRET = "s".repeat(32);

const registrations: PassRegistrations = {
	add: () => Promise.resolve(true),
	devices: () => Promise.resolve([]),
	remove: () => Promise.resolve(),
	serialNumbers: () => Promise.resolve([]),
};

function webService(overrides: Partial<AppleWebService> = {}): AppleWebService {
	return {
		url: "https://example.com/wallet",
		secret: SECRET,
		registrations,
		...overrides,
	};
}

function appleWith(
	service: AppleWebService,
	apple: AppleCredentials = UNSIGNED_APPLE_CREDENTIALS
): AppleCredentials {
	return { ...apple, webService: service };
}

const load = () => null;

describe("apple.webService validation", () => {
	it.each([
		["a relative url", webService({ url: "/wallet" })],
		["a non-http url", webService({ url: "ftp://example.com/wallet" })],
		["no secret", webService({ secret: undefined as unknown as string })],
		["a short secret", webService({ secret: "too-short" })],
	])("rejects %s with APPLE_WEB_SERVICE_INVALID", (_, service) => {
		expect(() => new Wallet({ apple: appleWith(service), load })).toThrow(
			expect.objectContaining({ code: "APPLE_WEB_SERVICE_INVALID" })
		);
	});

	it("never puts a secret in the error", () => {
		const short = "leaky-secret";
		expect(
			() =>
				new Wallet({
					apple: appleWith(webService({ secret: short })),
					load,
				})
		).toThrow(
			expect.objectContaining({ message: expect.not.stringContaining(short) })
		);
	});

	// APNs authenticates with the private key over TLS, which an external
	// signer never hands over.
	it("requires push credentials with an external signer", () => {
		const signed: AppleCredentials = {
			passTypeIdentifier: PASS_TYPE_IDENTIFIER,
			teamId: TEAM_ID,
			signerCert: "unused",
			wwdr: "unused",
			signer: { sign: () => new Uint8Array() },
		};
		expect(
			() => new Wallet({ apple: appleWith(webService(), signed), load })
		).toThrow(expect.objectContaining({ code: "APPLE_WEB_SERVICE_INVALID" }));
		expect(
			() =>
				new Wallet({
					apple: appleWith(
						webService({ push: { cert: "cert", key: "key" } }),
						signed
					),
					load,
				})
		).not.toThrow();
	});

	it("requires load, which the web service renders passes from", () => {
		expect(() => new Wallet({ apple: appleWith(webService()) })).toThrow(
			expect.objectContaining({ code: "UPDATES_NOT_CONFIGURED" })
		);
	});

	it("accepts an http url for development", () => {
		expect(
			() =>
				new Wallet({
					apple: appleWith(webService({ url: "http://localhost:3000/wallet" })),
					load,
				})
		).not.toThrow();
	});
});

describe("wallet.handler", () => {
	it("answers 404 to everything without apple.webService", async () => {
		const { handler } = new Wallet({ apple: UNSIGNED_APPLE_CREDENTIALS });
		const response = await handler(
			new Request("https://example.com/wallet/v1/log", {
				method: "POST",
				body: JSON.stringify({ logs: ["x"] }),
			})
		);
		expect(response.status).toBe(404);
	});
});

describe("wallet.update", () => {
	it("needs load", async () => {
		await expect(new Wallet({}).update("serial-001")).rejects.toMatchObject({
			code: "UPDATES_NOT_CONFIGURED",
		});
	});

	it("reports a pass load cannot find", async () => {
		await expect(
			new Wallet({ load }).update("serial-001")
		).rejects.toMatchObject({ code: "PASS_NOT_FOUND", status: 404 });
	});
});
