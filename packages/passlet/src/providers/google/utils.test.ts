import { describe, expect, it } from "vitest";
import { toGoogleBarcodeType, toLocalDateTime } from "./utils";

describe("toLocalDateTime", () => {
	it.each([
		["2024-06-01T08:00:00Z", "2024-06-01T08:00:00"],
		["2024-06-01T08:00:00+04:00", "2024-06-01T08:00:00"],
		["2024-06-01T08:00:00-05:00", "2024-06-01T08:00:00"],
		["2024-06-01T08:00:00", "2024-06-01T08:00:00"],
	])("strips the offset from %s", (input, expected) => {
		expect(toLocalDateTime(input)).toBe(expected);
	});
});

describe("toGoogleBarcodeType", () => {
	it.each([
		["QR", "QR_CODE"],
		["PDF417", "PDF_417"],
		["Aztec", "AZTEC"],
		["Code128", "CODE_128"],
		["Code39", "CODE_39"],
		["Codabar", "CODABAR"],
		["EAN13", "EAN_13"],
		["ITF", "ITF_14"],
	] as const)("maps %s to %s", (input, expected) => {
		expect(toGoogleBarcodeType(input)).toBe(expected);
	});
});
