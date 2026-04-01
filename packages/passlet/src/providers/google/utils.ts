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

// Build a Google Wallet LocalizedString object.
export function localized(
	value: string,
	language = "en-US"
): { defaultValue: TranslatedValue } {
	return { defaultValue: { language, value } };
}

// Wrap a URL string as a Google Wallet ImageUri object.
export function imageUri(url: unknown): Record<string, unknown> | undefined {
	return typeof url === "string" ? { sourceUri: { uri: url } } : undefined;
}
