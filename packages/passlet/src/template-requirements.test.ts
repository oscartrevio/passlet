import { describe, expect, it } from "vitest";
import type { AppleCredentials, GoogleCredentials } from "./types/credentials";
import { Wallet } from "./wallet";

// Construction-time validation never touches the key material — these only need
// to be present so the provider counts as configured.
const apple: AppleCredentials = {
	passTypeIdentifier: "pass.com.example.test",
	teamId: "ABCD1234EF",
	signerCert: "-----BEGIN CERTIFICATE-----\nx\n-----END CERTIFICATE-----",
	signerKey: "-----BEGIN PRIVATE KEY-----\nx\n-----END PRIVATE KEY-----",
	wwdr: "-----BEGIN CERTIFICATE-----\nx\n-----END CERTIFICATE-----",
};

const google: GoogleCredentials = {
	clientEmail: "svc@example.iam.gserviceaccount.com",
	issuerId: "3388000000000000000",
	privateKey: "-----BEGIN PRIVATE KEY-----\nx\n-----END PRIVATE KEY-----",
};

const template = { id: "p1", name: "Test", fields: [] };
const icon = new Uint8Array([1, 2, 3]);

describe("Apple icon is validated at template construction", () => {
	it("requires an icon only when Apple credentials are configured", () => {
		const wallet = new Wallet({ apple });
		expect(() => wallet.generic(template)).toThrow(
			expect.objectContaining({ code: "APPLE_MISSING_ICON" })
		);
		expect(() =>
			wallet.generic({ ...template, apple: { icon } })
		).not.toThrow();
		expect(() => new Wallet({ google }).generic(template)).not.toThrow();
	});
});

describe("Google logo is validated at template construction", () => {
	it("requires a loyalty logo only when Google credentials are configured", () => {
		const wallet = new Wallet({ google });
		expect(() => wallet.loyalty(template)).toThrow(
			expect.objectContaining({ code: "GOOGLE_MISSING_LOGO" })
		);
		expect(() =>
			wallet.loyalty({
				...template,
				google: { logo: "https://cdn.example.com/logo.png" },
			})
		).not.toThrow();
		expect(() =>
			new Wallet({ apple }).loyalty({ ...template, apple: { icon } })
		).not.toThrow();
	});

	it("requires a logo for transit flights but not air flights", () => {
		const wallet = new Wallet({ google });
		expect(() =>
			wallet.flight({
				...template,
				transitType: "bus",
				google: { transit: {} },
			})
		).toThrow(expect.objectContaining({ code: "GOOGLE_MISSING_LOGO" }));
		expect(() =>
			wallet.flight({
				...template,
				transitType: "air",
				carrier: "AA",
				flightNumber: "100",
				origin: "JFK",
				destination: "LAX",
				departure: "2026-08-01T08:00:00Z",
			})
		).not.toThrow();
	});
});

describe("schema validation still runs first", () => {
	it("reports PASS_CONFIG_INVALID rather than a provider requirement", () => {
		const wallet = new Wallet({ apple, google });
		expect(() => wallet.loyalty({ id: "", name: "", fields: [] })).toThrow(
			expect.objectContaining({ code: "PASS_CONFIG_INVALID" })
		);
	});
});
