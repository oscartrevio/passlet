import { describe, expect, it } from "vitest";
import type { GoogleCredentials } from "../../src/schema/settings";
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
	id: "test-pass",
	name: "Test Pass",
	fields: [],
};

const template = { id: "p1", name: "Test", fields: [] };

describe("PassTemplate", () => {
	it("reports every invalid template field without exposing input values", () => {
		expect(() =>
			new Wallet({}).loyalty({
				...BASE_LOYALTY,
				id: "",
				color: "private-value",
			})
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
		const pass = new Wallet({}).loyalty(BASE_LOYALTY);
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

	// Google object IDs allow only alphanumerics, '.', '_' and '-'.
	// https://developers.google.com/wallet/reference/rest/v1/genericobject
	it("rejects serial numbers Google cannot use as an object ID, before any request", async () => {
		const pass = new Wallet({ google }).loyalty({
			...BASE_LOYALTY,
			google: { logo: LOGO_URL },
		});
		for (const serialNumber of ["user/123", "user 123", "usér", "a+b"]) {
			await expect(pass.create({ serialNumber })).rejects.toMatchObject({
				code: "CREATE_CONFIG_INVALID",
				issues: [expect.objectContaining({ path: ["serialNumber"] })],
				message: expect.not.stringContaining(serialNumber),
			});
		}
	});

	it("allows any serial number when Google is not configured", async () => {
		const pass = new Wallet({}).loyalty(BASE_LOYALTY);
		await expect(pass.create({ serialNumber: "user/123" })).resolves.toEqual({
			apple: null,
			google: null,
		});
	});

	it("returns null outputs when neither provider is configured", async () => {
		const pass = new Wallet({}).loyalty(BASE_LOYALTY);
		await expect(pass.create({ serialNumber: "serial-001" })).resolves.toEqual({
			apple: null,
			google: null,
		});
	});

	it("exposes the config it was built from", () => {
		expect(new Wallet({}).loyalty(BASE_LOYALTY).config).toEqual({
			...BASE_LOYALTY,
			type: "loyalty",
		});
	});

	it("rejects publication when Google is not configured", async () => {
		const pass = new Wallet({}).loyalty(BASE_LOYALTY);
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
			wallet.boardingPass({
				...template,
				transitType: "bus",
				google: { transit: {} },
			})
		).toThrow(expect.objectContaining({ code: "GOOGLE_MISSING_LOGO" }));
		expect(() =>
			wallet.boardingPass({
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

	// "If you specify a strip image, do not specify a background image or a
	// thumbnail." — Apple, Pass Design and Creation (event ticket images).
	it.each([
		"background",
		"thumbnail",
	] as const)("rejects an event ticket with a strip and a %s image", (image) => {
		const wallet = new Wallet({ apple });
		expect(() =>
			wallet.eventTicket({
				...template,
				apple: { icon: ICON, strip: ICON, [image]: ICON },
			})
		).toThrow(
			expect.objectContaining({
				code: "PASS_CONFIG_INVALID",
				issues: [expect.objectContaining({ path: ["apple", "strip"] })],
			})
		);
		expect(() =>
			wallet.eventTicket({ ...template, apple: { icon: ICON, strip: ICON } })
		).not.toThrow();
		expect(() =>
			wallet.eventTicket({ ...template, apple: { icon: ICON, [image]: ICON } })
		).not.toThrow();
	});

	it("reports PASS_CONFIG_INVALID before any provider requirement", () => {
		const wallet = new Wallet({ apple, google });
		expect(() => wallet.loyalty({ id: "", name: "", fields: [] })).toThrow(
			expect.objectContaining({ code: "PASS_CONFIG_INVALID" })
		);
	});
});
