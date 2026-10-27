import {
	array,
	boolean,
	type Check,
	integer,
	nonEmpty,
	object,
	optional,
	pattern,
	picklist,
	refine,
	type Shape,
	string,
	validate,
	withDefault,
} from "./check";
import { optionalUrl, timestamp, url } from "./parts";

/**
 * An info message in the pass details: alerts, promotions, notices. On the
 * template it shows to every holder; on content, to that recipient only.
 */
export interface GooglePassMessage {
	/** The message text. */
	body: string;
	/** When the message shows; outside it, Google hides the message. */
	displayInterval?: {
		/** When it starts showing. */
		start?: {
			/** A W3C timestamp with a time zone. */
			date: string;
		};
		/** When it stops showing. */
		end?: {
			/** A W3C timestamp with a time zone. */
			date: string;
		};
	};
	/** The message title. */
	header: string;
	/** Identifies the message among the pass's messages. */
	id?: string;
	/**
	 * Defaults to `"TEXT"`, shown in the pass only. `"TEXT_AND_NOTIFY"` also
	 * pushes an Android notification, which Google sends only for messages
	 * added with `PassTemplate.sendMessage`. Google's EXPIRATION_NOTIFICATION
	 * is documented as unsupported and not offered.
	 */
	messageType?: "TEXT" | "TEXT_AND_NOTIFY";
}

/** A message as validated, with its type default applied. */
export interface ParsedGooglePassMessage extends GooglePassMessage {
	/** The message type; `"TEXT"` when the input left it out. */
	messageType: "TEXT" | "TEXT_AND_NOTIFY";
}

type DisplayDate = NonNullable<
	NonNullable<GooglePassMessage["displayInterval"]>["start"]
>;
const displayDate = optional(object<DisplayDate>({ date: timestamp }));

const googleMessage = object<ParsedGooglePassMessage>({
	header: string,
	body: string,
	id: optional(string),
	messageType: withDefault(picklist(["TEXT", "TEXT_AND_NOTIFY"]), () => "TEXT"),
	displayInterval: optional(
		object<NonNullable<GooglePassMessage["displayInterval"]>>({
			start: displayDate,
			end: displayDate,
		})
	),
});

/**
 * The message as validated for `sendMessage`.
 *
 * @throws {WalletError} `CREATE_CONFIG_INVALID` listing every issue.
 */
export function parseGoogleMessage(
	message: GooglePassMessage
): ParsedGooglePassMessage {
	return validate(googleMessage, message, "CREATE_CONFIG_INVALID", "message");
}

/**
 * The app link shown first in the bottom section of the pass. Google opens an
 * Android app by its package name ("Prefer setting package field instead")
 * and a website by a URI that "must" carry a description; it no longer
 * supports links to iOS apps.
 * https://developers.google.com/wallet/reference/rest/v1/AppLinkData
 * https://developers.google.com/wallet/retail/loyalty-cards/use-cases/link-from-loyalty-card
 */
export interface AppLinkData {
	/** Opens your Android app. */
	android?: {
		/** The app's package name, e.g. `"com.example.app"`. */
		packageName: string;
	};
	/** Text of the app link button, at most 30 characters. */
	displayText?: string;
	/** Opens a web page. */
	web?: {
		uri: string;
		/** What the link opens, e.g. `"Your account"`; Google requires it. */
		description: string;
	};
}

// Android application IDs: two or more dot-separated segments, each starting
// with a letter. https://developer.android.com/build/configure-app-module#set-application-id
const ANDROID_PACKAGE = /^[A-Za-z]\w*(\.[A-Za-z]\w*)+$/;

const appLinkData = object<AppLinkData>({
	android: optional(
		object<NonNullable<AppLinkData["android"]>>({
			packageName: pattern(
				ANDROID_PACKAGE,
				'must be an Android package name, like "com.example.app"'
			),
		})
	),
	web: optional(
		object<NonNullable<AppLinkData["web"]>>({
			uri: url,
			description: nonEmpty,
		})
	),
	displayText: optional(
		refine(nonEmpty, (text) =>
			text.length > 30 ? "must be at most 30 characters" : undefined
		)
	),
});

/** A row of Google's links module (`linksModuleData.uris`). */
export interface GoogleLink {
	/**
	 * The link's title. Google recommends 20 characters or fewer so it fits
	 * small screens.
	 */
	description?: string;
	/** Identifies the link among the pass's links. */
	id?: string;
	/**
	 * The link, with its scheme: `https:` for a web page, `geo:` for a map,
	 * `tel:` for a phone number, `mailto:` for an email address.
	 */
	uri: string;
}

/**
 * An image module (`imageModulesData`): a full-width image in the pass
 * details. Google shows at most one from the template and one from the
 * content.
 */
