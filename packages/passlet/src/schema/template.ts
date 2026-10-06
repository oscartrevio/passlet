// biome-ignore lint/performance/noNamespaceImport: the namespace tree-shakes; zod/mini's named `z` export bundles all of zod.
import * as z from "zod/mini";
import {
	type AppLinkData,
	type Beacon,
	beaconSchema,
	type FieldDef,
	fieldDefSchema,
	type GoogleModules,
	type GooglePassMessage,
	googleAppLinkDataSchema,
	googleMessageSchema,
	googleModulesSchema,
	hexColor,
	type ImageSet,
	imageSet,
	type Locales,
	type Location,
	localDateTime,
	localeCodeSchema,
	locationSchema,
	type ParsedGooglePassMessage,
	type RelevantDate,
	relevantDateSchema,
	type SemanticTags,
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
	description: z.optional(z.string()),
	// Apple: logoText (text shown next to the logo, not for poster event tickets)
	logoText: z.optional(z.string()),
	// Apple: foregroundColor (text color), labelColor (label text color)
	foregroundColor: hexColor,
	labelColor: hexColor,
	// Date intervals during which the pass is relevant
	relevantDates: z.optional(z.array(relevantDateSchema)),
	// Disables the glossy shine effect rendered over strip images
	suppressStripShine: z.optional(z.boolean()),
	// NFC payload — message is passed to the contactless reader on tap
	nfc: z.optional(
		z.object({
			message: z.string(),
			// Required by Apple: public key used to encrypt the NFC payload
			// (Base64-encoded X.509 SubjectPublicKeyInfo, ECDH P-256). NFC does
			// not function without it.
			encryptionPublicKey: z.string(),
			// Requires the user to authenticate (Face ID / Touch ID / passcode) on
			// every use of the NFC pass. Defaults to false. iOS 13.1 and later —
			// Apple recommends pairing it with sharingProhibited so the pass cannot
			// be shared to an older OS that ignores the requirement.
			requiresAuthentication: z.optional(z.boolean()),
		})
	),
	// Deep link opened when the user taps "Open" on the pass (requires associatedStoreIdentifiers)
	appLaunchURL: z.optional(z.url()),
	// App Store app IDs — adds an "Open" button that launches your app from Wallet
	associatedStoreIdentifiers: z.optional(z.array(z.int().check(z.positive()))),
	// Maximum distance in meters from a location at which the pass is shown
	maxDistance: z.optional(z.number().check(z.positive())),
	// Removes the Share button from the back of the pass
	sharingProhibited: z.optional(z.boolean()),
	// Arbitrary JSON passed to your companion app via NFC or URL — not shown to users
	userInfo: z.optional(z.record(z.string(), z.unknown())),
	// Bluetooth LE beacons that trigger lock screen relevance
	beacons: z.optional(z.array(beaconSchema)),
	// Pass-level semantic tags (Apple's SemanticTags dictionary). Merged over the
	// tags passlet derives from the template — entries given here win.
	semantics: z.optional(semanticTagsSchema),
});

const appleEventTicketOptionsSchema = z
	.extend(appleOptionsSchema, {
		// Text next to the logo on poster event tickets (use logoText for standard event tickets)
		eventLogoText: z.optional(z.string()),
		// Background color for the footer bar on poster event tickets
		footerBackgroundColor: hexColor,
		// Disables the header darkening gradient on poster event tickets
		suppressHeaderDarkening: z.optional(z.boolean()),
		// Derives foreground and label colors from the background image (poster event tickets only)
		useAutomaticColors: z.optional(z.boolean()),
		// Schemes to validate the pass against (falls back to designed type if all fail)
		preferredStyleSchemes: z.optional(z.array(z.string())),
		// Additional App Store app IDs shown in the event guide (poster event tickets only)
		auxiliaryStoreIdentifiers: z.optional(z.array(z.int().check(z.positive()))),
		// Poster event ticket action URLs
		accessibilityURL: z.optional(z.url()),
		addOnURL: z.optional(z.url()),
		bagPolicyURL: z.optional(z.url()),
		contactVenueEmail: z.optional(z.email()),
		contactVenuePhoneNumber: z.optional(z.string()),
		contactVenueWebsite: z.optional(z.url()),
		directionsInformationURL: z.optional(z.url()),
		merchandiseURL: z.optional(z.url()),
		orderFoodURL: z.optional(z.url()),
		parkingInformationURL: z.optional(z.url()),
		purchaseParkingURL: z.optional(z.url()),
		sellURL: z.optional(z.url()),
		transferURL: z.optional(z.url()),
		transitInformationURL: z.optional(z.url()),
	})
	.check(
		z.superRefine((apple, ctx) => {
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
		})
	);

