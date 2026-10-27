import {
	array,
	boolean,
	type Check,
	crossCheck,
	integer,
	number,
	object,
	optional,
	pattern,
	record,
	refine,
	type Shape,
	string,
	unknown,
} from "./check";
import {
	email,
	hexColor,
	type ImageSet,
	imageSet,
	optionalUrl,
	type SemanticTags,
	semanticTags,
	timestamp,
} from "./parts";

/**
 * A Bluetooth Low Energy beacon whose proximity shows the pass on the lock
 * screen.
 */
export interface Beacon {
	/** 16-bit major value that narrows the beacon's region. */
	major?: number;
	/** 16-bit minor value that narrows the region further. */
	minor?: number;
	/** The beacon's UUID. */
	proximityUUID: string;
	/** Lock screen text when the pass becomes relevant near this beacon. */
	relevantText?: string;
}

const uint16 = refine(integer, (value) =>
	value >= 0 && value <= 65_535 ? undefined : "must be from 0 to 65535"
);

// Any 8-4-4-4-12 hex UUID: iBeacon UUIDs are chosen by the beacon's owner and
// need not carry RFC 9562 version bits.
const beacon = object<Beacon>({
	proximityUUID: pattern(
		/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
		'must be a UUID like "E2C56DB5-DFFB-48D2-B060-D0F5A71096E0"'
	),
	major: optional(uint16),
	minor: optional(uint16),
	relevantText: optional(string),
});

/**
 * An entry of Apple's `relevantDates`: a moment (`date`) or an interval
 * (`startDate` with `endDate`, which Apple requires together). Values are W3C
 * timestamps with a time zone, such as Apple's own `"2025-12-09T13:00-07:00"`.
 * https://developer.apple.com/documentation/walletpasses/pass/relevantdates-data.dictionary
 */
export type RelevantDate =
	| {
			/** The moment the pass becomes relevant. */
			date: string;
	  }
	| {
			/** When the relevance interval begins. */
			startDate: string;
			/** When the relevance interval ends; required with `startDate`. */
			endDate: string;
	  };

const relevantMoment = object<Extract<RelevantDate, { date: string }>>({
	date: timestamp,
});
const relevantInterval = object<Exclude<RelevantDate, { date: string }>>({
	startDate: timestamp,
	endDate: timestamp,
});

// Each entry is one or the other, so an entry with both is ambiguous.
const relevantDate: Check<RelevantDate> = (input) => {
	if (
		typeof input !== "object" ||
		input === null ||
		!("startDate" in input || "endDate" in input)
	) {
		return relevantMoment(input);
	}
	if ("date" in input) {
		return {
			ok: false,
			issues: [
				{
					message: "must have either date or startDate and endDate, not both",
					path: [],
				},
			],
		};
	}
	return relevantInterval(input);
};

/** The NFC payload an Apple pass hands a contactless reader on tap. */
export interface AppleNfc {
	/**
	 * Required by Apple: the public key that encrypts the payload, as a
	 * Base64-encoded X.509 SubjectPublicKeyInfo (ECDH P-256). NFC does not
	 * work without it.
	 */
	encryptionPublicKey: string;
	/** The message passed to the reader. */
	message: string;
	/**
	 * Requires Face ID, Touch ID or the passcode on every use. Defaults to
	 * `false`. iOS 13.1 and later; Apple recommends pairing it with
	 * `sharingProhibited` so the pass cannot reach an older OS that ignores it.
	 */
	requiresAuthentication?: boolean;
}

