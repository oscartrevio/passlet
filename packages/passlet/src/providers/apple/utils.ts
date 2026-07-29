import { WalletError } from "../../errors";
import type {
	BarcodeFormat,
	DataDetectorType,
	DateStyle,
	ImageSet,
	NumberStyle,
	TextAlignment,
} from "../../types/schemas";

// Convert a 6-digit hex color to Apple's rgb() format.
// Apple pass.json requires colors as "rgb(r, g, b)" strings.
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

// QR and Aztec support a UTF-8 byte mode, so encode their payloads as UTF-8 to
// avoid mangling non-Latin-1 characters. The linear formats (PDF417, Code128,
// Code39, Codabar, EAN13, ITF) stay on iso-8859-1.
export function toAppleMessageEncoding(format: BarcodeFormat): string {
	return format === "QR" || format === "Aztec" ? "utf-8" : "iso-8859-1";
}

// Apple's PassFieldContent documents PK-prefixed constants for the field style
// enums. passlet exposes friendly lowercase values, so they are mapped here.
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

// Escape a string for Apple's pass.strings format, which follows the
// NeXTSTEP/plist strings syntax: backslashes, double quotes and literal
// newlines must be escaped or the file fails to parse.
export function escapeStringsValue(value: string): string {
	return value
		.replace(/\\/g, "\\\\")
		.replace(/"/g, '\\"')
		.replace(/\n/g, "\\n")
		.replace(/\r/g, "\\r");
}

async function fetchAsBytes(url: string): Promise<Uint8Array> {
	let response: Response;
	try {
		response = await fetch(url);
	} catch (cause) {
		throw new WalletError(
			"IMAGE_FETCH_NETWORK_ERROR",
			`Failed to fetch image: ${url} (network error)`,
			{ cause }
		);
	}
	if (!response.ok) {
		throw new WalletError(
			"IMAGE_FETCH_FAILED",
			`Failed to fetch image: ${url} (${response.status})`
		);
	}
	return new Uint8Array(await response.arrayBuffer());
}

function resolveSource(src: string | Uint8Array): Promise<Uint8Array> {
	return src instanceof Uint8Array ? Promise.resolve(src) : fetchAsBytes(src);
}

async function resolveImageSetWithMode(
	name: string,
	imageSet: ImageSet,
	options: { warnings?: string[]; required: boolean }
): Promise<Record<string, Uint8Array>> {
	const files: Record<string, Uint8Array> = {};

	const load = async (filename: string, src: string | Uint8Array) => {
		if (options.required) {
			files[filename] = await resolveSource(src);
			return;
		}
		try {
			files[filename] = await resolveSource(src);
		} catch (error) {
			options.warnings?.push(
				`Could not load ${filename}: ${error instanceof Error ? error.message : String(error)}`
			);
		}
	};

	if (typeof imageSet === "string" || imageSet instanceof Uint8Array) {
		await load(`${name}.png`, imageSet);
		return files;
	}

	await load(`${name}.png`, imageSet.base);
	if (imageSet.retina) {
		await load(`${name}@2x.png`, imageSet.retina);
	}
	if (imageSet.superRetina) {
		await load(`${name}@3x.png`, imageSet.superRetina);
	}

	return files;
}

// Resolve an ImageSet into named Apple image files (base.png, @2x, @3x).
// Returns a record of filename → bytes. Optional images that fail to load
// are skipped and a warning is added.
export function resolveImageSet(
	name: string,
	imageSet: ImageSet | undefined,
	warnings: string[]
): Promise<Record<string, Uint8Array>> {
	if (!imageSet) {
		return Promise.resolve({});
	}
	return resolveImageSetWithMode(name, imageSet, { warnings, required: false });
}

// Same as resolveImageSet but throws instead of warning — for required images.
export function resolveRequiredImageSet(
	name: string,
	imageSet: ImageSet
): Promise<Record<string, Uint8Array>> {
	return resolveImageSetWithMode(name, imageSet, { required: true });
}
