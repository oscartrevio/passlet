import { describe, expect, it } from "vitest";
import { imageUri, localized, toGoogleBarcodeType } from "./utils";

describe("toGoogleBarcodeType", () => {
	it.each([
		["QR", "QR_CODE"],
		["PDF417", "PDF_417"],
		["Aztec", "AZTEC"],
		["Code128", "CODE_128"],
	])("maps %s to %s", (input, expected) => {
		expect(
			toGoogleBarcodeType(input as "QR" | "PDF417" | "Aztec" | "Code128")
		).toBe(expected);
	});
});

describe("localized", () => {
	it("wraps a value in a defaultValue object with en-US language", () => {
		expect(localized("Hello")).toEqual({
			defaultValue: { language: "en-US", value: "Hello" },
		});
	});

	it("accepts a custom language", () => {
		expect(localized("Hola", "es-MX")).toEqual({
			defaultValue: { language: "es-MX", value: "Hola" },
		});
	});
});

describe("imageUri", () => {
	it("wraps a URL string in a sourceUri object", () => {
		expect(imageUri("https://example.com/logo.png")).toEqual({
			sourceUri: { uri: "https://example.com/logo.png" },
		});
	});

	it("returns undefined for undefined", () => {
		expect(imageUri(undefined)).toBeUndefined();
	});
});