const appleBoardingPassOptionsSchema = z.extend(appleOptionsSchema, {
	changeSeatURL: z.optional(z.url()),
	entertainmentURL: z.optional(z.url()),
	managementURL: z.optional(z.url()),
	purchaseAdditionalBaggageURL: z.optional(z.url()),
	purchaseLoungeAccessURL: z.optional(z.url()),
	purchaseWifiURL: z.optional(z.url()),
	registerServiceAnimalURL: z.optional(z.url()),
	reportLostBagURL: z.optional(z.url()),
	requestWheelchairURL: z.optional(z.url()),
	trackBagsURL: z.optional(z.url()),
	transitProviderEmail: z.optional(z.email()),
	transitProviderPhoneNumber: z.optional(z.string()),
	transitProviderWebsiteURL: z.optional(z.url()),
	upgradeURL: z.optional(z.url()),
});

const googleOptionsSchema = z.object({
	// Google image slots (URL only — Google Wallet does not accept binary uploads)
	logo: z.optional(z.url()),
	hero: z.optional(z.url()),
	// Google: wideLogo — wider variant of the logo shown on some pass layouts
	wideLogo: z.optional(z.url()),
	// Google: issuerName — displayed as the pass issuer
	issuerName: z.optional(z.string()),
	// Required by Google for loyalty, event, flight, coupon, and giftCard classes.
	// Defaults to "UNDER_REVIEW" for new classes; set to "APPROVED" once approved in the console.
	reviewStatus: z.optional(
		z.enum(["UNDER_REVIEW", "APPROVED", "REJECTED", "DRAFT"])
	),
	// Smart Tap NFC — enable tap-to-redeem at supported terminals
	enableSmartTap: z.optional(z.boolean()),
	// Smart Tap issuer IDs allowed to redeem this pass (required when enableSmartTap is true)
	redemptionIssuers: z.optional(z.array(z.string())),
	// Class-level info messages shown inside the pass view for all holders
	messages: z.optional(z.array(googleMessageSchema)),
	// App link shown on the pass to open a companion app
	appLinkData: z.optional(googleAppLinkDataSchema),
	// Class-level links, images, and value-added modules (shared by all holders)
	...googleModulesSchema.shape,
});

// Transit vertical options. Their presence switches a flight pass from the air
// vertical (flightClass/flightObject, which requires IATA carrier/airport codes)
// to Google's transitClass/transitObject.
const googleTransitOptionsSchema = z.object({
	// Required by Google transitClass. Defaults from the pass-level transitType
	// ("train" → rail, "bus" → bus, "boat" → ferry) when omitted.
	transitType: z.optional(z.enum(["bus", "rail", "tram", "ferry", "other"])),
	// Required by Google transitObject — defaults to one-way.
	tripType: z.optional(z.enum(["oneWay", "roundTrip"])),
	// Station names for the ticket leg. Google requires originName whenever
	// destinationName is given. Falls back to the pass-level origin/destination
	// codes when omitted.
	originName: z.optional(z.string()),
	destinationName: z.optional(z.string()),
	// Google: transitObject.ticketNumber
	ticketNumber: z.optional(z.string()),
	// Google: transitClass.transitOperatorName
	operatorName: z.optional(z.string()),
});

