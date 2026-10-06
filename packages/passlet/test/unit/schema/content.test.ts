import { describe, expect, it } from "vitest";
import { passContentSchema } from "../../../src/schema/content";

const BASE_CONTENT = {
	serialNumber: "serial-001",
};

const parsesContent = (config: unknown) =>
	passContentSchema.safeParse(config).success;

describe("passContentSchema", () => {
	it("rejects an empty serialNumber", () => {
		expect(parsesContent({ serialNumber: "" })).toBe(false);
	});

	it.each([
		"validFrom",
		"expiresAt",
	])("requires a full ISO datetime for %s", (key) => {
		expect(parsesContent({ ...BASE_CONTENT, [key]: "2024-01-01" })).toBe(false);
		expect(
			parsesContent({ ...BASE_CONTENT, [key]: "2024-01-01T00:00:00Z" })
		).toBe(true);
	});

	it("rejects an empty barcode value", () => {
		expect(parsesContent({ ...BASE_CONTENT, barcode: { value: "" } })).toBe(
			false
		);
	});

	it("accepts the iOS 27 barcode formats", () => {
		expect(
			parsesContent({
				...BASE_CONTENT,
				barcodes: [
					{ value: "12345", format: "EAN13" },
					{ value: "12345", format: "ITF" },
					{ value: "12345", format: "Code39" },
					{ value: "12345", format: "Codabar" },
				],
			})
		).toBe(true);
	});

	// Google supports rotation for QR_CODE and PDF_417 only.
	it("restricts rotating barcodes to the rotation-capable types", () => {
		const rotatingBarcode = {
			valuePattern: "https://example.com/{totp_value_hex}",
			totpDetails: { parameters: [{ key: "K1", valueLength: 8 }] },
		};
		expect(
			parsesContent({
				...BASE_CONTENT,
				google: { rotatingBarcode: { ...rotatingBarcode, type: "PDF_417" } },
			})
		).toBe(true);
		expect(
			parsesContent({
				...BASE_CONTENT,
				google: { rotatingBarcode: { ...rotatingBarcode, type: "AZTEC" } },
			})
		).toBe(false);
	});

	it("caps google.valueAdded at 10 modules", () => {
		const valueAdded = Array.from({ length: 11 }, () => ({
			header: "Perk",
			uri: "https://example.com",
		}));
		expect(
			parsesContent({
				...BASE_CONTENT,
				google: { valueAdded: valueAdded.slice(0, 10) },
			})
		).toBe(true);
		expect(parsesContent({ ...BASE_CONTENT, google: { valueAdded } })).toBe(
			false
		);
	});
});
