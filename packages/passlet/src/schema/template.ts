import {
	type AppleBoardingPassOptions,
	type AppleEventTicketOptions,
	type AppleOptions,
	appleBoardingPassOptions,
	appleEventTicketOptions,
	appleOptions,
} from "./apple";
import {
	array,
	type Check,
	nonEmpty,
	object,
	optional,
	pattern,
	picklist,
	type Shape,
	validate,
	variant,
	withDefault,
} from "./check";
import {
	type GoogleBoardingPassOptions,
	type GoogleOptions,
	googleBoardingPassOptions,
	googleOptions,
	type ParsedGoogleBoardingPassOptions,
	type ParsedGoogleOptions,
} from "./google";
import {
	type FieldDef,
	fieldDef,
	hexColor,
	type Locales,
	type Location,
	locales,
	localTimestamp,
	location,
} from "./parts";

// Per-type field keys: suggested in autocomplete, while `string & {}` still
// accepts any key.
type FieldDefWith<K extends string> = Omit<FieldDef, "key"> & {
	/**
	 * Identifies the field: recipient values in `content.values` and
	 * translations in `locales` refer to it.
	 */
	key: K;
};

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

interface TemplateBase<FieldKey extends string = string> {
	/** Apple-only options. */
	apple?: AppleOptions;
	/** Background color, as `#rrggbb`. Apple: `backgroundColor`. Google: `hexBackgroundColor`. */
	color?: string;
	/** The pass's display fields, built with `field.*()`. Defaults to `[]`. */
	fields?: FieldDefWith<FieldKey>[];
	/** Google-only options. */
	google?: GoogleOptions;
	/**
	 * Identifies the template. Google uses it as the class ID, so with Google
	 * credentials it may hold only letters, digits, `.`, `_` and `-`.
	 */
	id: string;
	/** Translations of labels, values and the pass name. */
	locales?: Locales;
	/**
	 * Places where the pass is relevant, at most 10. Apple: `locations`.
	 * Google: `merchantLocations`.
	 */
	locations?: Location[];
	/** The pass title. Apple: `organizationName`. Google: the card or program name. */
	name: string;
}

/**
 * A loyalty or rewards card. Google maps field keys by convention: `points`
 * → `loyaltyPoints`, `member` → `accountName`, `memberId` → `accountId`.
 */
export interface LoyaltyTemplateConfig extends TemplateBase<LoyaltyFieldKey> {
	/** Apple: `storeCard`. Google: `loyaltyClass`/`loyaltyObject`. */
	type: "loyalty";
}

/** Where an event takes place. */
export interface EventVenue {
	/** The street address. */
	address: string;
	/** The venue's name. */
	name: string;
}

export interface EventTicketTemplateConfig
	extends TemplateBase<EventTicketFieldKey> {
	/** Apple-only options, including the poster event ticket keys. */
	apple?: AppleEventTicketOptions;
	/** When the event ends; see `startsAt`. */
	endsAt?: string;
	/**
	 * Venue wall-clock time the event starts. Apple: relevance and the
	 * `eventStartDate` semantic, only when it carries a time zone. Google:
	 * `dateTime.start`, which takes it "with or without an offset", as given.
	 */
	startsAt?: string;
	/** Apple: `eventTicket`. Google: `eventTicketClass`/`eventTicketObject`. */
	type: "eventTicket";
	/**
	 * Google requires both name and address. Apple: the name feeds the
	 * `venueName` semantic unless a `venue` field is set.
	 */
	venue?: EventVenue;
}

export interface BoardingPassTemplateConfig
	extends TemplateBase<BoardingPassFieldKey> {
	/** Apple-only options, including the airline's service links. */
	apple?: AppleBoardingPassOptions;
	/** Local arrival time; see `departure`. */
	arrival?: string;
	/**
	 * 2-character IATA carrier code. Required by Google flights; Apple writes
	 * it as a semantic tag, not shown (add a field to display it).
	 */
	carrier?: string;
	/**
	 * Local airport wall-clock departure time. Google rejects an offset here
	 * (it takes the zone from the airport), so one given is kept for Apple
	 * semantics and stripped for Google; Apple needs it, so a zone-less time
	 * reaches Google only.
	 */
	departure?: string;
	/** 3-letter IATA airport code. Required by Google flights. */
	destination?: string;
	/** Flight number without the carrier, like `"100"` or `"1234A"`. Required by Google flights. */
	flightNumber?: string;
	/** Google-only options, including the transit vertical. */
	google?: GoogleBoardingPassOptions;
	/** 3-letter IATA airport code. Required by Google flights. */
	origin?: string;
	/**
	 * Required by Apple, which shows its icon between the primary fields;
	 * `"generic"` is transit that is none of the others. Google infers its
	 * own (`"generic"` becomes transit OTHER).
	 */
	transitType?: "air" | "train" | "bus" | "boat" | "generic";
	/**
	 * Apple: `boardingPass`. Google: `flightClass`/`flightObject`, or
	 * `transitClass`/`transitObject` with `google.transit`.
	 */
	type: "boardingPass";
}

