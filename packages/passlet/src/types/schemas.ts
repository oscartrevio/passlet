import { z } from "zod";

// Primitives

const hexColor = z
	.string()
	.regex(/^#[0-9a-fA-F]{6}$/, 'must be a 6-digit hex color like "#1a1a1a"')
	.optional();

// BCP 47 language tag: primary subtag (2-3 lowercase letters) followed by optional subtags.
// Examples: "en", "en-US", "zh-Hans", "zh-Hans-CN", "es-419"
const BCP47_RE = /^[a-z]{2,3}(-[A-Za-z0-9]+)*$/;
const localeCodeSchema = z
	.string()
	.regex(
		BCP47_RE,
		'must be a BCP 47 language tag (e.g. "en-US", "es", "zh-Hans")'
	);

const imageValue = z.union([
	z.url(),
	z.custom<Uint8Array>((v) => v instanceof Uint8Array),
]);

// An image can be a single source or an object with resolution variants.
// base is required when using the object form; retina (@2x) and superRetina (@3x) are optional.
const imageSet = z
	.union([
		imageValue,
		z.object({
			base: imageValue,
			retina: imageValue.optional(),
			superRetina: imageValue.optional(),
		}),
	])
	.optional();

// Field formatting options

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

// FieldDef — a single display field on a pass.
// slot maps to Apple's field areas; Google uses primary → subheader+header, rest → textModulesData.
export const fieldDefSchema = z.object({
	// Apple: headerFields / primaryFields / secondaryFields / auxiliaryFields / backFields
	// Google: primary → subheader (label) + header (value), others → textModulesData
	slot: z.enum(["header", "primary", "secondary", "auxiliary", "back"]),
	key: z.string(),
	label: z.string(),
	value: z.string().optional(),
	changeMessage: z.string().optional(),
	dateStyle: dateStyleSchema.optional(),
	timeStyle: dateStyleSchema.optional(),
	numberStyle: numberStyleSchema.optional(),
	currencyCode: z.string().optional(),
	textAlignment: textAlignmentSchema.optional(),
	row: z.union([z.literal(0), z.literal(1)]).optional(),
});

// Barcode
// Google supports AZTEC, CODE_39, CODE_128, CODABAR, DATA_MATRIX, EAN_8, EAN_13, ITF_14, PDF_417, QR_CODE, UPC_A and TEXT_ONLY barcodes. Apple only supports PKBarcodeFormatQR, PKBarcodeFormatPDF417, PKBarcodeFormatAztec, and PKBarcodeFormatCode128 formats, but we exclude that since it's not widely supported by barcode scanners.
export const barcodeFormatSchema = z.enum(["QR", "PDF417", "Aztec", "Code128"]);

export const barcodeSchema = z.object({
	format: barcodeFormatSchema.default("QR"),
	value: z.string().min(1, "barcode.value must not be empty"),
	altText: z.string().optional(),
});

// Apple-specific options — no cross-platform equivalent

// Bluetooth Low Energy beacon — shows the pass on lock screen when nearby
const beaconSchema = z.object({
	// Required: device UUID of the Bluetooth Low Energy beacon
	proximityUUID: z.uuid(),
	// 16-bit major value to narrow the region of the beacon
	major: z.number().int().min(0).max(65_535).optional(),
	// 16-bit minor value to further narrow the region of the beacon
	minor: z.number().int().min(0).max(65_535).optional(),
	// Text shown on lock screen when the pass becomes relevant near this beacon
	relevantText: z.string().optional(),
});

// Date interval for relevantDates (replaces the deprecated relevantDate)
const relevantDateSchema = z.object({
	startDate: z.iso.datetime({
		message: 'must be an ISO datetime e.g. "2024-06-01T20:00:00Z"',
	}),
	endDate: z.iso
		.datetime({
			message: 'must be an ISO datetime e.g. "2024-06-01T23:00:00Z"',
		})
		.optional(),
});

// Base Apple options — applicable to all pass types
const appleOptionsSchema = z.object({
	// Required by Apple Wallet — validated at create() time
	icon: imageSet,
	// Apple-only image slots
	background: imageSet,
	thumbnail: imageSet,
	footer: imageSet,
	// Apple: description (shown in Wallet list view, defaults to pass name)
	description: z.string().optional(),
	// Apple: logoText (text shown next to the logo, not for poster event tickets)
	logoText: z.string().optional(),
	// Apple: foregroundColor (text color), labelColor (label text color)
	foregroundColor: hexColor,
	labelColor: hexColor,
	// Deprecated — use relevantDates instead
	relevantDate: z.iso
		.datetime({
			message: 'must be an ISO datetime e.g. "2024-06-01T20:00:00Z"',
		})
		.optional(),
	// Date intervals during which the pass is relevant (replaces relevantDate)
	relevantDates: z.array(relevantDateSchema).optional(),
	// Groups passes of the same type into a single stack in Wallet
	groupingIdentifier: z.string().optional(),
	// Disables the glossy shine effect rendered over strip images
	suppressStripShine: z.boolean().optional(),
	// NFC payload — message is passed to the contactless reader on tap
	nfc: z
		.object({
			message: z.string(),
			// Public key used to encrypt the NFC payload (Base64-encoded X.509)
			encryptionPublicKey: z.string().optional(),
		})
		.optional(),
	// Deep link opened when the user taps "Open" on the pass (requires associatedStoreIdentifiers)
	appLaunchURL: z.url().optional(),
	// App Store app IDs — adds an "Open" button that launches your app from Wallet
	associatedStoreIdentifiers: z.array(z.number().int().positive()).optional(),
	// Maximum distance in meters from a location at which the pass is shown
	maxDistance: z.number().positive().optional(),
	// Removes the Share button from the back of the pass
	sharingProhibited: z.boolean().optional(),
	// Arbitrary JSON passed to your companion app via NFC or URL — not shown to users
	userInfo: z.record(z.string(), z.unknown()).optional(),
	// URL for a web service that receives push update notifications for this pass
	webServiceURL: z.url().optional(),
	// Authentication token sent with web service requests (required with webServiceURL)
	authenticationToken: z.string().min(16).optional(),
	// Bluetooth LE beacons that trigger lock screen relevance
	beacons: z.array(beaconSchema).optional(),
});

// Event-specific Apple options — includes poster event ticket fields
const appleEventOptionsSchema = appleOptionsSchema.extend({
	// Text next to the logo on poster event tickets (use logoText for standard event tickets)
	eventLogoText: z.string().optional(),
	// Background color for the footer bar on poster event tickets
	footerBackgroundColor: hexColor,
	// Disables the header darkening gradient on poster event tickets
	suppressHeaderDarkening: z.boolean().optional(),
	// Derives foreground and label colors from the background image (poster event tickets only)
	useAutomaticColors: z.boolean().optional(),
	// Schemes to validate the pass against (falls back to designed type if all fail)
	preferredStyleSchemes: z.array(z.string()).optional(),
	// Additional App Store app IDs shown in the event guide (poster event tickets only)
	auxiliaryStoreIdentifiers: z.array(z.number().int().positive()).optional(),
	// Poster event ticket action URLs
	accessibilityURL: z.url().optional(),
	addOnURL: z.url().optional(),
	bagPolicyURL: z.url().optional(),
	contactVenueEmail: z.email().optional(),
	contactVenuePhoneNumber: z.string().optional(),
	contactVenueWebsite: z.url().optional(),
	directionsInformationURL: z.url().optional(),
	merchandiseURL: z.url().optional(),
	orderFoodURL: z.url().optional(),
	parkingInformationURL: z.url().optional(),
	purchaseParkingURL: z.url().optional(),
	sellURL: z.url().optional(),
	transferURL: z.url().optional(),
	transitInformationURL: z.url().optional(),
});

// Flight-specific Apple options — boarding pass action URLs
const appleFlightOptionsSchema = appleOptionsSchema.extend({
	changeSeatURL: z.url().optional(),
	entertainmentURL: z.url().optional(),
	managementURL: z.url().optional(),
	purchaseAdditionalBaggageURL: z.url().optional(),
	purchaseLoungeAccessURL: z.url().optional(),
	purchaseWifiURL: z.url().optional(),
	registerServiceAnimalURL: z.url().optional(),
	reportLostBagURL: z.url().optional(),
	requestWheelchairURL: z.url().optional(),
	trackBagsURL: z.url().optional(),
	transitProviderEmail: z.email().optional(),
	transitProviderPhoneNumber: z.string().optional(),
	transitProviderWebsiteURL: z.url().optional(),
	upgradeURL: z.url().optional(),
});

// Google-specific options — no cross-platform equivalent

const googleOptionsSchema = z.object({
	// Google: wideLogo — wider variant of the logo shown on some pass layouts
	wideLogo: z.url().optional(),
	// Google: issuerName — displayed as the pass issuer
	issuerName: z.string().optional(),
});

// Location — geo-relevance for lock screen suggestions.
// Apple: locations[] with longitude, latitude, altitude?, relevantText?
// Google: locations[] with latitude, longitude (altitude and relevantText ignored)
export const locationSchema = z.object({
	latitude: z.number(),
	longitude: z.number(),
	// Apple: altitude in meters above sea level (optional)
	altitude: z.number().optional(),
	// Apple: text shown on lock screen when the pass becomes relevant near this location
	// Google: no equivalent — ignored
	relevantText: z.string().optional(),
});

// Base pass config — shared across all pass types

const basePassSchema = z.object({
	// Apple: description (pass name shown in Wallet list)
	// Google: cardTitle
	id: z.string().min(1, "PassConfig missing: id"),
	name: z.string().min(1, "PassConfig missing: name"),

	// Apple: backgroundColor
	// Google: hexBackgroundColor
	color: hexColor,

	// Shared logo image.
	// Apple: logo (accepts bytes or URL)
	// Google: logo (URL only — validated at create() time)
	logo: imageSet,

	// Shared banner image — same visual purpose, different placement per platform.
	// Apple: strip (shown behind the fields, top of pass)
	// Google: hero (shown at the bottom of the pass)
	banner: imageSet,

	// Geo-relevance — show pass on lock screen when near these coordinates.
	// Apple: locations[] — up to 10 entries
	// Google: locations[] — up to 20 entries
	locations: z.array(locationSchema).optional(),

	// Display fields — use field.primary(), field.secondary(), etc.
	// Apple: maps to headerFields / primaryFields / secondaryFields / auxiliaryFields / backFields
	// Google: primary → subheader + header, all others → textModulesData
	fields: z.array(fieldDefSchema).default([]),

	// Translations for field labels and pass-level strings.
	// Keys are field keys (matching field.key) or the reserved key "name" for the pass title.
	// Use "fieldKey_value" to translate a field's static default value.
	// Apple: generates {language}.lproj/pass.strings files in the .pkpass zip.
	// Google: adds translatedValues to LocalizedString objects.
	locales: z
		.record(localeCodeSchema, z.record(z.string(), z.string()))
		.optional(),

	apple: appleOptionsSchema.optional(),
	google: googleOptionsSchema.optional(),
});

// Per-type pass configs
// Each type adds structured properties that providers need beyond display fields.

export const loyaltyPassSchema = basePassSchema.extend({
	type: z.literal("loyalty"),
	// No extra structured props — Google maps field keys by convention:
	// "points" → loyaltyPoints, "member" → accountName, "memberId" → accountId
});

export const eventPassSchema = basePassSchema
	.extend({
		type: z.literal("event"),
		// Apple: relevant date for lock screen suggestion
		// Google: localScheduledStartDateTime (required for eventTicketClass)
		startsAt: z.iso
			.datetime({
				message: 'must be an ISO datetime e.g. "2024-06-01T20:00:00Z"',
			})
			.optional(),
		endsAt: z.iso
			.datetime({
				message: 'must be an ISO datetime e.g. "2024-06-01T23:00:00Z"',
			})
			.optional(),
	})
	.extend({ apple: appleEventOptionsSchema.optional() });

// Flight covers air, train, bus, and boat boarding passes.
export const flightPassSchema = basePassSchema
	.extend({
		type: z.literal("flight"),
		// Apple: transitType (required for boardingPass layout, defaults to "air")
		// Google: inferred from flightHeader
		transitType: z.enum(["air", "train", "bus", "boat"]).optional(),
		// Required by Google flightClass — IATA codes and datetimes
		// Apple: shown as display fields; provider maps these to the correct slots
		carrier: z
			.string()
			.regex(
				/^[A-Z0-9]{2}$/,
				'must be a 2-character IATA carrier code e.g. "AA"'
			)
			.optional(),
		flightNumber: z
			.string()
			.regex(/^\d{1,4}[A-Z]?$/, 'must be a flight number e.g. "100" or "1234A"')
			.optional(),
		origin: z
			.string()
			.regex(/^[A-Z]{3}$/, 'must be a 3-letter IATA airport code e.g. "JFK"')
			.optional(),
		destination: z
			.string()
			.regex(/^[A-Z]{3}$/, 'must be a 3-letter IATA airport code e.g. "LAX"')
			.optional(),
		departure: z.iso
			.datetime({
				message: 'must be an ISO datetime e.g. "2024-06-01T08:00:00Z"',
			})
			.optional(),
		arrival: z.iso
			.datetime({
				message: 'must be an ISO datetime e.g. "2024-06-01T11:30:00Z"',
			})
			.optional(),
		// passengerName is per-recipient — pass in values at create() time
	})
	.extend({ apple: appleFlightOptionsSchema.optional() });

export const couponPassSchema = basePassSchema.extend({
	type: z.literal("coupon"),
	// Google: redemptionChannel (required for offerClass)
	// Apple: no equivalent — ignored
	redemptionChannel: z.enum(["online", "instore", "both"]).optional(),
});

export const giftCardPassSchema = basePassSchema.extend({
	type: z.literal("giftCard"),
	// Google: balance.currencyCode (needed to format the balance amount)
	// Apple: use currencyCode on the balance field definition instead
	currency: z.string().optional(), // ISO 4217 e.g. "USD"
});

export const genericPassSchema = basePassSchema.extend({
	type: z.literal("generic"),
	// No extra structured props — full control via fields
});

// Discriminated union — the full PassConfig type

export const passConfigSchema = z.discriminatedUnion("type", [
	loyaltyPassSchema,
	eventPassSchema,
	flightPassSchema,
	couponPassSchema,
	giftCardPassSchema,
	genericPassSchema,
]);

// Create config — per-recipient values supplied at issue time

export const createConfigSchema = z.object({
	serialNumber: z.string().min(1, "CreateConfig missing: serialNumber"),
	barcode: barcodeSchema.optional(),
	// Apple: no equivalent — ignored
	// Google: validTimeInterval.start
	validFrom: z.iso
		.datetime({
			message: 'must be an ISO datetime e.g. "2024-01-01T00:00:00Z"',
		})
		.optional(),
	expiresAt: z.iso
		.datetime({
			message: 'must be an ISO datetime e.g. "2025-01-01T00:00:00Z"',
		})
		.optional(),
	// Per-recipient field values. null hides the field for this recipient.
	values: z.record(z.string(), z.string().nullable()).optional(),
	// Apple-specific per-recipient options.
	// Google has no equivalent for these — all are ignored by the Google provider.
	apple: z
		.object({
			// Mark this issued pass as void. Displays a "Void" banner on the pass.
			// For Google, use pass.expire() instead — it transitions state via the API.
			voided: z.boolean().optional(),
		})
		.optional(),
});

// Inferred types

// Common BCP 47 language tags — autocomplete hints while still accepting any valid string.
type CommonLocaleCode =
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

// A BCP 47 language tag. Common values are suggested by autocomplete; any valid tag is accepted.
export type LocaleCode = CommonLocaleCode;

// Keys are field keys, "name" for the pass title, or "fieldKey_value" for static field values.
export type TranslationMap = Record<string, string>;

export type Locales = Record<LocaleCode, TranslationMap>;
export type Location = z.infer<typeof locationSchema>;
export type ImageSource = string | Uint8Array;
export type ImageSet =
	| ImageSource
	| { base: ImageSource; retina?: ImageSource; superRetina?: ImageSource };
export type BarcodeFormat = z.infer<typeof barcodeFormatSchema>;
export type Barcode = z.infer<typeof barcodeSchema>;
export type DateStyle = z.infer<typeof dateStyleSchema>;
export type NumberStyle = z.infer<typeof numberStyleSchema>;
export type TextAlignment = z.infer<typeof textAlignmentSchema>;
export type FieldDef = z.infer<typeof fieldDefSchema>;

// Per-type field keys — TypeScript suggests these in autocomplete while still accepting any string.
// The `string & {}` trick preserves suggestions without restricting the type.
type FieldDefWith<K extends string> = Omit<FieldDef, "key"> & { key: K };

type LoyaltyFieldKey =
	| "points"
	| "tier"
	| "member"
	| "memberId"
	| (string & {});
type EventFieldKey =
	| "date"
	| "venue"
	| "seat"
	| "row"
	| "section"
	| "gate"
	| (string & {});
type FlightFieldKey =
	| "gate"
	| "seat"
	| "boardingClass"
	| "boardingZone"
	| (string & {});
type CouponFieldKey =
	| "offer"
	| "discount"
	| "code"
	| "expires"
	| "terms"
	| (string & {});
type GiftCardFieldKey = "balance" | "pin" | "initialValue" | (string & {});

export type LoyaltyPassConfig = Omit<
	z.infer<typeof loyaltyPassSchema>,
	"fields"
> & { fields: FieldDefWith<LoyaltyFieldKey>[] };
export type EventPassConfig = Omit<
	z.infer<typeof eventPassSchema>,
	"fields"
> & { fields: FieldDefWith<EventFieldKey>[] };
export type FlightPassConfig = Omit<
	z.infer<typeof flightPassSchema>,
	"fields"
> & { fields: FieldDefWith<FlightFieldKey>[] };
export type CouponPassConfig = Omit<
	z.infer<typeof couponPassSchema>,
	"fields"
> & { fields: FieldDefWith<CouponFieldKey>[] };
export type GiftCardPassConfig = Omit<
	z.infer<typeof giftCardPassSchema>,
	"fields"
> & { fields: FieldDefWith<GiftCardFieldKey>[] };
export type GenericPassConfig = z.infer<typeof genericPassSchema>;
export type PassConfig = z.infer<typeof passConfigSchema>;
export type CreateConfig = z.infer<typeof createConfigSchema>;
