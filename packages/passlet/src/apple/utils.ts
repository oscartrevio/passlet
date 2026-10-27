import type {
	BarcodeFormat,
	DataDetectorType,
	DateStyle,
	NumberStyle,
	TextAlignment,
} from "../schema/parts";

// Apple colors are "rgb(r, g, b)" strings, not hex.
export function hexToRgb(hex: string): string {
	const clean = hex.replace("#", "");
	const r = Number.parseInt(clean.slice(0, 2), 16);
	const g = Number.parseInt(clean.slice(2, 4), 16);
	const b = Number.parseInt(clean.slice(4, 6), 16);
	return `rgb(${r}, ${g}, ${b})`;
}

// https://developer.apple.com/documentation/walletpasses/pass/barcodes-data.dictionary
export const APPLE_BARCODE_FORMAT: Record<BarcodeFormat, string> = {
	QR: "PKBarcodeFormatQR",
	PDF417: "PKBarcodeFormatPDF417",
	Aztec: "PKBarcodeFormatAztec",
	Code128: "PKBarcodeFormatCode128",
	// iOS 27 and later — valid in `barcodes` only
	Code39: "PKBarcodeFormatCode39",
	Codabar: "PKBarcodeFormatCodabar",
	EAN13: "PKBarcodeFormatEAN13",
	ITF: "PKBarcodeFormatI2of5",
};

// The deprecated singular `barcode` key documents only QR, PDF417 and Aztec as
// legal formats, so anything else must be emitted in `barcodes` alone.
export const LEGACY_BARCODE_FORMATS: ReadonlySet<BarcodeFormat> = new Set([
	"QR",
	"PDF417",
	"Aztec",
]);

// QR/Aztec use UTF-8 to preserve non-Latin-1 payloads; other formats use Latin-1.
export function toAppleMessageEncoding(format: BarcodeFormat): string {
	return format === "QR" || format === "Aztec" ? "utf-8" : "iso-8859-1";
}

// PassFieldContent requires PK-prefixed style constants; dateStyle and
// timeStyle share the PKDateStyle ones.
// https://developer.apple.com/documentation/walletpasses/passfieldcontent
export const APPLE_DATE_STYLE: Record<DateStyle, string> = {
	none: "PKDateStyleNone",
	short: "PKDateStyleShort",
	medium: "PKDateStyleMedium",
	long: "PKDateStyleLong",
	full: "PKDateStyleFull",
};

export const APPLE_NUMBER_STYLE: Record<NumberStyle, string> = {
	decimal: "PKNumberStyleDecimal",
	percent: "PKNumberStylePercent",
	scientific: "PKNumberStyleScientific",
	spellOut: "PKNumberStyleSpellOut",
};

export const APPLE_TEXT_ALIGNMENT: Record<TextAlignment, string> = {
	left: "PKTextAlignmentLeft",
	center: "PKTextAlignmentCenter",
	right: "PKTextAlignmentRight",
	natural: "PKTextAlignmentNatural",
};

export const APPLE_DATA_DETECTOR_TYPE: Record<DataDetectorType, string> = {
	phoneNumber: "PKDataDetectorTypePhoneNumber",
	link: "PKDataDetectorTypeLink",
	address: "PKDataDetectorTypeAddress",
	calendarEvent: "PKDataDetectorTypeCalendarEvent",
};
