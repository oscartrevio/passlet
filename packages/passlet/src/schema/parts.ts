import { z } from "zod";

export const hexColor = z
	.string()
	.regex(/^#[0-9a-fA-F]{6}$/, 'must be a 6-digit hex color like "#1a1a1a"')
	.optional();

// BCP 47 language tag: primary subtag (2-3 lowercase letters) followed by optional subtags.
// Examples: "en", "en-US", "zh-Hans", "zh-Hans-CN", "es-419"
const BCP47_RE = /^[a-z]{2,3}(-[A-Za-z0-9]+)*$/;
export const localeCodeSchema = z
	.string()
	.regex(
		BCP47_RE,
		'must be a BCP 47 language tag (e.g. "en-US", "es", "zh-Hans")'
	);

export const localDateTime = (message: string) =>
	z.iso.datetime({ offset: true, local: true, message });

const imageValue = z.union([
	z.url(),
	z.custom<Uint8Array>((v) => v instanceof Uint8Array),
]);

// Resolution variants: retina is @2x; superRetina is @3x.
export const imageSet = z
	.union([
		imageValue,
		z.object({
			base: imageValue,
			retina: imageValue.optional(),
			superRetina: imageValue.optional(),
		}),
	])
	.optional();

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
// ("A date or time value needs to include a time zone" — PassFieldContent).
// Matches a trailing UTC designator (Z) or numeric offset (±HH:MM / ±HHMM).
const TIMEZONE_RE = /(Z|[+-]\d{2}:?\d{2})$/;

export const fieldDefSchema = z
	.object({
		// Apple: headerFields / primaryFields / secondaryFields / auxiliaryFields / backFields
		// Google: generic passes put primary in subheader (label) + header (value);
		// other types and slots become textModulesData rows.
		slot: z.enum(["header", "primary", "secondary", "auxiliary", "back"]),
		key: z.string(),
		// Apple documents PassFieldContent.label as optional. Google's
		// textModulesData header falls back to the field key when it is omitted.
		label: z.string().optional(),
		value: z.string().optional(),
		// Apple: attributedValue — the field value with HTML markup. Only the <a>
		// tag and its href attribute are supported, and it overrides value.
		// Not used on watchOS. Apple-only — ignored by Google.
		attributedValue: z.string().optional(),
		// Apple: dataDetectorTypes — back fields only. Omit to keep Apple's default
		// (all detectors); pass an empty array to disable them entirely.
		dataDetectorTypes: z.array(dataDetectorTypeSchema).optional(),
		// Apple: ignoresTimeZone — renders the date/time in the time zone carried by
		// value instead of the device's. Defaults to false.
		ignoresTimeZone: z.boolean().optional(),
		// Apple: isRelative — renders the date as a relative date ("in 3 days").
		// Defaults to false. Neither key affects pass relevance.
		isRelative: z.boolean().optional(),
		// Apple: field-level semantics dictionary, merged over the tags passlet
		// derives from the pass config (user-supplied values win).
		semantics: semanticTagsSchema.optional(),
		// Apple shows a change notification only if the message contains the "%@"
		// placeholder, which it replaces with the new value.
		changeMessage: z
			.string()
			.refine((v) => v.includes("%@"), {
				message: 'changeMessage must contain the "%@" placeholder',
			})
			.optional(),
		dateStyle: dateStyleSchema.optional(),
		timeStyle: dateStyleSchema.optional(),
		numberStyle: numberStyleSchema.optional(),
		currencyCode: z.string().optional(),
		textAlignment: textAlignmentSchema.optional(),
		row: z.union([z.literal(0), z.literal(1)]).optional(),
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
	format: barcodeFormatSchema.default("QR"),
	value: z.string().min(1, "barcode.value must not be empty"),
	altText: z.string().optional(),
});

// Bluetooth Low Energy beacon — shows the pass on lock screen when nearby
export const beaconSchema = z.object({
	// Required: device UUID of the Bluetooth Low Energy beacon
	proximityUUID: z.uuid(),
	// 16-bit major value to narrow the region of the beacon
	major: z.number().int().min(0).max(65_535).optional(),
	// 16-bit minor value to further narrow the region of the beacon
	minor: z.number().int().min(0).max(65_535).optional(),
	// Text shown on lock screen when the pass becomes relevant near this beacon
	relevantText: z.string().optional(),
});

// Entry for relevantDates (replaces the deprecated relevantDate).
// Apple accepts either a single moment ({ date }) or an interval
// ({ startDate, endDate }) — and requires endDate whenever startDate is given.
export const relevantDateSchema = z.union([
	z.object({
		date: z.iso.datetime({
			message: 'must be an ISO datetime e.g. "2024-06-01T20:00:00Z"',
		}),
	}),
	z.object({
		startDate: z.iso.datetime({
			message: 'must be an ISO datetime e.g. "2024-06-01T20:00:00Z"',
		}),
		endDate: z.iso.datetime({
			message: 'must be an ISO datetime e.g. "2024-06-01T23:00:00Z"',
		}),
	}),
]);

// Info message shown inside the pass view (e.g. alerts, promotions, expiry notices).
// Class-level messages appear for all holders; object-level messages are per-recipient.
export const googleMessageSchema = z.object({
	header: z.string(),
	body: z.string(),
	id: z.string().optional(),
	// TEXT (default, in-app only) or TEXT_AND_NOTIFY (in-app + Android push).
	// Google's EXPIRATION_NOTIFICATION value is documented as unsupported, so it
	// is intentionally not offered here.
	messageType: z.enum(["TEXT", "TEXT_AND_NOTIFY"]).default("TEXT"),
	displayInterval: z
		.object({
			start: z.object({ date: z.iso.datetime() }).optional(),
			end: z.object({ date: z.iso.datetime() }).optional(),
		})
		.optional(),
});

// App deep link shown on the pass — supports Android, iOS, and web targets.
const googleAppLinkInfoSchema = z.object({
	// Deep link URI (e.g. intent:// for Android, https:// scheme for iOS universal links)
	uri: z.url(),
	title: z.string().optional(),
	description: z.string().optional(),
	logoUrl: z.url().optional(),
});

export const googleAppLinkDataSchema = z.object({
	android: googleAppLinkInfoSchema.optional(),
	ios: googleAppLinkInfoSchema.optional(),
	web: googleAppLinkInfoSchema.optional(),
});

// A single row of Google's linksModuleData. The URI must carry a scheme —
// Google accepts web (https:), map (geo:), telephone (tel:) and email (mailto:).
const googleLinkSchema = z.object({
	uri: z.string().min(1, "google.links[].uri must not be empty"),
	// Shown as the link's title. Google recommends 20 characters or fewer so the
	// whole string fits on smaller screens.
	description: z.string().optional(),
	id: z.string().optional(),
});

// A single entry of Google's imageModulesData — a 100%-width image in the pass
// detail view. Google displays at most one from the class and one from the object.
const googleImageModuleSchema = z.object({
	// URL only — Google Wallet does not accept binary uploads
	url: z.url(),
	id: z.string().optional(),
});

// A single entry of Google's valueAddedModuleData — a tappable card linking to a
// related service (parking, merchandise, food ordering). header and uri are required.
const googleValueAddedSchema = z.object({
	// Google truncates past 60 characters
	header: z.string().min(1, "google.valueAdded[].header must not be empty"),
	// Web link or Android deep link opened when the module is tapped
	uri: z.string().min(1, "google.valueAdded[].uri must not be empty"),
	// Google truncates past 50 characters
	body: z.string().optional(),
	// Recommended ratio is 1:1 — Google resizes to fit
	imageUrl: z.url().optional(),
	// Lower values render first; unset sorts last
	sortIndex: z.number().int().optional(),
});

export const googleModulesSchema = z.object({
	// Google: linksModuleData.uris
	links: z.array(googleLinkSchema).optional(),
	// Google: imageModulesData
	images: z.array(googleImageModuleSchema).optional(),
	// Google: valueAddedModuleData — a maximum of ten per class and per object
	valueAdded: z
		.array(googleValueAddedSchema)
		.max(10, "google.valueAdded accepts at most 10 modules")
		.optional(),
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
	altitude: z.number().optional(),
	// Apple: text shown on lock screen when the pass becomes relevant near this location
	// Google: no equivalent — ignored
	relevantText: z.string().optional(),
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
export type Location = z.infer<typeof locationSchema>;
export type ImageSource = string | Uint8Array;
export type ImageSet =
	| ImageSource
	| { base: ImageSource; retina?: ImageSource; superRetina?: ImageSource };
export type BarcodeFormat = z.infer<typeof barcodeFormatSchema>;
export type Barcode = z.infer<typeof barcodeSchema>;
export interface GoogleImage {
	sourceUri: { uri: string };
}
export type DateStyle = z.infer<typeof dateStyleSchema>;
export type NumberStyle = z.infer<typeof numberStyleSchema>;
export type TextAlignment = z.infer<typeof textAlignmentSchema>;
export type DataDetectorType = z.infer<typeof dataDetectorTypeSchema>;
export type SemanticTags = z.infer<typeof semanticTagsSchema>;
export type FieldDef = z.infer<typeof fieldDefSchema>;
export type GooglePassMessage = z.infer<typeof googleMessageSchema>;
export type AppLinkData = z.infer<typeof googleAppLinkDataSchema>;
export type GoogleLink = z.infer<typeof googleLinkSchema>;
export type GoogleImageModule = z.infer<typeof googleImageModuleSchema>;
export type GoogleValueAddedModule = z.infer<typeof googleValueAddedSchema>;
export type GoogleModules = z.infer<typeof googleModulesSchema>;
