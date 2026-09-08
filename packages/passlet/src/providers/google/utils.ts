import type { BarcodeFormat, GoogleImage, Locales } from "../../types/schemas";

const GOOGLE_BARCODE_TYPE: Record<BarcodeFormat, string> = {
	QR: "QR_CODE",
	PDF417: "PDF_417",
	Aztec: "AZTEC",
	Code128: "CODE_128",
	Code39: "CODE_39",
	Codabar: "CODABAR",
	EAN13: "EAN_13",
	ITF: "ITF_14",
};

export function toGoogleBarcodeType(format: BarcodeFormat): string {
	return GOOGLE_BARCODE_TYPE[format];
}

const UTC_OFFSET_RE = /(Z|[+-]\d{2}:\d{2})$/;

// Flight datetimes are airport-local; Google derives the zone from the airport.
// Strip Z or ±HH:MM without shifting the wall clock. EventDateTime accepts
// and uses offsets, so event datetimes must bypass this conversion.
export function toLocalDateTime(iso: string): string {
	return iso.replace(UTC_OFFSET_RE, "");
}

interface TranslatedValue {
	language: string;
	value: string;
}

interface LocalizedString {
	defaultValue: TranslatedValue;
	translatedValues?: TranslatedValue[];
}

export function localized(
	value: string,
	language = "en-US",
	translatedValues?: TranslatedValue[]
): LocalizedString {
	return {
		defaultValue: { language, value },
		translatedValues: translatedValues?.length ? translatedValues : undefined,
	};
}

// Locale field keys translate labels; "<key>_value" translates field values.
export function translationsFor(
	key: string,
	locales: Locales | undefined
): TranslatedValue[] | undefined {
	if (!locales) {
		return;
	}
	const result = Object.entries(locales)
		.filter(([, t]) => t[key] !== undefined)
		.map(([lang, t]) => ({ language: lang, value: t[key] as string }));
	return result.length > 0 ? result : undefined;
}

export function imageUri(url: string | undefined): GoogleImage | undefined {
	return url ? { sourceUri: { uri: url } } : undefined;
}
