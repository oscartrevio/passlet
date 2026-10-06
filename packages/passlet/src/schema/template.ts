import { z } from "zod";
import {
	beaconSchema,
	type FieldDef,
	fieldDefSchema,
	googleAppLinkDataSchema,
	googleMessageSchema,
	googleModulesSchema,
	hexColor,
	imageSet,
	localDateTime,
	localeCodeSchema,
	locationSchema,
	relevantDateSchema,
	semanticTagsSchema,
} from "./parts";

const appleOptionsSchema = z.object({
	// Required when Apple credentials are configured.
	icon: imageSet,
	// Apple image slots (accepts bytes or URL)
	logo: imageSet,
	strip: imageSet,
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
	// Date intervals during which the pass is relevant
	relevantDates: z.array(relevantDateSchema).optional(),
	// Disables the glossy shine effect rendered over strip images
	suppressStripShine: z.boolean().optional(),
	// NFC payload — message is passed to the contactless reader on tap
	nfc: z
		.object({
			message: z.string(),
			// Required by Apple: public key used to encrypt the NFC payload
			// (Base64-encoded X.509 SubjectPublicKeyInfo, ECDH P-256). NFC does
			// not function without it.
			encryptionPublicKey: z.string(),
			// Requires the user to authenticate (Face ID / Touch ID / passcode) on
			// every use of the NFC pass. Defaults to false. iOS 13.1 and later —
			// Apple recommends pairing it with sharingProhibited so the pass cannot
			// be shared to an older OS that ignores the requirement.
			requiresAuthentication: z.boolean().optional(),
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
	// Bluetooth LE beacons that trigger lock screen relevance
	beacons: z.array(beaconSchema).optional(),
	// Pass-level semantic tags (Apple's SemanticTags dictionary). Merged over the
	// tags passlet derives from the template — entries given here win.
	semantics: semanticTagsSchema.optional(),
});

const appleEventTicketOptionsSchema = appleOptionsSchema
	.extend({
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
	})
	.superRefine((apple, ctx) => {
		// "If you specify a strip image, do not specify a background image or a
		// thumbnail." — Pass Design and Creation, event ticket images.
		if (apple.strip && (apple.background || apple.thumbnail)) {
			ctx.addIssue({
				code: "custom",
				path: ["strip"],
				message:
					"Apple event tickets with a strip image cannot use a background or thumbnail image",
			});
		}
	});

const appleBoardingPassOptionsSchema = appleOptionsSchema.extend({
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

const googleOptionsSchema = z.object({
	// Google image slots (URL only — Google Wallet does not accept binary uploads)
	logo: z.url().optional(),
	hero: z.url().optional(),
	// Google: wideLogo — wider variant of the logo shown on some pass layouts
	wideLogo: z.url().optional(),
	// Google: issuerName — displayed as the pass issuer
	issuerName: z.string().optional(),
	// Required by Google for loyalty, event, flight, coupon, and giftCard classes.
	// Defaults to "UNDER_REVIEW" for new classes; set to "APPROVED" once approved in the console.
	reviewStatus: z
		.enum(["UNDER_REVIEW", "APPROVED", "REJECTED", "DRAFT"])
		.optional(),
	// Smart Tap NFC — enable tap-to-redeem at supported terminals
	enableSmartTap: z.boolean().optional(),
	// Smart Tap issuer IDs allowed to redeem this pass (required when enableSmartTap is true)
	redemptionIssuers: z.array(z.string()).optional(),
	// Class-level info messages shown inside the pass view for all holders
	messages: z.array(googleMessageSchema).optional(),
	// App link shown on the pass to open a companion app
	appLinkData: googleAppLinkDataSchema.optional(),
	// Class-level links, images, and value-added modules (shared by all holders)
	...googleModulesSchema.shape,
});

// Transit vertical options. Their presence switches a flight pass from the air
// vertical (flightClass/flightObject, which requires IATA carrier/airport codes)
// to Google's transitClass/transitObject.
const googleTransitOptionsSchema = z.object({
	// Required by Google transitClass. Defaults from the pass-level transitType
	// ("train" → rail, "bus" → bus, "boat" → ferry) when omitted.
	transitType: z.enum(["bus", "rail", "tram", "ferry", "other"]).optional(),
	// Required by Google transitObject — defaults to one-way.
	tripType: z.enum(["oneWay", "roundTrip"]).optional(),
	// Station names for the ticket leg. Google requires originName whenever
	// destinationName is given. Falls back to the pass-level origin/destination
	// codes when omitted.
	originName: z.string().optional(),
	destinationName: z.string().optional(),
	// Google: transitObject.ticketNumber
	ticketNumber: z.string().optional(),
	// Google: transitClass.transitOperatorName
	operatorName: z.string().optional(),
});

const googleBoardingPassOptionsSchema = googleOptionsSchema.extend({
	// Set to issue the pass as transitClass/transitObject (train, bus, tram,
	// ferry) instead of the default flightClass/flightObject (air).
	transit: googleTransitOptionsSchema.optional(),
});

const baseTemplateSchema = z.object({
	id: z.string().min(1, "TemplateConfig missing: id"),
	name: z.string().min(1, "TemplateConfig missing: name"),

	// Apple: backgroundColor
	// Google: hexBackgroundColor
	color: hexColor,

	// Geo-relevance — show pass on lock screen when near these coordinates.
	// Apple: locations[] — up to 10 entries
	// Google: merchantLocations[] — up to 10 entries per class (the older
	// locations[] field is deprecated and silently triggers nothing)
	locations: z
		.array(locationSchema)
		.max(10, "locations accepts at most 10 entries")
		.optional(),

	fields: z.array(fieldDefSchema).default([]),

	// Translations for field labels and pass-level strings.
	// Keys are field keys (matching field.key) or the reserved key "name" for the pass title.
	// Use "fieldKey_value" to translate a field's static default value.
	// Apple: generates {language}.lproj/pass.strings files in the .pkpass zip.
	// Wallet looks entries up by the literal string that pass.json emits, so each
	// key is resolved to the string it controls when the file is written (a field
	// key becomes that field's label, "name" becomes the pass name). A key that
	// matches no field is written through as-is, which lets a literal string with
	// no field behind it — logoText, say — be translated by keying it directly.
	// Google: adds translatedValues to LocalizedString objects.
	locales: z
		.record(localeCodeSchema, z.record(z.string(), z.string()))
		.optional(),

	apple: appleOptionsSchema.optional(),
	google: googleOptionsSchema.optional(),
});

export const loyaltyTemplateSchema = baseTemplateSchema.extend({
	type: z.literal("loyalty"),
	// No extra structured props — Google maps field keys by convention:
	// "points" → loyaltyPoints, "member" → accountName, "memberId" → accountId
});

export const eventTicketTemplateSchema = baseTemplateSchema.extend({
	type: z.literal("eventTicket"),
	// Venue wall-clock time. Apple: relevant date / eventStartDate semantic.
	// Google: dateTime.start on eventTicketClass (EventDateTime), which accepts
	// an ISO 8601 datetime "with or without an offset" — the value is forwarded
	// verbatim so an offset, when given, reaches Google intact.
	startsAt: localDateTime(
		'must be an ISO datetime e.g. "2024-06-01T20:00:00Z" or "2024-06-01T20:00:00"'
	).optional(),
	endsAt: localDateTime(
		'must be an ISO datetime e.g. "2024-06-01T23:00:00Z" or "2024-06-01T23:00:00"'
	).optional(),
	// Google: eventTicketClass.venue — requires BOTH name and address.
	// Apple: name feeds the venueName semantic tag.
	venue: z
		.object({
			name: z.string().min(1),
			address: z.string().min(1),
		})
		.optional(),
	apple: appleEventTicketOptionsSchema.optional(),
});

export const boardingPassTemplateSchema = baseTemplateSchema.extend({
	type: z.literal("boardingPass"),
	// Apple: required; picks the transit icon between the primary fields.
	// "generic" maps to PKTransitTypeGeneric for transit that is none of the
	// other four.
	// Google: inferred from flightHeader ("generic" falls back to transit OTHER)
	transitType: z.enum(["air", "train", "bus", "boat", "generic"]).optional(),
	// Required by Google flightClass — IATA codes and datetimes
	// Apple: written as semantic tags, not shown; add fields to display them.
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
	// Local airport wall-clock time. Google rejects a UTC offset here (it
	// derives the zone from the airport); an offset, if given, is kept for
	// Apple semantics and stripped for Google.
	departure: localDateTime(
		'must be an ISO datetime e.g. "2024-06-01T08:00:00Z" or "2024-06-01T08:00:00"'
	).optional(),
	arrival: localDateTime(
		'must be an ISO datetime e.g. "2024-06-01T11:30:00Z" or "2024-06-01T11:30:00"'
	).optional(),
	apple: appleBoardingPassOptionsSchema.optional(),
	google: googleBoardingPassOptionsSchema.optional(),
});

export const couponTemplateSchema = baseTemplateSchema.extend({
	type: z.literal("coupon"),
	// Google: redemptionChannel (required for offerClass)
	// Apple: no equivalent — ignored
	// Defaults to "both" — Google requires this field for offerClass
	redemptionChannel: z.enum(["online", "instore", "both"]).default("both"),
});

export const giftCardTemplateSchema = baseTemplateSchema.extend({
	type: z.literal("giftCard"),
	// Google: balance.currencyCode (needed to format the balance amount)
	// Apple: use currencyCode on the balance field definition instead
	currency: z
		.string()
		.regex(/^[A-Z]{3}$/, 'must be a 3-letter ISO 4217 currency code e.g. "USD"')
		.optional(),
});

export const genericTemplateSchema = baseTemplateSchema.extend({
	type: z.literal("generic"),
});

export const templateConfigSchema = z.discriminatedUnion("type", [
	loyaltyTemplateSchema,
	eventTicketTemplateSchema,
	boardingPassTemplateSchema,
	couponTemplateSchema,
	giftCardTemplateSchema,
	genericTemplateSchema,
]);

// Per-type field keys — TypeScript suggests these in autocomplete while still accepting any string.
// The `string & {}` trick preserves suggestions without restricting the type.
type FieldDefWith<K extends string> = Omit<FieldDef, "key"> & { key: K };

type LoyaltyFieldKey =
	| "points"
	| "tier"
	| "member"
	| "memberId"
	| (string & {});
type EventTicketFieldKey =
	| "date"
	| "venue"
	| "seat"
	| "row"
	| "section"
	| "gate"
	| (string & {});
type BoardingPassFieldKey =
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
type GiftCardFieldKey =
	| "balance"
	| "cardNumber"
	| "pin"
	| "initialValue"
	| (string & {});

export type LoyaltyTemplateConfig = Omit<
	z.infer<typeof loyaltyTemplateSchema>,
	"fields"
> & { fields: FieldDefWith<LoyaltyFieldKey>[] };
export type EventTicketTemplateConfig = Omit<
	z.infer<typeof eventTicketTemplateSchema>,
	"fields"
> & { fields: FieldDefWith<EventTicketFieldKey>[] };
export type BoardingPassTemplateConfig = Omit<
	z.infer<typeof boardingPassTemplateSchema>,
	"fields"
> & { fields: FieldDefWith<BoardingPassFieldKey>[] };
export type CouponTemplateConfig = Omit<
	z.infer<typeof couponTemplateSchema>,
	"fields"
> & { fields: FieldDefWith<CouponFieldKey>[] };
export type GiftCardTemplateConfig = Omit<
	z.infer<typeof giftCardTemplateSchema>,
	"fields"
> & { fields: FieldDefWith<GiftCardFieldKey>[] };
export type GenericTemplateConfig = z.infer<typeof genericTemplateSchema>;
export type TemplateConfig = z.infer<typeof templateConfigSchema>;
export type TemplateType = TemplateConfig["type"];
export type GoogleTransitOptions = z.infer<typeof googleTransitOptionsSchema>;
