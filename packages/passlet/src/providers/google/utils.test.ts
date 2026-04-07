import { describe, expect, it } from "vitest";
import { imageUri, localized, toGoogleBarcodeType } from "./utils";

describe("toGoogleBarcodeType", () => {
	it.each([
		["QR", "QR_CODE"],
		["PDF417", "PDF_417"],
		["Aztec", "AZTEC"],
		["Code128", "CODE_128"],
	])("maps %s to %s", (input, expected) => {
		expect(toGoogleBarcodeType(input)).toBe(expected);
	});

	it("defaults unknown format to QR_CODE", () => {
		expect(toGoogleBarcodeType("EAN13")).toBe("QR_CODE");
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

	it("returns undefined for Uint8Array (bytes not supported by Google)", () => {
		expect(imageUri(new Uint8Array([1, 2, 3]))).toBeUndefined();
	});

	it("returns undefined for undefined", () => {
		expect(imageUri(undefined)).toBeUndefined();
	});

	it("returns undefined for null", () => {
		expect(imageUri(null)).toBeUndefined();
	});
});
