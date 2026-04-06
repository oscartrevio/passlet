import { z } from "zod";

// Primitives

const hexColor = z
	.string()
	.regex(/^#[0-9a-fA-F]{6}$/, 'must be a 6-digit hex color like "#1a1a1a"')
	.optional();

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

const appleOptionsSchema = z.object({
	// Required by Apple Wallet — validated at create() time
	icon: imageSet,
	// Apple-only image slots
	background: imageSet,
	thumbnail: imageSet,
	footer: imageSet,
	// Apple: description (shown in Wallet list view, defaults to pass name)
	description: z.string().optional(),
	// Apple: logoText (text shown next to the logo)
	logoText: z.string().optional(),
	// Apple: foregroundColor (text color), labelColor (label text color)
	foregroundColor: hexColor,
	labelColor: hexColor,
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

export const eventPassSchema = basePassSchema.extend({
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
});

// Flight covers air, train, bus, and boat boarding passes.
export const flightPassSchema = basePassSchema.extend({
	type: z.literal("flight"),
	// Apple: transitType (required for boardingPass layout, defaults to "air")
	// Google: inferred from flightHeader
	transitType: z.enum(["air", "train", "bus", "boat"]).optional(),
	// Required by Google flightClass — IATA codes and datetimes
	// Apple: shown as display fields; provider maps these to the correct slots
	carrier: z
		.string()
		.regex(/^[A-Z0-9]{2}$/, 'must be a 2-character IATA carrier code e.g. "AA"')
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
});

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
});

// Inferred types

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
