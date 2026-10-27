import {
	array,
	boolean,
	type Check,
	crossCheck,
	type Issue,
	instance,
	nonEmpty,
	number,
	object,
	optional,
	pattern,
	picklist,
	record,
	refine,
	string,
	trimmed,
	unknown,
	withDefault,
} from "./check";

export const hexColor = pattern(
	/^#[0-9a-fA-F]{6}$/,
	'must be a 6-digit hex color like "#1a1a1a"'
);

/**
 * Any absolute URL: a scheme, then whatever that scheme allows. Surrounding
 * whitespace is trimmed, as the URL parser does.
 */
export const url = refine(trimmed, (value) =>
	URL.canParse(value) ? undefined : "must be an absolute URL"
);

export const optionalUrl = optional(url);

// What `fetch` can download: passlet fetches Apple image URLs itself.
const HTTP_URL_RE = /^https?:\/\//i;
const httpUrl = refine(trimmed, (value) =>
	HTTP_URL_RE.test(value) && URL.canParse(value)
		? undefined
		: "must be an http(s) URL"
);

// Loose on purpose: Apple and Google check the address; this catches a value
// put in the wrong option.
export const email = pattern(
	/^[^\s@]+@[^\s@]+\.[^\s@]+$/,
	'must be an email address like "help@example.com"'
);

// Primary subtag (2-3 lowercase letters), then optional subtags:
// "en", "en-US", "zh-Hans", "zh-Hans-CN", "es-419".
const localeCode = pattern(
	/^[a-z]{2,3}(-[A-Za-z0-9]+)*$/,
	'must be a BCP 47 language tag like "en-US", "es" or "zh-Hans"'
);

// Apple requires a time zone on any value rendered with dateStyle/timeStyle
// ("A date or time value needs to include a time zone" — PassFieldContent).
export const TIMEZONE_RE = /(Z|[+-]\d{2}:?\d{2})$/;

// W3C timestamps (https://www.w3.org/TR/NOTE-datetime), which Apple takes for
// every pass.json date and Google's DateTime takes with an offset.
// https://developer.apple.com/documentation/walletpasses/pass
// https://developers.google.com/wallet/reference/rest/v1/DateTime
const TIMESTAMP_RE =
	/^(\d{4})-(\d{2})-(\d{2})T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)?$/;

function timestampCheck(zone: "required" | "optional", message: string) {
	return refine(string, (value) => {
		const match = TIMESTAMP_RE.exec(value);
		if (!match || (zone === "required" && match[4] === undefined)) {
			return message;
		}
		const [, year, month, day] = match.map(Number);
		// Day 0 of the next month is the last day of this one.
		const days =
			year && month ? new Date(Date.UTC(year, month, 0)).getUTCDate() : 0;
		return month && month <= 12 && day && day <= days ? undefined : message;
	});
}

/** A W3C timestamp with a time zone, as both wallets take for a moment in time. */
export const timestamp = timestampCheck(
	"required",
	'must be a date and time with a time zone, like "2025-12-09T13:00-07:00" or "2025-12-09T20:00:00Z"'
);

/**
 * A venue- or airport-local date and time: the zone is optional, because
 * Google takes event and flight times "with or without an offset".
 */
export const localTimestamp = timestampCheck(
	"optional",
	'must be a date and time, like "2025-12-09T13:00:00" or "2025-12-09T13:00-07:00"'
);

/**
 * Translations of one language, keyed by what they translate: a field key
 * (its label), `"name"` (the pass title), or `"<fieldKey>_value"` (a field's
 * static value).
 */
export type TranslationMap = Record<string, string>;

/**
 * Translations by BCP 47 language tag (`"en-US"`, `"es"`, `"zh-Hans"`).
 *
 * Apple: written as `<language>.lproj/pass.strings` in the `.pkpass`. Wallet
 * looks entries up by the literal string pass.json shows, so each key is
 * resolved to that string when the file is written (a field key becomes the
 * field's label, `"name"` the pass name). A key that matches no field is
 * written as is, which translates a literal string with no field behind it,
 * such as `logoText`, when keyed by that string.
 *
 * Google: added as `translatedValues` on each localized string.
 */
export type Locales = Record<string, TranslationMap>;

export const locales: Check<Locales> = record(record(string), localeCode);

/**
 * A place that makes the pass relevant: Apple shows it on the lock screen
 * nearby; Google writes it as a `merchantLocations` entry.
 */
