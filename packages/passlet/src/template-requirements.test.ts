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

const icon = new Uint8Array([1, 2, 3]);
const logo = "https://cdn.example.com/logo.png";

describe("Apple icon is validated at template construction", () => {
	it("throws APPLE_MISSING_ICON when Apple credentials are set but apple.icon is not", () => {
		const wallet = new Wallet({ apple });
		expect(() =>
			wallet.generic({ id: "p1", name: "Test", fields: [] })
		).toThrow(expect.objectContaining({ code: "APPLE_MISSING_ICON" }));
	});

	it("throws for every pass type, not just one", () => {
		const wallet = new Wallet({ apple });
		expect(() => wallet.event({ id: "p1", name: "Test", fields: [] })).toThrow(
			expect.objectContaining({ code: "APPLE_MISSING_ICON" })
		);
		expect(() =>
			wallet.coupon({
				id: "p1",
				name: "Test",
				fields: [],
				redemptionChannel: "instore",
			})
		).toThrow(expect.objectContaining({ code: "APPLE_MISSING_ICON" }));
	});

	it("does not throw when apple.icon is present", () => {
		const wallet = new Wallet({ apple });
		expect(() =>
			wallet.generic({ id: "p1", name: "Test", fields: [], apple: { icon } })
		).not.toThrow();
	});

	it("does not throw when Apple credentials were omitted entirely", () => {
		const wallet = new Wallet({ google });
		expect(() =>
			wallet.generic({ id: "p1", name: "Test", fields: [] })
		).not.toThrow();
	});
});

describe("Google logo is validated at template construction", () => {
	it("throws GOOGLE_MISSING_LOGO for a loyalty pass without google.logo", () => {
		const wallet = new Wallet({ google });
		expect(() =>
			wallet.loyalty({ id: "p1", name: "Rewards", fields: [] })
		).toThrow(expect.objectContaining({ code: "GOOGLE_MISSING_LOGO" }));
	});

	it("does not throw for a loyalty pass with google.logo", () => {
		const wallet = new Wallet({ google });
		expect(() =>
			wallet.loyalty({
				id: "p1",
				name: "Rewards",
				fields: [],
				google: { logo },
			})
		).not.toThrow();
	});

	it("throws for a transit flight pass without google.logo", () => {
		const wallet = new Wallet({ google });
		expect(() =>
			wallet.flight({
				id: "p1",
				name: "Bus",
				transitType: "bus",
				fields: [],
				google: { transit: {} },
			})
		).toThrow(expect.objectContaining({ code: "GOOGLE_MISSING_LOGO" }));
	});

	it("does not throw for an air flight pass without google.logo (flightClass needs none)", () => {
		const wallet = new Wallet({ google });
		expect(() =>
			wallet.flight({
				id: "p1",
				name: "AA 100",
				transitType: "air",
				carrier: "AA",
				flightNumber: "100",
				origin: "JFK",
				destination: "LAX",
				departure: "2026-08-01T08:00:00Z",
				fields: [],
			})
		).not.toThrow();
	});

	it("does not throw when Google credentials were omitted entirely", () => {
		const wallet = new Wallet({ apple });
		expect(() =>
			wallet.loyalty({ id: "p1", name: "Rewards", fields: [], apple: { icon } })
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
