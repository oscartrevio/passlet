import { describe, expect, it } from "vitest";
import { Wallet } from "../../src/index";
import { appleCredentials, ICON, readPkpass } from "../support/apple";
import {
	googleCredentials,
	LOGO_URL,
	stubGoogleFetch,
} from "../support/google";

function bothWallets() {
	return new Wallet({ apple: appleCredentials(), google: googleCredentials() });
}

async function passJsonOf(apple: Uint8Array | null) {
	if (!apple) {
		throw new Error("no .pkpass issued");
	}
	return (await readPkpass(apple)).passJson;
}

// Users leave defaulted fields out; both platforms must still see the default.
describe("Wallet applies schema defaults", () => {
	it("issues a coupon without redemptionChannel on Google as BOTH", async () => {
		const stub = stubGoogleFetch();
		const wallet = new Wallet({ google: googleCredentials() });

		await wallet
			.coupon({ id: "default-coupon", name: "10% Off", fields: [] })
			.create({ serialNumber: "default-coupon-1" });

		expect(stub.body("POST", "/offerClass")).toMatchObject({
			redemptionChannel: "BOTH",
		});
	});

	it("renders a barcode without format as QR on both platforms, with no fields given", async () => {
		const stub = stubGoogleFetch();
		const issued = await bothWallets()
			.generic({ id: "default-barcode", name: "Pass", apple: { icon: ICON } })
			.create({ serialNumber: "default-barcode-1", barcode: { value: "123" } });

		expect((await passJsonOf(issued.apple)).barcodes).toEqual([
			expect.objectContaining({ format: "PKBarcodeFormatQR", message: "123" }),
		]);
		expect(stub.body("POST", "/genericObject")).toMatchObject({
			barcode: { type: "QR_CODE", value: "123" },
		});
	});

	it("sends Google a rotating barcode and messages with their defaults", async () => {
		const stub = stubGoogleFetch();
		await new Wallet({ google: googleCredentials() })
			.generic({ id: "default-rotating", name: "Pass" })
			.create({
				serialNumber: "default-rotating-1",
				google: {
					messages: [{ header: "Hi", body: "Welcome" }],
					rotatingBarcode: {
						valuePattern: "https://example.com/{totp_value_hex}",
						totpDetails: { parameters: [{ key: "K1", valueLength: 8 }] },
					},
				},
			});

		expect(stub.body("POST", "/genericObject")).toMatchObject({
			messages: [expect.objectContaining({ messageType: "TEXT" })],
			rotatingBarcode: {
				type: "QR_CODE",
				totpDetails: { periodMillis: "30000", algorithm: "TOTP_SHA1" },
			},
		});
	});
});

describe("validated content reaches both wallets as given", () => {
	// W3C timestamps may carry a UTC offset and stop at minutes; Apple's
	// expirationDate and Google's DateTime both take them as written.
	// https://developer.apple.com/documentation/walletpasses/pass
	// https://developers.google.com/wallet/reference/rest/v1/DateTime
	it("passes an offset, minute-precision expiry through unchanged", async () => {
		const stub = stubGoogleFetch();
		const expiresAt = "2026-12-09T13:00-07:00";
		const validFrom = "2026-12-01T09:30:00+05:30";
		const issued = await bothWallets()
			.generic({
				id: "offset-dates",
				name: "Pass",
				apple: { icon: ICON },
				google: { logo: LOGO_URL },
			})
			.create({ serialNumber: "offset-dates-1", expiresAt, validFrom });

		expect((await passJsonOf(issued.apple)).expirationDate).toBe(expiresAt);
		expect(stub.body("POST", "/genericObject")).toMatchObject({
			validTimeInterval: {
				start: { date: validFrom },
				end: { date: expiresAt },
			},
		});
	});

	// pass.json copies Apple options verbatim, so only checked keys may reach it.
	it("never writes an Apple option the template types do not name", async () => {
		const issued = await new Wallet({ apple: appleCredentials() })
			.loyalty({
				id: "stripped",
				name: "Pass",
				apple: {
					icon: ICON,
					// @ts-expect-error -- not an Apple option
					webServiceURL: "https://attacker.example",
					// A boarding pass option, not a loyalty one.
					upgradeURL: "https://example.com/upgrade",
				},
			})
			.create({ serialNumber: "stripped-1" });

		const passJson = await passJsonOf(issued.apple);
		expect(passJson).not.toHaveProperty("webServiceURL");
		expect(passJson).not.toHaveProperty("upgradeURL");
	});
});