export interface Location {
	/** Apple only: meters above sea level. */
	altitude?: number;
	/** Latitude in degrees, north positive. */
	latitude: number;
	/** Longitude in degrees, east positive. */
	longitude: number;
	/**
	 * Apple only: lock screen text when the pass becomes relevant here. Google
	 * has no equivalent: its own `locations` is deprecated and "currently not
	 * supported to trigger geo notifications".
	 */
	relevantText?: string;
}

export const location = object<Location>({
	latitude: number,
	longitude: number,
	altitude: optional(number),
	relevantText: optional(string),
});

/** An image: an http(s) URL passlet downloads, or the image bytes. */
export type ImageSource = string | Uint8Array;

/** An Apple image, alone or with its resolution variants. */
export type ImageSet =
	| ImageSource
	| {
			/** The `@1x` file. */
			base: ImageSource;
			/** The `@2x` file. */
			retina?: ImageSource;
			/** The `@3x` file. */
			superRetina?: ImageSource;
	  };

const bytes = instance(
	Uint8Array,
	"an http(s) URL or image bytes (a Uint8Array)"
);

const imageSource: Check<ImageSource> = (input) =>
	typeof input === "string" ? httpUrl(input) : bytes(input);

const imageVariants = object<Exclude<ImageSet, ImageSource>>({
	base: imageSource,
	retina: optional(imageSource),
	superRetina: optional(imageSource),
});

export const imageSet: Check<ImageSet> = (input) =>
	typeof input === "object" && input !== null && !(input instanceof Uint8Array)
		? imageVariants(input)
		: imageSource(input);

/**
 * Machine-readable metadata (Apple's SemanticTags), accepted at the root of
 * pass.json and on any field. Values are strings, numbers, booleans or
 * Apple's structured tag types (`SemanticTagType.Seat`, …), so the shape
 * stays open.
 * https://developer.apple.com/documentation/walletpasses/semantictags
 */
export type SemanticTags = Record<string, unknown>;

export const semanticTags: Check<SemanticTags> = record(unknown);

/** Apple's `PKDateStyle`, without the prefix. */
export type DateStyle = "none" | "short" | "medium" | "long" | "full";
/** Apple's `PKNumberStyle`, without the prefix. */
export type NumberStyle = "decimal" | "percent" | "scientific" | "spellOut";
/** Apple's `PKTextAlignment`, without the prefix. */
export type TextAlignment = "left" | "center" | "right" | "natural";
/** Apple's `PKDataDetectorType`, without the prefix. */
export type DataDetectorType =
	| "phoneNumber"
	| "link"
	| "address"
	| "calendarEvent";

const dateStyle = picklist(["none", "short", "medium", "long", "full"]);

/** One display field of a pass, as built by `field.primary()` and its siblings. */
export interface FieldDef {
	/**
	 * Apple only: the value with HTML markup, shown instead of `value`. Only
	 * the `<a>` tag and its `href` attribute are supported. Not used on watchOS.
	 */
	attributedValue?: string;
	/**
	 * Apple only: the notification shown when the value changes. Must contain
	 * the `"%@"` placeholder, which Apple replaces with the new value; Apple
	 * shows no notification without it.
	 */
	changeMessage?: string;
	/** Apple: the ISO 4217 code that formats the value as an amount. */
	currencyCode?: string;
	/**
	 * Apple only, back fields only: the data detectors to run on the value.
	 * Omit to keep Apple's default (all of them); `[]` turns them off.
	 */
	dataDetectorTypes?: DataDetectorType[];
	/**
	 * Apple: renders the value as a date. A static `value` must then be an
	 * ISO 8601 date and time with a time zone.
	 */
	dateStyle?: DateStyle;
	/**
	 * Apple only: shows the date and time in the time zone `value` carries
	 * instead of the device's. Defaults to `false`.
	 */
	ignoresTimeZone?: boolean;
	/**
	 * Apple only: renders the date relative to now ("in 3 days"). Defaults to
	 * `false`. Neither this nor `ignoresTimeZone` affects relevance.
	 */
	isRelative?: boolean;
	/**
	 * Identifies the field: recipient values in `content.values` and
	 * translations in `locales` refer to it.
	 */
	key: string;
	/**
	 * Optional for Apple. Google's text modules show the key when it is
	 * omitted.
	 */
	label?: string;
	/** Apple: renders the value as a number. A static `value` must then be numeric. */
	numberStyle?: NumberStyle;
	/** Apple only: which of the two auxiliary rows the field sits in. */
	row?: 0 | 1;
	/**
	 * Apple only: the field's semantics dictionary, merged over the tags
	 * passlet derives from the template; entries given here win.
	 */
	semantics?: SemanticTags;
	/**
	 * Where the field shows. Apple: `headerFields`, `primaryFields`,
	 * `secondaryFields`, `auxiliaryFields` or `backFields`. Google: a generic
	 * pass puts its primary field in `subheader` (label) and `header` (value);
	 * everything else becomes a `textModulesData` row.
	 */
	slot: "header" | "primary" | "secondary" | "auxiliary" | "back";
	/** Apple only: the alignment of the label and value. */
	textAlignment?: TextAlignment;
	/** Apple: renders the value's time. Same `value` rule as `dateStyle`. */
	timeStyle?: DateStyle;
	/**
	 * The text every recipient sees unless `content.values` sets their own.
	 */
	value?: string;
}

