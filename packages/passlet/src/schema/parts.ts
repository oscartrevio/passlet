// biome-ignore lint/performance/noNamespaceImport: the namespace tree-shakes; zod/mini's named `z` export bundles all of zod.
import * as z from "zod/mini";

export const hexColor = z.optional(
	z
		.string()
		.check(
			z.regex(/^#[0-9a-fA-F]{6}$/, 'must be a 6-digit hex color like "#1a1a1a"')
		)
);

// BCP 47 language tag: primary subtag (2-3 lowercase letters) followed by optional subtags.
// Examples: "en", "en-US", "zh-Hans", "zh-Hans-CN", "es-419"
const BCP47_RE = /^[a-z]{2,3}(-[A-Za-z0-9]+)*$/;
export const localeCodeSchema = z
	.string()
	.check(
		z.regex(
			BCP47_RE,
			'must be a BCP 47 language tag (e.g. "en-US", "es", "zh-Hans")'
		)
	);

export const localDateTime = (message: string) =>
	z.iso.datetime({ offset: true, local: true, message });

const imageValue = z.union([
	z.url(),
	z.custom<Uint8Array>((v) => v instanceof Uint8Array),
]);

// Resolution variants: retina is @2x; superRetina is @3x.
export const imageSet = z.optional(
	z.union([
		imageValue,
		z.object({
			base: imageValue,
			retina: z.optional(imageValue),
			superRetina: z.optional(imageValue),
		}),
	])
);

export const dateStyleSchema = z.enum([
	"none",
	"short",
	"medium",
	"long",
	"full",
]);
export const numberStyleSchema = z.enum([
	"decimal",
	"percent",
	"scientific",
	"spellOut",
]);
export const textAlignmentSchema = z.enum([
	"left",
	"center",
	"right",
	"natural",
]);
export const dataDetectorTypeSchema = z.enum([
	"phoneNumber",
	"link",
	"address",
	"calendarEvent",
]);

// Machine-readable metadata (Apple's SemanticTags). Apple accepts a semantics
// dictionary at the root of pass.json and as a top-level key of any field
// dictionary. Values are strings, numbers, booleans or structured tag types
// (SemanticTagType.Seat, .CurrencyAmount, …), so the shape stays open.
export const semanticTagsSchema = z.record(z.string(), z.unknown());

// Apple requires a time zone on any value rendered with dateStyle/timeStyle
// ("A date or time value needs to include a time zone" — PassFieldContent)
// and on every pass.json date, which are W3C timestamps.
// Matches a trailing UTC designator (Z) or numeric offset (±HH:MM / ±HHMM).
export const TIMEZONE_RE = /(Z|[+-]\d{2}:?\d{2})$/;

export const fieldDefSchema = z
	.object({
		// Apple: headerFields / primaryFields / secondaryFields / auxiliaryFields / backFields
		// Google: generic passes put primary in subheader (label) + header (value);
		// other types and slots become textModulesData rows.
		slot: z.enum(["header", "primary", "secondary", "auxiliary", "back"]),
		key: z.string(),
		// Apple documents PassFieldContent.label as optional. Google's
		// textModulesData header falls back to the field key when it is omitted.
		label: z.optional(z.string()),
		value: z.optional(z.string()),
		// Apple: attributedValue — the field value with HTML markup. Only the <a>
		// tag and its href attribute are supported, and it overrides value.
		// Not used on watchOS. Apple-only — ignored by Google.
		attributedValue: z.optional(z.string()),
		// Apple: dataDetectorTypes — back fields only. Omit to keep Apple's default
		// (all detectors); pass an empty array to disable them entirely.
		dataDetectorTypes: z.optional(z.array(dataDetectorTypeSchema)),
		// Apple: ignoresTimeZone — renders the date/time in the time zone carried by
		// value instead of the device's. Defaults to false.
		ignoresTimeZone: z.optional(z.boolean()),
		// Apple: isRelative — renders the date as a relative date ("in 3 days").
		// Defaults to false. Neither key affects pass relevance.
		isRelative: z.optional(z.boolean()),
		// Apple: field-level semantics dictionary, merged over the tags passlet
		// derives from the pass config (user-supplied values win).
		semantics: z.optional(semanticTagsSchema),
		// Apple shows a change notification only if the message contains the "%@"
		// placeholder, which it replaces with the new value.
		changeMessage: z.optional(
			z.string().check(
				z.refine((v) => v.includes("%@"), {
					message: 'changeMessage must contain the "%@" placeholder',
				})
			)
		),
		dateStyle: z.optional(dateStyleSchema),
		timeStyle: z.optional(dateStyleSchema),
		numberStyle: z.optional(numberStyleSchema),
		currencyCode: z.optional(z.string()),
		textAlignment: z.optional(textAlignmentSchema),
		row: z.optional(z.union([z.literal(0), z.literal(1)])),
	})
	.check((ctx) => {
		// When a static value is given, Apple needs it in the right shape for the
		// chosen style: a number for numberStyle, a parseable datetime for
		// dateStyle/timeStyle. (Values supplied at create() time aren't checked here.)
		const f = ctx.value;
		if (f.value == null) {
			return;
		}
		if (f.numberStyle && Number.isNaN(Number(f.value))) {
			ctx.issues.push({
				code: "custom",
				message: "value must be numeric when numberStyle is set",
				input: f.value,
				path: ["value"],
			});
		}
		const hasDateStyle =
			(f.dateStyle && f.dateStyle !== "none") ||
			(f.timeStyle && f.timeStyle !== "none");
		if (!hasDateStyle) {
			return;
		}
		if (Number.isNaN(Date.parse(f.value))) {
			ctx.issues.push({
				code: "custom",
				message:
					"value must be an ISO 8601 datetime when dateStyle/timeStyle is set",
				input: f.value,
				path: ["value"],
			});
			return;
		}
		if (!TIMEZONE_RE.test(f.value)) {
			ctx.issues.push({
				code: "custom",
				message:
					'value must include a time zone when dateStyle/timeStyle is set, e.g. "2024-06-01T20:00:00Z" or "2024-06-01T20:00:00-07:00"',
				input: f.value,
				path: ["value"],
			});
		}
	});

// Formats offered here are the ones both platforms render. Apple's Pass.Barcodes
// accepts PKBarcodeFormatQR, PKBarcodeFormatPDF417, PKBarcodeFormatAztec,
// PKBarcodeFormatCode128 and — from iOS 27 — PKBarcodeFormatCode39,
// PKBarcodeFormatCodabar, PKBarcodeFormatEAN13 and PKBarcodeFormatI2of5.
// Google supports all of these plus DATA_MATRIX, EAN_8, UPC_A and TEXT_ONLY,
// which have no Apple equivalent and are therefore not offered.
// Note: the deprecated singular `barcode` key only accepts QR, PDF417 and
// Aztec, so the other formats are emitted in `barcodes` only.
export const barcodeFormatSchema = z.enum([
	"QR",
	"PDF417",
	"Aztec",
	"Code128",
	// iOS 27 and later
	"Code39",
	"Codabar",
	"EAN13",
	"ITF",
]);

export const barcodeSchema = z.object({
	format: z._default(barcodeFormatSchema, "QR"),
	value: z.string().check(z.minLength(1, "barcode.value must not be empty")),
	altText: z.optional(z.string()),
});

// Bluetooth Low Energy beacon — shows the pass on lock screen when nearby
export const beaconSchema = z.object({
	// Required: device UUID of the Bluetooth Low Energy beacon
	proximityUUID: z.uuid(),
	// 16-bit major value to narrow the region of the beacon
	major: z.optional(z.int().check(z.minimum(0), z.maximum(65_535))),
	// 16-bit minor value to further narrow the region of the beacon
	minor: z.optional(z.int().check(z.minimum(0), z.maximum(65_535))),
	// Text shown on lock screen when the pass becomes relevant near this beacon
	relevantText: z.optional(z.string()),
});

// Entry for relevantDates (replaces the deprecated relevantDate).
// Apple accepts either a single moment ({ date }) or an interval
// ({ startDate, endDate }) — and requires endDate whenever startDate is given.
// Values are W3C timestamps, so a UTC offset is allowed and a time zone is
// required; Apple's own examples use "2025-12-09T13:00-07:00".
// https://developer.apple.com/documentation/walletpasses/creating-an-event-pass-using-semantic-tags
// W3C timestamps may stop at minutes, which zod's datetime only takes alone.
const relevantDateTime = (example: string) =>
	z.union(
		[
			z.iso.datetime({ offset: true }),
			z.iso.datetime({ offset: true, precision: -1 }),
		],
		{ message: `must be an ISO datetime with a time zone e.g. "${example}"` }
	);

export const relevantDateSchema = z.union([
	z.object({ date: relevantDateTime("2024-06-01T20:00:00Z") }),
	z.object({
		startDate: relevantDateTime("2024-06-01T20:00:00-07:00"),
		endDate: relevantDateTime("2024-06-01T23:00:00-07:00"),
	}),
]);

// Info message shown inside the pass view (e.g. alerts, promotions, expiry notices).
// Class-level messages appear for all holders; object-level messages are per-recipient.
export const googleMessageSchema = z.object({
	header: z.string(),
	body: z.string(),
	id: z.optional(z.string()),
	// TEXT (default, in-app only) or TEXT_AND_NOTIFY (in-app + Android push).
	// Google pushes TEXT_AND_NOTIFY only for messages sent with
	// PassTemplate.sendMessage (its AddMessage API).
	// Google's EXPIRATION_NOTIFICATION value is documented as unsupported, so it
	// is intentionally not offered here.
	messageType: z._default(z.enum(["TEXT", "TEXT_AND_NOTIFY"]), "TEXT"),
	displayInterval: z.optional(
		z.object({
			start: z.optional(z.object({ date: z.iso.datetime() })),
			end: z.optional(z.object({ date: z.iso.datetime() })),
		})
	),
});

// App deep link shown on the pass — supports Android, iOS, and web targets.
const googleAppLinkInfoSchema = z.object({
	// Deep link URI (e.g. intent:// for Android, https:// scheme for iOS universal links)
	uri: z.url(),
	title: z.optional(z.string()),
	description: z.optional(z.string()),
	logoUrl: z.optional(z.url()),
});

export const googleAppLinkDataSchema = z.object({
	android: z.optional(googleAppLinkInfoSchema),
	ios: z.optional(googleAppLinkInfoSchema),
	web: z.optional(googleAppLinkInfoSchema),
});

// A single row of Google's linksModuleData. The URI must carry a scheme —
// Google accepts web (https:), map (geo:), telephone (tel:) and email (mailto:).
const googleLinkSchema = z.object({
	uri: z.string().check(z.minLength(1, "google.links[].uri must not be empty")),
	// Shown as the link's title. Google recommends 20 characters or fewer so the
	// whole string fits on smaller screens.
	description: z.optional(z.string()),
	id: z.optional(z.string()),
});

// A single entry of Google's imageModulesData — a 100%-width image in the pass
// detail view. Google displays at most one from the class and one from the object.
const googleImageModuleSchema = z.object({
	// URL only — Google Wallet does not accept binary uploads
	url: z.url(),
	id: z.optional(z.string()),
});

// A single entry of Google's valueAddedModuleData — a tappable card linking to a
// related service (parking, merchandise, food ordering). header and uri are required.
const googleValueAddedSchema = z.object({
	// Google truncates past 60 characters
	header: z
		.string()
		.check(z.minLength(1, "google.valueAdded[].header must not be empty")),
	// Web link or Android deep link opened when the module is tapped
	uri: z
		.string()
		.check(z.minLength(1, "google.valueAdded[].uri must not be empty")),
	// Google truncates past 50 characters
	body: z.optional(z.string()),
	// Recommended ratio is 1:1 — Google resizes to fit
	imageUrl: z.optional(z.url()),
	// Lower values render first; unset sorts last
	sortIndex: z.optional(z.int()),
});

export const googleModulesSchema = z.object({
	// Google: linksModuleData.uris
	links: z.optional(z.array(googleLinkSchema)),
	// Google: imageModulesData
	images: z.optional(z.array(googleImageModuleSchema)),
	// Google: valueAddedModuleData — a maximum of ten per class and per object
	valueAdded: z.optional(
		z
			.array(googleValueAddedSchema)
			.check(z.maxLength(10, "google.valueAdded accepts at most 10 modules"))
	),
});

// Location — geo-relevance for lock screen suggestions.
// Apple: locations[] with longitude, latitude, altitude?, relevantText?
// Google: emitted as merchantLocations[] (latitude, longitude only). Google's
// own locations[] field is deprecated and documented as "currently not supported
// to trigger geo notifications", so altitude and relevantText have no effect.
export const locationSchema = z.object({
	latitude: z.number(),
	longitude: z.number(),
	// Apple: altitude in meters above sea level (optional)
	altitude: z.optional(z.number()),
	// Apple: text shown on lock screen when the pass becomes relevant near this location
	// Google: no equivalent — ignored
	relevantText: z.optional(z.string()),
});

/** A BCP 47 language tag. Common values are suggested without restricting valid strings. */
export type LocaleCode =
	| "en"
	| "en-US"
	| "en-GB"
	| "en-CA"
	| "en-AU"
	| "es"
	| "es-ES"
	| "es-MX"
	| "es-419"
	| "fr"
	| "fr-FR"
	| "fr-CA"
	| "de"
	| "de-DE"
	| "de-AT"
	| "it"
	| "it-IT"
	| "pt"
	| "pt-BR"
	| "pt-PT"
	| "ja"
	| "ja-JP"
	| "ko"
	| "ko-KR"
	| "zh"
	| "zh-CN"
	| "zh-TW"
	| "zh-Hans"
	| "zh-Hant"
	| "ar"
	| "nl"
	| "ru"
	| "sv"
	| "da"
	| "nb"
	| "fi"
	| "pl"
	| "tr"
	| "hi"
	| "id"
	| "th"
	| (string & {});

// Keys are field keys, "name" for the pass title, or "fieldKey_value" for static field values.
export type TranslationMap = Record<string, string>;

export type Locales = Record<string, TranslationMap>;
export interface Location {
	altitude?: number;
	latitude: number;
	longitude: number;
	relevantText?: string;
}
export type ImageSource = string | Uint8Array;
export type ImageSet =
	| ImageSource
	| { base: ImageSource; retina?: ImageSource; superRetina?: ImageSource };
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
	altText?: string;
	/** Defaults to `"QR"`. */
	format?: BarcodeFormat;
	value: string;
}
/** A barcode as validated, with its format default applied. */
export interface ParsedBarcode extends Barcode {
	format: BarcodeFormat;
}
export interface GoogleImage {
	sourceUri: { uri: string };
}
export type DateStyle = "none" | "short" | "medium" | "long" | "full";
export type NumberStyle = "decimal" | "percent" | "scientific" | "spellOut";
export type TextAlignment = "left" | "center" | "right" | "natural";
export type DataDetectorType =
	| "phoneNumber"
	| "link"
	| "address"
	| "calendarEvent";