export interface GoogleImageModule {
	/** Identifies the image among the pass's image modules. */
	id?: string;
	/** Image URL; Google does not take image bytes. */
	url: string;
}

/**
 * A value-added module (`valueAddedModuleData`): a tappable card linking to a
 * related service such as parking, merchandise or food ordering.
 */
export interface GoogleValueAddedModule {
	/** Google truncates it past 50 characters. */
	body?: string;
	/** Google truncates it past 60 characters. */
	header: string;
	/** Image URL; Google recommends a 1:1 ratio and resizes to fit. */
	imageUrl?: string;
	/** Lower values show first; unset sorts last. */
	sortIndex?: number;
	/** Web link or Android deep link opened on tap. */
	uri: string;
}

/**
 * Google's link, image and value-added modules. Content modules are merged
 * with the template's modules of the same kind.
 */
export interface GoogleModules {
	/** Google: `imageModulesData`. */
	images?: GoogleImageModule[];
	/** Google: `linksModuleData.uris`. */
	links?: GoogleLink[];
	/** At most 10 on the template and 10 on the content. */
	valueAdded?: GoogleValueAddedModule[];
}

const modulesShape: Shape<GoogleModules> = {
	links: optional(
		array(
			object<GoogleLink>({
				uri: url,
				description: optional(string),
				id: optional(string),
			})
		)
	),
	images: optional(
		array(object<GoogleImageModule>({ url, id: optional(string) }))
	),
	valueAdded: optional(
		array(
			object<GoogleValueAddedModule>({
				header: nonEmpty,
				uri: url,
				body: optional(string),
				imageUrl: optionalUrl,
				sortIndex: optional(integer),
			}),
			10
		)
	),
};

/** Google-only options of every template. */
export interface GoogleOptions extends GoogleModules {
	/** Links that open your Android app or website. */
	appLinkData?: AppLinkData;
	/** Smart Tap: lets supported NFC terminals redeem the pass. */
	enableSmartTap?: boolean;
	/** Hero image URL. */
	hero?: string;
	/** Shown as the pass issuer. */
	issuerName?: string;
	/**
	 * Logo URL; Google does not take image bytes. Required with Google
	 * credentials on loyalty and transit passes.
	 */
	logo?: string;
	/** Info messages shown to every holder. */
	messages?: GooglePassMessage[];
	/** Smart Tap issuer IDs allowed to redeem the pass; required with `enableSmartTap`. */
	redemptionIssuers?: string[];
	/**
	 * Google accepts only `"DRAFT"` or `"UNDER_REVIEW"` on writes, so any other
	 * value is sent as `"UNDER_REVIEW"`, the default; Google approves the class
	 * itself. https://developers.google.com/wallet/reference/rest/v1/loyaltyclass
	 */
	reviewStatus?: "UNDER_REVIEW" | "APPROVED" | "REJECTED" | "DRAFT";
	/** Wide logo URL, shown instead of `logo` on some layouts. */
	wideLogo?: string;
}

/** Google options as validated, with message defaults applied. */
export interface ParsedGoogleOptions extends GoogleOptions {
	/** The template's messages, each with its type default applied. */
	messages?: ParsedGooglePassMessage[];
}

const googleShape: Shape<ParsedGoogleOptions> = {
	// Google requires a scheme on every URI it stores, images included ("URIs
	// must have a scheme"); it fetches images itself and opens links by scheme.
	// https://developers.google.com/wallet/reference/rest/v1/Image
	// https://developers.google.com/wallet/reference/rest/v1/Uri
	logo: optionalUrl,
	hero: optionalUrl,
	wideLogo: optionalUrl,
	issuerName: optional(string),
	reviewStatus: optional(
		picklist(["UNDER_REVIEW", "APPROVED", "REJECTED", "DRAFT"])
	),
	enableSmartTap: optional(boolean),
	redemptionIssuers: optional(array(string)),
	messages: optional(array(googleMessage)),
	appLinkData: optional(appLinkData),
	...modulesShape,
};

export const googleOptions = object<ParsedGoogleOptions>(googleShape);

/**
 * Google's transit vertical. Setting it issues a boarding pass as
 * `transitClass`/`transitObject` (train, bus, tram, ferry) instead of the
 * default air `flightClass`/`flightObject`, which requires IATA codes.
 */
export interface GoogleTransitOptions {
	/** Destination station name. Google requires `originName` with it. */
	destinationName?: string;
	/** Google: `transitClass.transitOperatorName`. */
	operatorName?: string;
	/** Origin station name. Defaults to the template's `origin` code. */
	originName?: string;
	/** Google: `transitObject.ticketNumber`. */
	ticketNumber?: string;
	/**
	 * Required by Google's `transitClass`. Defaults from the template's
	 * `transitType`: `"train"` is rail, `"bus"` bus, `"boat"` ferry.
	 */
	transitType?: "bus" | "rail" | "tram" | "ferry" | "other";
	/** Required by Google's `transitObject`. Defaults to `"oneWay"`. */
	tripType?: "oneWay" | "roundTrip";
}