// A static value must have the shape its style renders: a number for
// numberStyle, a zoned date and time for dateStyle/timeStyle. Values given at
// create() time are not checked here.
function styledValueIssues(field: FieldDef): Issue[] {
	const { value } = field;
	if (value === undefined) {
		return [];
	}
	const issues: Issue[] = [];
	const issue = (message: string) => issues.push({ path: ["value"], message });
	if (field.numberStyle && Number.isNaN(Number(value))) {
		issue("must be numeric when numberStyle is set");
	}
	const rendersDate =
		(field.dateStyle && field.dateStyle !== "none") ||
		(field.timeStyle && field.timeStyle !== "none");
	if (!rendersDate) {
		return issues;
	}
	if (Number.isNaN(Date.parse(value))) {
		issue(
			"must be an ISO 8601 date and time when dateStyle or timeStyle is set"
		);
	} else if (!TIMEZONE_RE.test(value)) {
		issue(
			'must include a time zone when dateStyle or timeStyle is set, like "2024-06-01T20:00:00Z" or "2024-06-01T20:00:00-07:00"'
		);
	}
	return issues;
}

export const fieldDef: Check<FieldDef> = crossCheck(
	object<FieldDef>({
		slot: picklist(["header", "primary", "secondary", "auxiliary", "back"]),
		key: string,
		label: optional(string),
		value: optional(string),
		attributedValue: optional(string),
		dataDetectorTypes: optional(
			array(picklist(["phoneNumber", "link", "address", "calendarEvent"]))
		),
		ignoresTimeZone: optional(boolean),
		isRelative: optional(boolean),
		semantics: optional(semanticTags),
		changeMessage: optional(
			refine(string, (value) =>
				value.includes("%@") ? undefined : 'must contain the "%@" placeholder'
			)
		),
		dateStyle: optional(dateStyle),
		timeStyle: optional(dateStyle),
		numberStyle: optional(
			picklist(["decimal", "percent", "scientific", "spellOut"])
		),
		currencyCode: optional(string),
		textAlignment: optional(picklist(["left", "center", "right", "natural"])),
		row: optional(picklist([0, 1])),
	}),
	styledValueIssues
);

/**
 * The barcode formats both wallets render. Apple's `barcodes` takes QR,
 * PDF417, Aztec and Code128, plus Code39, Codabar, EAN13 and ITF (I2of5) from
 * iOS 27; its deprecated singular `barcode` takes only QR, PDF417 and Aztec,
 * so the others are written to `barcodes` alone. Google's DATA_MATRIX, EAN_8,
 * UPC_A and TEXT_ONLY have no Apple equivalent and are not offered.
 * https://developer.apple.com/documentation/walletpasses/pass/barcodes-data.dictionary
 */
export type BarcodeFormat =
	| "QR"
	| "PDF417"
	| "Aztec"
	| "Code128"
	| "Code39"
	| "Codabar"
	| "EAN13"
	| "ITF";

export interface Barcode {
	/** Text shown near the barcode, e.g. the code in human-readable form. */
	altText?: string;
	/** Defaults to `"QR"`. */
	format?: BarcodeFormat;
	/** The encoded message. */
	value: string;
}

/** A barcode as validated, with its format default applied. */
export interface ParsedBarcode extends Barcode {
	/** The barcode's format; `"QR"` when the input left it out. */
	format: BarcodeFormat;
}

export const barcode = object<ParsedBarcode>({
	format: withDefault(
		picklist([
			"QR",
			"PDF417",
			"Aztec",
			"Code128",
			"Code39",
			"Codabar",
			"EAN13",
			"ITF",
		]),
		() => "QR"
	),
	value: nonEmpty,
	altText: optional(string),
});