export type SemanticTags = Record<string, unknown>;
export interface FieldDef {
	attributedValue?: string;
	changeMessage?: string;
	currencyCode?: string;
	dataDetectorTypes?: DataDetectorType[];
	dateStyle?: DateStyle;
	ignoresTimeZone?: boolean;
	isRelative?: boolean;
	key: string;
	label?: string;
	numberStyle?: NumberStyle;
	row?: 0 | 1;
	semantics?: SemanticTags;
	slot: "header" | "primary" | "secondary" | "auxiliary" | "back";
	textAlignment?: TextAlignment;
	timeStyle?: DateStyle;
	value?: string;
}
export type RelevantDate =
	| { date: string }
	| { startDate: string; endDate: string };
export interface Beacon {
	major?: number;
	minor?: number;
	proximityUUID: string;
	relevantText?: string;
}
export interface GooglePassMessage {
	body: string;
	displayInterval?: {
		start?: { date: string };
		end?: { date: string };
	};
	header: string;
	id?: string;
	/**
	 * Defaults to `"TEXT"`. `"TEXT_AND_NOTIFY"` pushes a notification only when
	 * sent with `PassTemplate.sendMessage`.
	 */
	messageType?: "TEXT" | "TEXT_AND_NOTIFY";
}
/** A message as validated, with its type default applied. */
export interface ParsedGooglePassMessage extends GooglePassMessage {
	messageType: "TEXT" | "TEXT_AND_NOTIFY";
}
export interface AppLinkInfo {
	description?: string;
	logoUrl?: string;
	title?: string;
	uri: string;
}
export interface AppLinkData {
	android?: AppLinkInfo;
	ios?: AppLinkInfo;
	web?: AppLinkInfo;
}
export interface GoogleLink {
	description?: string;
	id?: string;
	uri: string;
}
export interface GoogleImageModule {
	id?: string;
	url: string;
}
export interface GoogleValueAddedModule {
	body?: string;
	header: string;
	imageUrl?: string;
	sortIndex?: number;
	uri: string;
}
export interface GoogleModules {
	images?: GoogleImageModule[];
	links?: GoogleLink[];
	valueAdded?: GoogleValueAddedModule[];
}
