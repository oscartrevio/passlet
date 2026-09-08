import { describe, expect, it } from "vitest";
import { Pass } from "../../src/pass";
import type { GoogleCredentials } from "../../src/types/credentials";
import { Wallet } from "../../src/wallet";
import { UNSIGNED_APPLE_CREDENTIALS as apple, ICON } from "../support/apple";
import { CLIENT_EMAIL, ISSUER_ID, LOGO_URL } from "../support/google";

// Construction-time validation never touches the key material — it only has
// to be present so the provider counts as configured.
const google: GoogleCredentials = {
	clientEmail: CLIENT_EMAIL,
	issuerId: ISSUER_ID,
	privateKey: "unused",
};

const BASE_LOYALTY = {
	type: "loyalty" as const,
	id: "test-pass",
	name: "Test Pass",
	fields: [],
};

const template = { id: "p1", name: "Test", fields: [] };

describe("Pass", () => {
	it("reports every invalid template field without exposing input values", () => {
		expect(
			() => new Pass({ ...BASE_LOYALTY, id: "", color: "private-value" }, {})
		).toThrow(
			expect.objectContaining({
				code: "PASS_CONFIG_INVALID",
				status: 400,
				issues: [
					expect.objectContaining({ path: ["id"] }),
					expect.objectContaining({ path: ["color"] }),
				],
				message: expect.not.stringContaining("private-value"),
			})
		);
	});

	it("reports nested recipient validation paths", async () => {
		const pass = new Pass(BASE_LOYALTY, {});
		await expect(
			pass.create({ serialNumber: "", barcode: { format: "QR", value: "" } })
		).rejects.toMatchObject({
			code: "CREATE_CONFIG_INVALID",
			status: 400,
			issues: [
				expect.objectContaining({ path: ["serialNumber"] }),
				expect.objectContaining({ path: ["barcode", "value"] }),
			],
		});
	});

	it("returns null outputs and no warnings when neither provider is configured", async () => {
		const pass = new Pass(BASE_LOYALTY, {});
		await expect(pass.create({ serialNumber: "serial-001" })).resolves.toEqual({
			apple: null,
			google: null,
			warnings: [],
		});
	});

	it("rejects publication when Google is not configured", async () => {
		const pass = new Pass(BASE_LOYALTY, {});
		await expect(pass.publish()).rejects.toMatchObject({
			code: "GOOGLE_NOT_CONFIGURED",
			status: 500,
		});
	});
});

describe("template requirements", () => {
	it("requires an Apple icon only when Apple credentials are configured", () => {
		const wallet = new Wallet({ apple });
		expect(() => wallet.generic(template)).toThrow(
			expect.objectContaining({ code: "APPLE_MISSING_ICON" })
		);
		expect(() =>
			wallet.generic({ ...template, apple: { icon: ICON } })
		).not.toThrow();
		expect(() => new Wallet({ google }).generic(template)).not.toThrow();
	});

	it("requires a Google logo for loyalty passes only when Google credentials are configured", () => {
		const wallet = new Wallet({ google });
		expect(() => wallet.loyalty(template)).toThrow(
			expect.objectContaining({ code: "GOOGLE_MISSING_LOGO" })
		);
		expect(() =>
			wallet.loyalty({ ...template, google: { logo: LOGO_URL } })
		).not.toThrow();
		expect(() =>
			new Wallet({ apple }).loyalty({ ...template, apple: { icon: ICON } })
		).not.toThrow();
	});

	it("requires a Google logo for transit flights but not air flights", () => {
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

	it("reports PASS_CONFIG_INVALID before any provider requirement", () => {
		const wallet = new Wallet({ apple, google });
		expect(() => wallet.loyalty({ id: "", name: "", fields: [] })).toThrow(
			expect.objectContaining({ code: "PASS_CONFIG_INVALID" })
		);
	});
});
