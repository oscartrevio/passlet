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

// Event/flight display datetimes. Accept an ISO datetime with or without a UTC
// offset. Google's EventDateTime is documented as "ISO 8601 extended format
// date/time, with or without an offset", so event datetimes are forwarded
// verbatim. Flight times are airport-local by definition
// (localScheduledDepartureDateTime), so an offset is stripped for Google there
// while still being preserved for Apple semantics.
const localDateTime = (message: string) =>
	z.iso.datetime({ offset: true, local: true, message });

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
// Data detectors turn matching text on the BACK of a pass into tappable links.
// Apple applies all detectors by default; an empty array disables them. They
// have no effect on fields shown on the front of the pass.
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
const semanticTagsSchema = z.record(z.string(), z.unknown());

// Apple requires a time zone on any value rendered with dateStyle/timeStyle
// ("A date or time value needs to include a time zone" — PassFieldContent).
// Matches a trailing UTC designator (Z) or numeric offset (±HH:MM / ±HHMM).
const TIMEZONE_RE = /(Z|[+-]\d{2}:?\d{2})$/;

// FieldDef — a single display field on a pass.
// slot maps to Apple's field areas; Google uses primary → subheader+header, rest → textModulesData.
export const fieldDefSchema = z
	.object({
		// Apple: headerFields / primaryFields / secondaryFields / auxiliaryFields / backFields
		// Google: primary → subheader (label) + header (value), others → textModulesData
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
		// Apple: "A date or time value needs to include a time zone." A zone-less
		// datetime renders in an unpredictable zone, so reject it up front.
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

// Barcode
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

// Entry for relevantDates (replaces the deprecated relevantDate).
// Apple accepts either a single moment ({ date }) or an interval
// ({ startDate, endDate }) — and requires endDate whenever startDate is given.
const relevantDateSchema = z.union([
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

// Base Apple options — applicable to all pass types
const appleOptionsSchema = z.object({
	// Required by Apple Wallet — validated at create() time
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
	// Groups passes of the same type into a single stack in Wallet
	groupingIdentifier: z.string().optional(),
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
	// URL for a web service that receives push update notifications for this pass
	webServiceURL: z.url().optional(),
	// Authentication token sent with web service requests (required with webServiceURL)
	authenticationToken: z.string().min(16).optional(),
	// Bluetooth LE beacons that trigger lock screen relevance
	beacons: z.array(beaconSchema).optional(),
	// Pass-level semantic tags (Apple's SemanticTags dictionary). Merged over the
	// tags passlet derives from the pass config — entries given here win.
	semantics: semanticTagsSchema.optional(),
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

// Google-specific sub-schemas

// Info message shown inside the pass view (e.g. alerts, promotions, expiry warnings).
// Class-level messages appear for all holders; object-level messages are per-recipient.
const googleMessageSchema = z.object({
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

// TOTP-based rotating barcode — generates a new barcode value every periodMillis ms.
// valuePattern uses {totp_value_hex} or {totp_value_decimal} as the rotating placeholder.
const googleRotatingBarcodeSchema = z.object({
	// Only QR_CODE and PDF_417 support rotation — the other BarcodeType values
	// (AZTEC, CODE_128, …) are rejected for a RotatingBarcode.
	type: z.enum(["QR_CODE", "PDF_417"]).default("QR_CODE"),
	// Pattern containing the TOTP placeholder, e.g. "https://example.com/redeem/{totp_value_hex}"
	valuePattern: z
		.string()
		.min(1, "rotatingBarcode.valuePattern must not be empty"),
	totpDetails: z.object({
		periodMillis: z.string().default("30000"),
		algorithm: z.literal("TOTP_SHA1").default("TOTP_SHA1"),
		parameters: z.array(
			z.object({
				key: z.string(),
				valueLength: z.number().int().min(1).max(8),
			})
		),
	}),
	renderEncoding: z.literal("UTF_8").optional(),
});

// App deep link shown on the pass — supports Android, iOS, and web targets.
const googleAppLinkInfoSchema = z.object({
	// Deep link URI (e.g. intent:// for Android, https:// scheme for iOS universal links)
	uri: z.url(),
	title: z.string().optional(),
	description: z.string().optional(),
	logoUrl: z.url().optional(),
});

const googleAppLinkDataSchema = z.object({
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

// Module data shared by every Google class and object.
const googleModulesSchema = z.object({
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

// Google-specific options — no cross-platform equivalent

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

// Flight-specific Google options — adds the transit vertical opt-in
const googleFlightOptionsSchema = googleOptionsSchema.extend({
	// Set to issue the pass as transitClass/transitObject (train, bus, tram,
	// ferry) instead of the default flightClass/flightObject (air).
	transit: googleTransitOptionsSchema.optional(),
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

// Base pass config — shared across all pass types

const basePassSchema = z.object({
	// Apple: description (pass name shown in Wallet list)
	// Google: cardTitle
	id: z.string().min(1, "PassConfig missing: id"),
	name: z.string().min(1, "PassConfig missing: name"),

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

	// Display fields — use field.primary(), field.secondary(), etc.
	// Apple: maps to headerFields / primaryFields / secondaryFields / auxiliaryFields / backFields
	// Google: primary → subheader + header, all others → textModulesData
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
	})
	.extend({ apple: appleEventOptionsSchema.optional() });

// Flight covers air, train, bus, and boat boarding passes.
export const flightPassSchema = basePassSchema
	.extend({
		type: z.literal("flight"),
		// Apple: transitType (required for boardingPass layout, defaults to "air").
		// "generic" maps to PKTransitTypeGeneric for transit that is none of the
		// other four.
		// Google: inferred from flightHeader ("generic" falls back to transit OTHER)
		transitType: z.enum(["air", "train", "bus", "boat", "generic"]).optional(),
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
		// Local airport wall-clock time. Google rejects a UTC offset here (it
		// derives the zone from the airport); an offset, if given, is kept for
		// Apple semantics and stripped for Google.
		departure: localDateTime(
			'must be an ISO datetime e.g. "2024-06-01T08:00:00Z" or "2024-06-01T08:00:00"'
		).optional(),
		arrival: localDateTime(
			'must be an ISO datetime e.g. "2024-06-01T11:30:00Z" or "2024-06-01T11:30:00"'
		).optional(),
		// passengerName is per-recipient — pass in values at create() time
	})
	.extend({
		apple: appleFlightOptionsSchema.optional(),
		google: googleFlightOptionsSchema.optional(),
	});

export const couponPassSchema = basePassSchema.extend({
	type: z.literal("coupon"),
	// Google: redemptionChannel (required for offerClass)
	// Apple: no equivalent — ignored
	// Defaults to "both" — Google requires this field for offerClass
	redemptionChannel: z.enum(["online", "instore", "both"]).default("both"),
});

export const giftCardPassSchema = basePassSchema.extend({
	type: z.literal("giftCard"),
	// Google: balance.currencyCode (needed to format the balance amount)
	// Apple: use currencyCode on the balance field definition instead
	currency: z
		.string()
		.regex(/^[A-Z]{3}$/, 'must be a 3-letter ISO 4217 currency code e.g. "USD"')
		.optional(),
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
	// Multiple barcodes. Apple emits every entry in `barcodes` and renders the
	// first one the device can display (iOS 27 and later reads more than one), so
	// list the preferred format first and a widely-supported fallback after it.
	// Google keeps a single barcode per object and uses the first entry.
	// Takes precedence over `barcode` when both are given.
	barcodes: z.array(barcodeSchema).optional(),
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
	apple: z
		.object({
			// Mark this issued pass as void. Displays a "Void" banner on the pass.
			// For Google, use pass.expire() instead — it transitions state via the API.
			voided: z.boolean().optional(),
		})
		.optional(),
	// Google-specific per-recipient options.
	google: z
		.object({
			// Smart Tap NFC value for this specific pass holder (required when enableSmartTap is true)
			smartTapRedemptionValue: z.string().optional(),
			// TOTP rotating barcode — replaces the static barcode for this pass holder
			rotatingBarcode: googleRotatingBarcodeSchema.optional(),
			// Per-recipient info messages shown inside the pass view
			messages: z.array(googleMessageSchema).optional(),
			// Per-recipient links, images, and value-added modules. Google merges
			// these with the class-level modules of the same name.
			...googleModulesSchema.shape,
			// Google transitObject requires tripType — per-recipient override of
			// google.transit.tripType (ignored outside the transit vertical).
			tripType: z.enum(["oneWay", "roundTrip"]).optional(),
		})
		.optional(),
});

// Options for pass.update() / updateGooglePass().
export const updateOptionsSchema = z.object({
	// Sets notifyPreference: "NOTIFY_ON_UPDATE" on the PATCH body, asking Google
	// to push a field-update notification. Google only notifies for allowlisted
	// fields, and the setting is ephemeral — it must be sent on every request.
	notify: z.boolean().optional(),
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
type GiftCardFieldKey =
	| "balance"
	| "cardNumber"
	| "pin"
	| "initialValue"
	| (string & {});

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
export type PassType = PassConfig["type"];
export type CreateConfig = z.infer<typeof createConfigSchema>;
export type GooglePassMessage = z.infer<typeof googleMessageSchema>;
export type RotatingBarcode = z.infer<typeof googleRotatingBarcodeSchema>;
export type AppLinkData = z.infer<typeof googleAppLinkDataSchema>;
export type GoogleLink = z.infer<typeof googleLinkSchema>;
export type GoogleImageModule = z.infer<typeof googleImageModuleSchema>;
export type GoogleValueAddedModule = z.infer<typeof googleValueAddedSchema>;
export type GoogleModules = z.infer<typeof googleModulesSchema>;
export type GoogleTransitOptions = z.infer<typeof googleTransitOptionsSchema>;
export type UpdateOptions = z.infer<typeof updateOptionsSchema>;