const googleBoardingPassOptionsSchema = z.extend(googleOptionsSchema, {
	// Set to issue the pass as transitClass/transitObject (train, bus, tram,
	// ferry) instead of the default flightClass/flightObject (air).
	transit: z.optional(googleTransitOptionsSchema),
});

const baseTemplateSchema = z.object({
	id: z.string().check(z.minLength(1, "TemplateConfig missing: id")),
	name: z.string().check(z.minLength(1, "TemplateConfig missing: name")),

	// Apple: backgroundColor
	// Google: hexBackgroundColor
	color: hexColor,

	// Geo-relevance — show pass on lock screen when near these coordinates.
	// Apple: locations[] — up to 10 entries
	// Google: merchantLocations[] — up to 10 entries per class (the older
	// locations[] field is deprecated and silently triggers nothing)
	locations: z.optional(
		z
			.array(locationSchema)
			.check(z.maxLength(10, "locations accepts at most 10 entries"))
	),

	fields: z._default(z.array(fieldDefSchema), []),

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
	locales: z.optional(
		z.record(localeCodeSchema, z.record(z.string(), z.string()))
	),

	apple: z.optional(appleOptionsSchema),
	google: z.optional(googleOptionsSchema),
});

export const loyaltyTemplateSchema = z.extend(baseTemplateSchema, {
	type: z.literal("loyalty"),
	// No extra structured props — Google maps field keys by convention:
	// "points" → loyaltyPoints, "member" → accountName, "memberId" → accountId
});

export const eventTicketTemplateSchema = z.extend(baseTemplateSchema, {
	type: z.literal("eventTicket"),
	// Venue wall-clock time. Apple: relevant date / eventStartDate semantic.
	// Google: dateTime.start on eventTicketClass (EventDateTime), which accepts
	// an ISO 8601 datetime "with or without an offset" — the value is forwarded
	// verbatim so an offset, when given, reaches Google intact.
	startsAt: z.optional(
		localDateTime(
			'must be an ISO datetime e.g. "2024-06-01T20:00:00Z" or "2024-06-01T20:00:00"'
		)
	),
	endsAt: z.optional(
		localDateTime(
			'must be an ISO datetime e.g. "2024-06-01T23:00:00Z" or "2024-06-01T23:00:00"'
		)
	),
	// Google: eventTicketClass.venue — requires BOTH name and address.
	// Apple: name feeds the venueName semantic tag.
	venue: z.optional(
		z.object({
			name: z.string().check(z.minLength(1)),
			address: z.string().check(z.minLength(1)),
		})
	),
	apple: z.optional(appleEventTicketOptionsSchema),
});

export const boardingPassTemplateSchema = z.extend(baseTemplateSchema, {
	type: z.literal("boardingPass"),
	// Apple: required; picks the transit icon between the primary fields.
	// "generic" maps to PKTransitTypeGeneric for transit that is none of the
	// other four.
	// Google: inferred from flightHeader ("generic" falls back to transit OTHER)
	transitType: z.optional(z.enum(["air", "train", "bus", "boat", "generic"])),
	// Required by Google flightClass — IATA codes and datetimes
	// Apple: written as semantic tags, not shown; add fields to display them.
	carrier: z.optional(
		z
			.string()
			.check(
				z.regex(
					/^[A-Z0-9]{2}$/,
					'must be a 2-character IATA carrier code e.g. "AA"'
				)
			)
	),
	flightNumber: z.optional(
		z
			.string()
			.check(
				z.regex(
					/^\d{1,4}[A-Z]?$/,
					'must be a flight number e.g. "100" or "1234A"'
				)
			)
	),
	origin: z.optional(
		z
			.string()
			.check(
				z.regex(/^[A-Z]{3}$/, 'must be a 3-letter IATA airport code e.g. "JFK"')
			)
	),
	destination: z.optional(
		z
			.string()
			.check(
				z.regex(/^[A-Z]{3}$/, 'must be a 3-letter IATA airport code e.g. "LAX"')
			)
	),
	// Local airport wall-clock time. Google rejects a UTC offset here (it
	// derives the zone from the airport); an offset, if given, is kept for
	// Apple semantics and stripped for Google.
	departure: z.optional(
		localDateTime(
			'must be an ISO datetime e.g. "2024-06-01T08:00:00Z" or "2024-06-01T08:00:00"'
		)
	),
	arrival: z.optional(
		localDateTime(
			'must be an ISO datetime e.g. "2024-06-01T11:30:00Z" or "2024-06-01T11:30:00"'
		)
	),
	apple: z.optional(appleBoardingPassOptionsSchema),
	google: z.optional(googleBoardingPassOptionsSchema),
});

