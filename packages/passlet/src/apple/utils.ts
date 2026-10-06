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

const APPLE_BARCODE_FORMAT: Record<BarcodeFormat, string> = {
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

export function toAppleBarcodeFormat(format: BarcodeFormat): string {
	return APPLE_BARCODE_FORMAT[format];
}

// The deprecated singular `barcode` key documents only QR, PDF417 and Aztec as
// legal formats, so anything else must be emitted in `barcodes` alone.
const LEGACY_BARCODE_FORMATS = new Set<BarcodeFormat>([
	"QR",
	"PDF417",
	"Aztec",
]);

export function isLegacyBarcodeFormat(format: BarcodeFormat): boolean {
	return LEGACY_BARCODE_FORMATS.has(format);
}

// QR/Aztec use UTF-8 to preserve non-Latin-1 payloads; other formats use Latin-1.
export function toAppleMessageEncoding(format: BarcodeFormat): string {
	return format === "QR" || format === "Aztec" ? "utf-8" : "iso-8859-1";
}

// PassFieldContent requires PK-prefixed style constants.
// https://developer.apple.com/documentation/walletpasses/passfieldcontent
const APPLE_DATE_STYLE: Record<DateStyle, string> = {
	none: "PKDateStyleNone",
	short: "PKDateStyleShort",
	medium: "PKDateStyleMedium",
	long: "PKDateStyleLong",
	full: "PKDateStyleFull",
};

// dateStyle and timeStyle share the PKDateStyle constants.
export function toAppleDateStyle(style: DateStyle): string {
	return APPLE_DATE_STYLE[style];
}

const APPLE_NUMBER_STYLE: Record<NumberStyle, string> = {
	decimal: "PKNumberStyleDecimal",
	percent: "PKNumberStylePercent",
	scientific: "PKNumberStyleScientific",
	spellOut: "PKNumberStyleSpellOut",
};

export function toAppleNumberStyle(style: NumberStyle): string {
	return APPLE_NUMBER_STYLE[style];
}

const APPLE_TEXT_ALIGNMENT: Record<TextAlignment, string> = {
	left: "PKTextAlignmentLeft",
	center: "PKTextAlignmentCenter",
	right: "PKTextAlignmentRight",
	natural: "PKTextAlignmentNatural",
};

export function toAppleTextAlignment(alignment: TextAlignment): string {
	return APPLE_TEXT_ALIGNMENT[alignment];
}

const APPLE_DATA_DETECTOR_TYPE: Record<DataDetectorType, string> = {
	phoneNumber: "PKDataDetectorTypePhoneNumber",
	link: "PKDataDetectorTypeLink",
	address: "PKDataDetectorTypeAddress",
	calendarEvent: "PKDataDetectorTypeCalendarEvent",
};

export function toAppleDataDetectorTypes(types: DataDetectorType[]): string[] {
	return types.map((t) => APPLE_DATA_DETECTOR_TYPE[t]);
}