const tripType = picklist(["oneWay", "roundTrip"]);

/** Google options of boarding passes. */
export interface GoogleBoardingPassOptions extends GoogleOptions {
	/** Issues the pass in Google's transit vertical instead of as a flight. */
	transit?: GoogleTransitOptions;
}

/** Boarding pass Google options as validated, with message defaults applied. */
export interface ParsedGoogleBoardingPassOptions
	extends GoogleBoardingPassOptions {
	/** The template's messages, each with its type default applied. */
	messages?: ParsedGooglePassMessage[];
}

export const googleBoardingPassOptions =
	object<ParsedGoogleBoardingPassOptions>({
		...googleShape,
		transit: optional(
			object<GoogleTransitOptions>({
				transitType: optional(
					picklist(["bus", "rail", "tram", "ferry", "other"])
				),
				tripType: optional(tripType),
				originName: optional(string),
				destinationName: optional(string),
				ticketNumber: optional(string),
				operatorName: optional(string),
			})
		),
	});

/** One TOTP secret of a rotating barcode. */
export interface TotpParameter {
	/** The secret key, as Google takes it. */
	key: string;
	/** Digits the TOTP value has, from 1 to 8. */
	valueLength: number;
}

/**
 * A TOTP rotating barcode: Google renders a new value every `periodMillis`.
 * Google rotates only QR codes and PDF417.
 * https://developers.google.com/wallet/reference/rest/v1/RotatingBarcode
 */
export interface RotatingBarcode {
	/** Google: `renderEncoding`, the character set of the rendered value. */
	renderEncoding?: "UTF_8";
	/** How Google derives each value. */
	totpDetails: {
		/** Defaults to `"30000"`. */
		periodMillis?: string;
		/** Defaults to `"TOTP_SHA1"`. */
		algorithm?: "TOTP_SHA1";
		/** The TOTP secrets whose values fill the placeholders. */
		parameters: TotpParameter[];
	};
	/** Defaults to `"QR_CODE"`. */
	type?: "QR_CODE" | "PDF_417";
	/**
	 * The value with its rotating placeholder, `{totp_value_hex}` or
	 * `{totp_value_decimal}`: `"https://example.com/redeem/{totp_value_hex}"`.
	 */
	valuePattern: string;
}

/** A rotating barcode as validated, with every default applied. */
interface ParsedRotatingBarcode extends RotatingBarcode {
	/** The TOTP details, with `periodMillis` and `algorithm` defaulted. */
	totpDetails: Required<RotatingBarcode["totpDetails"]>;
	/** The barcode type; `"QR_CODE"` when the input left it out. */
	type: "QR_CODE" | "PDF_417";
}

const rotatingBarcode = object<ParsedRotatingBarcode>({
	type: withDefault(picklist(["QR_CODE", "PDF_417"]), () => "QR_CODE"),
	valuePattern: nonEmpty,
	totpDetails: object<ParsedRotatingBarcode["totpDetails"]>({
		periodMillis: withDefault(string, () => "30000"),
		algorithm: withDefault(picklist(["TOTP_SHA1"]), () => "TOTP_SHA1"),
		parameters: array(
			object<TotpParameter>({
				key: string,
				valueLength: refine(integer, (value) =>
					value >= 1 && value <= 8 ? undefined : "must be from 1 to 8"
				),
			})
		),
	}),
	renderEncoding: optional(picklist(["UTF_8"])),
});

/** Google-only options of one recipient's pass. */
export interface GoogleContentOptions extends GoogleModules {
	/** Info messages shown to this recipient only. */
	messages?: GooglePassMessage[];
	/** Replaces the static barcode for this recipient. */
	rotatingBarcode?: RotatingBarcode;
	/** This holder's Smart Tap value; required with `enableSmartTap`. */
	smartTapRedemptionValue?: string;
	/**
	 * Overrides `google.transit.tripType` for this recipient. Ignored outside
	 * the transit vertical.
	 */
	tripType?: "oneWay" | "roundTrip";
}

/** Google content options as validated, with every default applied. */
export interface ParsedGoogleContentOptions extends GoogleContentOptions {
	/** The recipient's messages, each with its type default applied. */
	messages?: ParsedGooglePassMessage[];
	/** The rotating barcode with every default applied. */
	rotatingBarcode?: ParsedRotatingBarcode;
}

export const googleContentOptions: Check<ParsedGoogleContentOptions> =
	object<ParsedGoogleContentOptions>({
		smartTapRedemptionValue: optional(string),
		rotatingBarcode: optional(rotatingBarcode),
		messages: optional(array(googleMessage)),
		...modulesShape,
		tripType: optional(tripType),
	});