export const couponTemplateSchema = z.extend(baseTemplateSchema, {
	type: z.literal("coupon"),
	// Google: redemptionChannel (required for offerClass)
	// Apple: no equivalent — ignored
	// Defaults to "both" — Google requires this field for offerClass
	redemptionChannel: z._default(z.enum(["online", "instore", "both"]), "both"),
});

export const giftCardTemplateSchema = z.extend(baseTemplateSchema, {
	type: z.literal("giftCard"),
	// Google: balance.currencyCode (needed to format the balance amount)
	// Apple: use currencyCode on the balance field definition instead
	currency: z.optional(
		z
			.string()
			.check(
				z.regex(
					/^[A-Z]{3}$/,
					'must be a 3-letter ISO 4217 currency code e.g. "USD"'
				)
			)
	),
});

export const genericTemplateSchema = z.extend(baseTemplateSchema, {
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

export interface AppleOptions {
	appLaunchURL?: string;
	associatedStoreIdentifiers?: number[];
	background?: ImageSet;
	beacons?: Beacon[];
	description?: string;
	footer?: ImageSet;
	foregroundColor?: string;
	icon?: ImageSet;
	labelColor?: string;
	logo?: ImageSet;
	logoText?: string;
	maxDistance?: number;
	nfc?: {
		message: string;
		encryptionPublicKey: string;
		requiresAuthentication?: boolean;
	};
	relevantDates?: RelevantDate[];
	semantics?: SemanticTags;
	sharingProhibited?: boolean;
	strip?: ImageSet;
	suppressStripShine?: boolean;
	thumbnail?: ImageSet;
	userInfo?: Record<string, unknown>;
}

export interface AppleEventTicketOptions extends AppleOptions {
	accessibilityURL?: string;
	addOnURL?: string;
	auxiliaryStoreIdentifiers?: number[];
	bagPolicyURL?: string;
	contactVenueEmail?: string;
	contactVenuePhoneNumber?: string;
	contactVenueWebsite?: string;
	directionsInformationURL?: string;
	eventLogoText?: string;
	footerBackgroundColor?: string;
	merchandiseURL?: string;
	orderFoodURL?: string;
	parkingInformationURL?: string;
	preferredStyleSchemes?: string[];
	purchaseParkingURL?: string;
	sellURL?: string;
	suppressHeaderDarkening?: boolean;
	transferURL?: string;
	transitInformationURL?: string;
	useAutomaticColors?: boolean;
}

export interface AppleBoardingPassOptions extends AppleOptions {
	changeSeatURL?: string;
	entertainmentURL?: string;
	managementURL?: string;
	purchaseAdditionalBaggageURL?: string;
	purchaseLoungeAccessURL?: string;
	purchaseWifiURL?: string;
	registerServiceAnimalURL?: string;
	reportLostBagURL?: string;
	requestWheelchairURL?: string;
	trackBagsURL?: string;
	transitProviderEmail?: string;
	transitProviderPhoneNumber?: string;
	transitProviderWebsiteURL?: string;
	upgradeURL?: string;
}

export interface GoogleOptions extends GoogleModules {
	appLinkData?: AppLinkData;
	enableSmartTap?: boolean;
	hero?: string;
	issuerName?: string;
	logo?: string;
	messages?: GooglePassMessage[];
	redemptionIssuers?: string[];
	reviewStatus?: "UNDER_REVIEW" | "APPROVED" | "REJECTED" | "DRAFT";
	wideLogo?: string;
}

export interface GoogleTransitOptions {
	destinationName?: string;
	operatorName?: string;
	originName?: string;
	ticketNumber?: string;
	transitType?: "bus" | "rail" | "tram" | "ferry" | "other";
	tripType?: "oneWay" | "roundTrip";
}

export interface GoogleBoardingPassOptions extends GoogleOptions {
	transit?: GoogleTransitOptions;
}

interface TemplateBase<FieldKey extends string = string> {
	apple?: AppleOptions;
	color?: string;
	/** Defaults to `[]`. */
	fields?: FieldDefWith<FieldKey>[];
	google?: GoogleOptions;
	id: string;
	locales?: Locales;
	locations?: Location[];
	name: string;
}

export interface LoyaltyTemplateConfig extends TemplateBase<LoyaltyFieldKey> {
	type: "loyalty";
}

export interface EventTicketTemplateConfig
	extends TemplateBase<EventTicketFieldKey> {
	apple?: AppleEventTicketOptions;
	endsAt?: string;
	startsAt?: string;
	type: "eventTicket";
	venue?: { name: string; address: string };
}

export interface BoardingPassTemplateConfig
	extends TemplateBase<BoardingPassFieldKey> {
	apple?: AppleBoardingPassOptions;
	arrival?: string;
	carrier?: string;
	departure?: string;
	destination?: string;
	flightNumber?: string;
	google?: GoogleBoardingPassOptions;
	origin?: string;
	transitType?: "air" | "train" | "bus" | "boat" | "generic";
	type: "boardingPass";
}

export interface CouponTemplateConfig extends TemplateBase<CouponFieldKey> {
	/** Defaults to `"both"`. */
	redemptionChannel?: "online" | "instore" | "both";
	type: "coupon";
}

export interface GiftCardTemplateConfig extends TemplateBase<GiftCardFieldKey> {
	currency?: string;
	type: "giftCard";
}

export interface GenericTemplateConfig extends TemplateBase {
	type: "generic";
}

export type TemplateConfig =
	| LoyaltyTemplateConfig
	| EventTicketTemplateConfig
	| BoardingPassTemplateConfig
	| CouponTemplateConfig
	| GiftCardTemplateConfig
	| GenericTemplateConfig;
export type TemplateType = TemplateConfig["type"];

interface ParsedGoogleOptions extends GoogleOptions {
	messages?: ParsedGooglePassMessage[];
}

interface ParsedGoogleBoardingPassOptions extends GoogleBoardingPassOptions {
	messages?: ParsedGooglePassMessage[];
}

type Parsed<
	Config extends TemplateConfig,
	Google extends ParsedGoogleOptions = ParsedGoogleOptions,
> = Omit<Config, "fields" | "google"> & { fields: FieldDef[]; google?: Google };

/** A template as validated, with every default applied. */
export type ParsedTemplate =
	| Parsed<LoyaltyTemplateConfig>
	| Parsed<EventTicketTemplateConfig>
	| Parsed<BoardingPassTemplateConfig, ParsedGoogleBoardingPassOptions>
	| (Parsed<CouponTemplateConfig> &
			Required<Pick<CouponTemplateConfig, "redemptionChannel">>)
	| Parsed<GiftCardTemplateConfig>
	| Parsed<GenericTemplateConfig>;
