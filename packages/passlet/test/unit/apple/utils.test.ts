import { afterEach, describe, expect, it, vi } from "vitest";
import {
	escapeStringsValue,
	hexToRgb,
	isLegacyBarcodeFormat,
	resolveImageSet,
	resolveRequiredImageSet,
	toAppleBarcodeFormat,
	toAppleDataDetectorTypes,
	toAppleDateStyle,
	toAppleMessageEncoding,
	toAppleNumberStyle,
	toAppleTextAlignment,
} from "../../../src/providers/apple/utils";
import type {
	BarcodeFormat,
	DateStyle,
	NumberStyle,
	TextAlignment,
} from "../../../src/types/schemas";

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

describe("escapeStringsValue", () => {
	it("escapes backslashes, quotes and line breaks for pass.strings", () => {
		// Backslashes go first: escaping quotes first would double the added one.
		expect(escapeStringsValue('a\\b "c"\nd\re')).toBe('a\\\\b \\"c\\"\\nd\\re');
	});
});

describe("image failures", () => {
	const imageUrl = "https://images.example/icon.png?token=private-image-token";
	afterEach(() => vi.unstubAllGlobals());

	it("reports HTTP status without exposing signed image URLs", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(() =>
				Promise.resolve(new Response("private-response", { status: 403 }))
			)
		);
		await expect(
			resolveRequiredImageSet("icon", imageUrl)
		).rejects.toMatchObject({
			code: "IMAGE_FETCH_FAILED",
			status: 403,
			message: expect.not.stringContaining("private"),
		});
		const warnings: string[] = [];
		await expect(resolveImageSet("logo", imageUrl, warnings)).resolves.toEqual(
			{}
		);
		expect(warnings).toEqual([expect.stringContaining("logo.png")]);
		expect(warnings.join()).not.toContain("private");
	});

	it("classifies interrupted image bodies as network failures", async () => {
		const cause = new Error("connection reset");
		vi.stubGlobal(
			"fetch",
			vi.fn(() =>
				Promise.resolve(
					new Response(
						new ReadableStream({
							start(controller) {
								controller.error(cause);
							},
						})
					)
				)
			)
		);
		await expect(
			resolveRequiredImageSet("icon", imageUrl)
		).rejects.toMatchObject({
			code: "IMAGE_FETCH_NETWORK_ERROR",
			status: 502,
			cause,
		});
	});
});
