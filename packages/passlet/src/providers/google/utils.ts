const GOOGLE_BARCODE_TYPE: Record<string, string> = {
	QR: "QR_CODE",
	PDF417: "PDF_417",
	Aztec: "AZTEC",
	Code128: "CODE_128",
};

export function toGoogleBarcodeType(format: string): string {
	return GOOGLE_BARCODE_TYPE[format] ?? "QR_CODE";
}

interface TranslatedValue {
	language: string;
	value: string;
}

interface LocalizedString {
	defaultValue: TranslatedValue;
	translatedValues?: TranslatedValue[];
}

// Build a Google Wallet LocalizedString object.
// Pass translatedValues to include additional language variants.
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

// Build the translatedValues array for a given key by scanning all locales.
// Used to look up field key translations (labels) and key_value translations (static values).
export function translationsFor(
	key: string,
	locales: Record<string, Record<string, string>> | undefined
): TranslatedValue[] | undefined {
	if (!locales) {
		return undefined;
	}
	const result = Object.entries(locales)
		.filter(([, t]) => t[key] !== undefined)
		.map(([lang, t]) => ({ language: lang, value: t[key] as string }));
	return result.length > 0 ? result : undefined;
}

// Wrap a URL string as a Google Wallet ImageUri object.
export function imageUri(url: unknown): Record<string, unknown> | undefined {
	return typeof url === "string" ? { sourceUri: { uri: url } } : undefined;
}
