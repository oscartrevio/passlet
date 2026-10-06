import { describe, expect, it } from "vitest";
import { Wallet } from "../../src/index";
import { appleCredentials, ICON, readPkpass } from "../support/apple";
import { googleCredentials, stubGoogleFetch } from "../support/google";

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
		const wallet = new Wallet({
			apple: appleCredentials(),
			google: googleCredentials(),
		});

		const issued = await wallet
			.generic({ id: "default-barcode", name: "Pass", apple: { icon: ICON } })
			.create({ serialNumber: "default-barcode-1", barcode: { value: "123" } });

		if (!issued.apple) {
			throw new Error("no .pkpass issued");
		}
		const { passJson } = await readPkpass(issued.apple);
		expect(passJson.barcodes).toEqual([
			expect.objectContaining({ format: "PKBarcodeFormatQR", message: "123" }),
		]);
		expect(stub.body("POST", "/genericObject")).toMatchObject({
			barcode: { type: "QR_CODE", value: "123" },
		});
	});
});