/** Apple-only options of every template. */
export interface AppleOptions {
	/**
	 * Deep link passed to your app when the user opens it from the pass.
	 * Requires `associatedStoreIdentifiers`.
	 */
	appLaunchURL?: string;
	/**
	 * App Store IDs of your apps: adds a link on the pass that opens the first
	 * one compatible with the device, or the App Store.
	 */
	associatedStoreIdentifiers?: number[];
	/** Image behind the front of an event ticket; Apple blurs it. */
	background?: ImageSet;
	/** Bluetooth LE beacons that make the pass relevant nearby. */
	beacons?: Beacon[];
	/** Shown in the Wallet list and read by accessibility. Defaults to the template `name`. */
	description?: string;
	/** Image near the barcode of a boarding pass. */
	footer?: ImageSet;
	/** Text color, as `#rrggbb`. */
	foregroundColor?: string;
	/** Required when Apple credentials are configured. */
	icon?: ImageSet;
	/** Label text color, as `#rrggbb`. */
	labelColor?: string;
	/** Image at the top left of the pass, next to `logoText`. */
	logo?: ImageSet;
	/** Text next to the logo. Not shown on poster event tickets; use `eventLogoText`. */
	logoText?: string;
	/** Meters from a `locations` entry within which the pass is relevant. */
	maxDistance?: number;
	/** The NFC payload handed to contactless readers. */
	nfc?: AppleNfc;
	/** Moments or intervals when the pass is relevant. */
	relevantDates?: RelevantDate[];
	/**
	 * The pass's semantics dictionary, merged over the tags passlet derives
	 * from the template; entries given here win.
	 */
	semantics?: SemanticTags;
	/** Removes the Share button from the pass. */
	sharingProhibited?: boolean;
	/** Image behind the primary fields of coupons, store cards and event tickets. */
	strip?: ImageSet;
	/** Turns off the shine Apple renders over the strip image. */
	suppressStripShine?: boolean;
	/** Image beside the fields of generic passes and event tickets. */
	thumbnail?: ImageSet;
	/** JSON your companion app reads from the pass; never shown to the holder. */
	userInfo?: Record<string, unknown>;
}

/**
 * Apple options of event tickets, including the poster event ticket keys
 * Apple honors only with `preferredStyleSchemes: ["posterEventTicket"]`.
 */
export interface AppleEventTicketOptions extends AppleOptions {
	/** Links to your accessibility content, or the venue's. */
	accessibilityURL?: string;
	/** Links to experiences the holder can add to the pass. */
	addOnURL?: string;
	/** Further App Store IDs shown in the event guide (poster event tickets). */
	auxiliaryStoreIdentifiers?: number[];
	/** Links to the venue's bag policy for the event. */
	bagPolicyURL?: string;
	/** The preferred email address of the venue, event or issuer. */
	contactVenueEmail?: string;
	/** The phone number of the venue, event or issuer. */
	contactVenuePhoneNumber?: string;
	/** Links to the website of the venue, event or issuer. */
	contactVenueWebsite?: string;
	/** Links to directions to the event. */
	directionsInformationURL?: string;
	/** Text next to the logo on poster event tickets; standard ones use `logoText`. */
	eventLogoText?: string;
	/** Footer bar color on poster event tickets, as `#rrggbb`. */
	footerBackgroundColor?: string;
	/** Links to merchandise for the event. */
	merchandiseURL?: string;
	/** Links to food ordering for the event. */
	orderFoodURL?: string;
	/** Links to parking information for the event. */
	parkingInformationURL?: string;
	/**
	 * Layouts to render the pass in, in order of preference. Apple falls back
	 * to the event ticket design when it can render none of them.
	 */
	preferredStyleSchemes?: string[];
	/** Links to parking purchase for the event. */
	purchaseParkingURL?: string;
	/** Links to the flow that sells the ticket. */
	sellURL?: string;
	/** Turns off the header darkening gradient on poster event tickets. */
	suppressHeaderDarkening?: boolean;
	/** Links to the flow that transfers the ticket. */
	transferURL?: string;
	/** Links to transit options near the event. */
	transitInformationURL?: string;
	/**
	 * Derives the foreground and label colors from the background image
	 * (poster event tickets).
	 */
	useAutomaticColors?: boolean;
}