export interface CouponTemplateConfig extends TemplateBase<CouponFieldKey> {
	/**
	 * Google: `redemptionChannel`, required on offer classes. Apple has no
	 * equivalent. Defaults to `"both"`.
	 */
	redemptionChannel?: "online" | "instore" | "both";
	/** Apple: `coupon`. Google: `offerClass`/`offerObject`. */
	type: "coupon";
}

export interface GiftCardTemplateConfig extends TemplateBase<GiftCardFieldKey> {
	/**
	 * Google: the balance's ISO 4217 currency code, like `"USD"`. Apple: set
	 * `currencyCode` on the balance field instead.
	 */
	currency?: string;
	/** Apple: `storeCard`. Google: `giftCardClass`/`giftCardObject`. */
	type: "giftCard";
}

export interface GenericTemplateConfig extends TemplateBase {
	/** Apple: `generic`. Google: `genericClass`/`genericObject`. */
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

/** What validation fills in on every template type. */
interface ParsedParts {
	/** The template's fields; `[]` when the input left them out. */
	fields: FieldDef[];
	/** Google-only options, with message defaults applied. */
	google?: ParsedGoogleOptions;
}

type ParsedLoyaltyTemplate = Omit<LoyaltyTemplateConfig, keyof ParsedParts> &
	ParsedParts;
type ParsedEventTicketTemplate = Omit<
	EventTicketTemplateConfig,
	keyof ParsedParts
> &
	ParsedParts;
type ParsedBoardingPassTemplate = Omit<
	BoardingPassTemplateConfig,
	keyof ParsedParts
> &
	Pick<ParsedParts, "fields"> & {
		/** Google-only options, with message defaults applied. */
		google?: ParsedGoogleBoardingPassOptions;
	};
type ParsedCouponTemplate = Omit<
	CouponTemplateConfig,
	keyof ParsedParts | "redemptionChannel"
> &
	ParsedParts & {
		/** Google's `redemptionChannel`; `"both"` when the input left it out. */
		redemptionChannel: "online" | "instore" | "both";
	};
type ParsedGiftCardTemplate = Omit<GiftCardTemplateConfig, keyof ParsedParts> &
	ParsedParts;
type ParsedGenericTemplate = Omit<GenericTemplateConfig, keyof ParsedParts> &
	ParsedParts;

/** A template as validated, with every default applied: `template.config`. */
export type ParsedTemplate =
	| ParsedLoyaltyTemplate
	| ParsedEventTicketTemplate
	| ParsedBoardingPassTemplate
	| ParsedCouponTemplate
	| ParsedGiftCardTemplate
	| ParsedGenericTemplate;

const base: Shape<Omit<ParsedGenericTemplate, "type">> = {
	id: nonEmpty,
	name: nonEmpty,
	color: optional(hexColor),
	// Apple takes up to 10 locations; Google up to 10 merchantLocations per class.
	locations: optional(array(location, 10)),
	fields: withDefault(array(fieldDef), () => []),
	locales: optional(locales),
	apple: optional(appleOptions),
	google: optional(googleOptions),
};

const airportCode = optional(
	pattern(/^[A-Z]{3}$/, 'must be a 3-letter IATA airport code like "JFK"')
);

const template: Check<ParsedTemplate> = variant<ParsedTemplate>({
	loyalty: object<ParsedLoyaltyTemplate>({
		type: picklist(["loyalty"]),
		...base,
	}),
	eventTicket: object<ParsedEventTicketTemplate>({
		type: picklist(["eventTicket"]),
		...base,
		startsAt: optional(localTimestamp),
		endsAt: optional(localTimestamp),
		venue: optional(
			object<EventVenue>({
				name: nonEmpty,
				address: nonEmpty,
			})
		),
		apple: optional(appleEventTicketOptions),
	}),
	boardingPass: object<ParsedBoardingPassTemplate>({
		type: picklist(["boardingPass"]),
		...base,
		transitType: optional(picklist(["air", "train", "bus", "boat", "generic"])),
		carrier: optional(
			pattern(
				/^[A-Z0-9]{2}$/,
				'must be a 2-character IATA carrier code like "AA"'
			)
		),
		flightNumber: optional(
			pattern(
				/^\d{1,4}[A-Z]?$/,
				'must be a flight number like "100" or "1234A"'
			)
		),
		origin: airportCode,
		destination: airportCode,
		departure: optional(localTimestamp),
		arrival: optional(localTimestamp),
		apple: optional(appleBoardingPassOptions),
		google: optional(googleBoardingPassOptions),
	}),
	coupon: object<ParsedCouponTemplate>({
		type: picklist(["coupon"]),
		...base,
		redemptionChannel: withDefault(
			picklist(["online", "instore", "both"]),
			() => "both"
		),
	}),
	giftCard: object<ParsedGiftCardTemplate>({
		type: picklist(["giftCard"]),
		...base,
		currency: optional(
			pattern(
				/^[A-Z]{3}$/,
				'must be a 3-letter ISO 4217 currency code like "USD"'
			)
		),
	}),
	generic: object<ParsedGenericTemplate>({
		type: picklist(["generic"]),
		...base,
	}),
});

/**
 * The template as validated, with every default applied.
 *
 * @throws {WalletError} `PASS_CONFIG_INVALID` listing every issue.
 */
export function parseTemplate(config: TemplateConfig): ParsedTemplate {
	return validate(template, config, "PASS_CONFIG_INVALID", "template");
}
