import { describe, expect, it } from "vitest";
import { Wallet } from "../../src/wallet";
import { appleCredentials, ICON } from "../support/apple";
import { googleCredentials, LOGO_URL } from "../support/google";

// Both providers parse their keys when the Wallet is built, so the
// credentials are real test material.
const apple = appleCredentials();
const google = googleCredentials();

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

	it("names the allowed values when an option is not one of them", async () => {
		const pass = new Wallet({}).loyalty(BASE_LOYALTY);
		await expect(
			pass.create({
				serialNumber: "s-1",
				// @ts-expect-error -- an invalid barcode format
				barcode: { format: "QRCODE", value: "123" },
			})
		).rejects.toMatchObject({
			code: "CREATE_CONFIG_INVALID",
			message: expect.stringContaining(
				'barcode.format: Invalid option: expected one of "QR"|"PDF417"|'
			),
			issues: [
				{
					path: ["barcode", "format"],
					message: expect.stringContaining('"Aztec"'),
				},
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

	it("requires an Apple transitType on boarding passes", () => {
		expect(() =>
			new Wallet({ apple }).boardingPass({ ...template, apple: { icon: ICON } })
		).toThrow(
			expect.objectContaining({ code: "APPLE_BOARDING_MISSING_TRANSIT_TYPE" })
		);
	});

	// Apple ignores appLaunchURL without associated App Store IDs.
	it("requires associatedStoreIdentifiers with an Apple appLaunchURL", () => {
		const wallet = new Wallet({ apple });
		const appLaunchURL = "https://example.com/app";
		expect(() =>
			wallet.generic({ ...template, apple: { icon: ICON, appLaunchURL } })
		).toThrow(
			expect.objectContaining({
				code: "APPLE_APP_LAUNCH_URL_REQUIRES_STORE_IDS",
			})
		);
		expect(() =>
			wallet.generic({
				...template,
				apple: {
					icon: ICON,
					appLaunchURL,
					associatedStoreIdentifiers: [123_456_789],
				},
			})
		).not.toThrow();
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

	it("requires the IATA flight details on an air flight, at construction, but not on a transit pass", () => {
		const wallet = new Wallet({ google });
		const flight = {
			...template,
			transitType: "air",
			carrier: "AA",
			flightNumber: "100",
			origin: "JFK",
			destination: "LAX",
		} as const;
		expect(() => wallet.boardingPass(flight)).toThrow(
			expect.objectContaining({ code: "GOOGLE_FLIGHT_MISSING_CLASS_FIELDS" })
		);
		expect(() =>
			wallet.boardingPass({
				...flight,
				google: { logo: LOGO_URL, transit: {} },
			})
		).not.toThrow();
	});

	// A class ID is `issuerId.<template id>`, and Google allows only
	// alphanumerics, '.', '_' and '-' in the identifier.
	// https://developers.google.com/wallet/reference/rest/v1/loyaltyclass/update
	it("rejects a template id Google cannot use in a class ID only when Google is configured", () => {
		for (const id of ["rewards/2026", "rewards 2026", "récompenses"]) {
			expect(() => new Wallet({ google }).generic({ ...template, id })).toThrow(
				expect.objectContaining({
					code: "PASS_CONFIG_INVALID",
					issues: [expect.objectContaining({ path: ["id"] })],
				})
			);
			expect(() => new Wallet({}).generic({ ...template, id })).not.toThrow();
		}
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
