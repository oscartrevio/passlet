import { describe, expect, it } from "vitest";
import {
	hexToRgb,
	isLegacyBarcodeFormat,
	toAppleBarcodeFormat,
	toAppleDataDetectorTypes,
	toAppleDateStyle,
	toAppleMessageEncoding,
	toAppleNumberStyle,
	toAppleTextAlignment,
} from "../../../src/apple/utils";
import type {
	BarcodeFormat,
	DateStyle,
	NumberStyle,
	TextAlignment,
} from "../../../src/schema/parts";

describe("hexToRgb", () => {
	it.each([
		["#1a2b3c", "rgb(26, 43, 60)"],
		["#FF0000", "rgb(255, 0, 0)"],
	])("converts %s to %s", (hex, rgb) => {
		expect(hexToRgb(hex)).toBe(rgb);
	});
});

describe("barcode formats", () => {
	// The deprecated singular `barcode` key documents only QR, PDF417 and
	// Aztec; QR and Aztec are the only UTF-8 safe payloads.
	it.each<[BarcodeFormat, string, boolean, string]>([
		["QR", "PKBarcodeFormatQR", true, "utf-8"],
		["PDF417", "PKBarcodeFormatPDF417", true, "iso-8859-1"],
		["Aztec", "PKBarcodeFormatAztec", true, "utf-8"],
		["Code128", "PKBarcodeFormatCode128", false, "iso-8859-1"],
		["Code39", "PKBarcodeFormatCode39", false, "iso-8859-1"],
		["Codabar", "PKBarcodeFormatCodabar", false, "iso-8859-1"],
		["EAN13", "PKBarcodeFormatEAN13", false, "iso-8859-1"],
		["ITF", "PKBarcodeFormatI2of5", false, "iso-8859-1"],
	])("%s is %s, legal in the singular barcode: %s, encoded as %s", (format, constant, legacy, encoding) => {
		expect(toAppleBarcodeFormat(format)).toBe(constant);
		expect(isLegacyBarcodeFormat(format)).toBe(legacy);
		expect(toAppleMessageEncoding(format)).toBe(encoding);
	});
});

describe("field style constants", () => {
	it.each<[DateStyle, string]>([
		["none", "PKDateStyleNone"],
		["short", "PKDateStyleShort"],
		["medium", "PKDateStyleMedium"],
		["long", "PKDateStyleLong"],
		["full", "PKDateStyleFull"],
	])("dateStyle %s is %s", (style, constant) => {
		expect(toAppleDateStyle(style)).toBe(constant);
	});

	it.each<[NumberStyle, string]>([
		["decimal", "PKNumberStyleDecimal"],
		["percent", "PKNumberStylePercent"],
		["scientific", "PKNumberStyleScientific"],
		["spellOut", "PKNumberStyleSpellOut"],
	])("numberStyle %s is %s", (style, constant) => {
		expect(toAppleNumberStyle(style)).toBe(constant);
	});

	it.each<[TextAlignment, string]>([
		["left", "PKTextAlignmentLeft"],
		["center", "PKTextAlignmentCenter"],
		["right", "PKTextAlignmentRight"],
		["natural", "PKTextAlignmentNatural"],
	])("textAlignment %s is %s", (alignment, constant) => {
		expect(toAppleTextAlignment(alignment)).toBe(constant);
	});

	it("maps every data detector type in order", () => {
		expect(
			toAppleDataDetectorTypes([
				"phoneNumber",
				"link",
				"address",
				"calendarEvent",
			])
		).toEqual([
			"PKDataDetectorTypePhoneNumber",
			"PKDataDetectorTypeLink",
			"PKDataDetectorTypeAddress",
			"PKDataDetectorTypeCalendarEvent",
		]);
	});
});