/** Apple options of boarding passes: the airline's service links. */
export interface AppleBoardingPassOptions extends AppleOptions {
	/** Links to changing the seat. */
	changeSeatURL?: string;
	/** Links to in-flight entertainment. */
	entertainmentURL?: string;
	/** Links to managing the ticket. */
	managementURL?: string;
	/** Links to adding checked bags. */
	purchaseAdditionalBaggageURL?: string;
	/** Links to buying lounge access. */
	purchaseLoungeAccessURL?: string;
	/** Links to buying in-flight wifi. */
	purchaseWifiURL?: string;
	/** Links to registering a service animal. */
	registerServiceAnimalURL?: string;
	/** Links to reporting a lost bag. */
	reportLostBagURL?: string;
	/** Links to requesting a wheelchair. */
	requestWheelchairURL?: string;
	/** Links to tracking bags in the airline's app. */
	trackBagsURL?: string;
	/** The transit provider's email address. */
	transitProviderEmail?: string;
	/** The transit provider's phone number. */
	transitProviderPhoneNumber?: string;
	/** Links to the transit provider's website. */
	transitProviderWebsiteURL?: string;
	/** Links to upgrading the flight. */
	upgradeURL?: string;
}

const storeIdentifiers = array(
	refine(integer, (value) => (value > 0 ? undefined : "must be positive"))
);

const appleShape: Shape<AppleOptions> = {
	icon: optional(imageSet),
	logo: optional(imageSet),
	strip: optional(imageSet),
	background: optional(imageSet),
	thumbnail: optional(imageSet),
	footer: optional(imageSet),
	description: optional(string),
	logoText: optional(string),
	foregroundColor: optional(hexColor),
	labelColor: optional(hexColor),
	relevantDates: optional(array(relevantDate)),
	suppressStripShine: optional(boolean),
	nfc: optional(
		object<AppleNfc>({
			message: string,
			encryptionPublicKey: string,
			requiresAuthentication: optional(boolean),
		})
	),
	// Apple documents every URL key as "a URL", app deep links included, so
	// any scheme is accepted. https://developer.apple.com/documentation/walletpasses/pass
	appLaunchURL: optionalUrl,
	associatedStoreIdentifiers: optional(storeIdentifiers),
	maxDistance: optional(
		refine(number, (value) => (value > 0 ? undefined : "must be positive"))
	),
	sharingProhibited: optional(boolean),
	userInfo: optional(record(unknown)),
	beacons: optional(array(beacon)),
	semantics: optional(semanticTags),
};

export const appleOptions = object<AppleOptions>(appleShape);

export const appleEventTicketOptions = crossCheck(
	object<AppleEventTicketOptions>({
		...appleShape,
		eventLogoText: optional(string),
		footerBackgroundColor: optional(hexColor),
		suppressHeaderDarkening: optional(boolean),
		useAutomaticColors: optional(boolean),
		preferredStyleSchemes: optional(array(string)),
		auxiliaryStoreIdentifiers: optional(storeIdentifiers),
		accessibilityURL: optionalUrl,
		addOnURL: optionalUrl,
		bagPolicyURL: optionalUrl,
		contactVenueEmail: optional(email),
		contactVenuePhoneNumber: optional(string),
		contactVenueWebsite: optionalUrl,
		directionsInformationURL: optionalUrl,
		merchandiseURL: optionalUrl,
		orderFoodURL: optionalUrl,
		parkingInformationURL: optionalUrl,
		purchaseParkingURL: optionalUrl,
		sellURL: optionalUrl,
		transferURL: optionalUrl,
		transitInformationURL: optionalUrl,
	}),
	// "If you specify a strip image, do not specify a background image or a
	// thumbnail." — Pass Design and Creation, event ticket images.
	(apple) =>
		apple.strip && (apple.background || apple.thumbnail)
			? [
					{
						path: ["strip"],
						message:
							"cannot be combined with a background or thumbnail image on an event ticket",
					},
				]
			: []
);

export const appleBoardingPassOptions = object<AppleBoardingPassOptions>({
	...appleShape,
	changeSeatURL: optionalUrl,
	entertainmentURL: optionalUrl,
	managementURL: optionalUrl,
	purchaseAdditionalBaggageURL: optionalUrl,
	purchaseLoungeAccessURL: optionalUrl,
	purchaseWifiURL: optionalUrl,
	registerServiceAnimalURL: optionalUrl,
	reportLostBagURL: optionalUrl,
	requestWheelchairURL: optionalUrl,
	trackBagsURL: optionalUrl,
	transitProviderEmail: optional(email),
	transitProviderPhoneNumber: optional(string),
	transitProviderWebsiteURL: optionalUrl,
	upgradeURL: optionalUrl,
});
