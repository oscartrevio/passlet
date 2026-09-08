import { describe, expect, it } from "vitest";
import {
	localized,
	toGoogleBarcodeType,
	toLocalDateTime,
	translationsFor,
} from "../../../src/providers/google/utils";

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

describe("translationsFor", () => {
	it("collects one entry per locale defining the key and none when nothing matches", () => {
		const locales = {
			es: { name: "Recompensas", points: "Puntos", points_value: "1.250" },
			fr: { name: "Récompenses" },
		};
		expect(translationsFor("name", locales)).toEqual([
			{ language: "es", value: "Recompensas" },
			{ language: "fr", value: "Récompenses" },
		]);
		// fr lacks the key and the "_value" entry is a different key.
		expect(translationsFor("points", locales)).toEqual([
			{ language: "es", value: "Puntos" },
		]);
		expect(translationsFor("tier", locales)).toBeUndefined();
		expect(translationsFor("name", undefined)).toBeUndefined();
	});
});

describe("localized", () => {
	it("leaves translatedValues unset rather than empty when there are no translations", () => {
		expect(localized("Points").translatedValues).toBeUndefined();
		expect(localized("Points", "en-US", []).translatedValues).toBeUndefined();
		expect(
			localized("Points", "en-GB", [{ language: "es", value: "Puntos" }])
		).toEqual({
			defaultValue: { language: "en-GB", value: "Points" },
			translatedValues: [{ language: "es", value: "Puntos" }],
		});
	});
});
