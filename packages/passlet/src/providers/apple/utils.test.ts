import { describe, expect, it } from "vitest";
import { hexToRgb, toAppleBarcodeFormat } from "./utils";

describe("hexToRgb", () => {
	it("converts lowercase hex to rgb string", () => {
		expect(hexToRgb("#1a2b3c")).toBe("rgb(26, 43, 60)");
	});

	it("converts uppercase hex", () => {
		expect(hexToRgb("#FF0000")).toBe("rgb(255, 0, 0)");
	});

	it("handles black", () => {
		expect(hexToRgb("#000000")).toBe("rgb(0, 0, 0)");
	});

	it("handles white", () => {
		expect(hexToRgb("#ffffff")).toBe("rgb(255, 255, 255)");
	});
});

describe("toAppleBarcodeFormat", () => {
	it.each([
		["QR", "PKBarcodeFormatQR"],
		["PDF417", "PKBarcodeFormatPDF417"],
		["Aztec", "PKBarcodeFormatAztec"],
		["Code128", "PKBarcodeFormatCode128"],
	])("maps %s to %s", (input, expected) => {
		expect(
			toAppleBarcodeFormat(input as "QR" | "PDF417" | "Aztec" | "Code128")
		).toBe(expected);
	});
});
