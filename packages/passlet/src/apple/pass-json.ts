import type { AppleCredentials } from "../config";
import { fieldValue, fieldValueByKey } from "../field";
import type {
	AppleBoardingPassOptions,
	AppleEventTicketOptions,
	RelevantDate,
} from "../schema/apple";
import type { ParsedContent } from "../schema/content";
import {
	type FieldDef,
	type ParsedBarcode,
	TIMEZONE_RE,
} from "../schema/parts";
import type { ParsedTemplate, TemplateType } from "../schema/template";
import {
	APPLE_BARCODE_FORMAT,
	APPLE_DATA_DETECTOR_TYPE,
	APPLE_DATE_STYLE,
	APPLE_NUMBER_STYLE,
	APPLE_TEXT_ALIGNMENT,
	hexToRgb,
	LEGACY_BARCODE_FORMATS,
	toAppleMessageEncoding,
} from "./utils";

// The top-level keys of Apple's Pass dictionary.
// https://developer.apple.com/documentation/walletpasses/pass
type PassKey =
	| "accessibilityURL"
	| "addOnURL"
	| "appLaunchURL"
	| "associatedStoreIdentifiers"
	| "authenticationToken"
	| "auxiliaryStoreIdentifiers"
	| "backgroundColor"
	| "bagPolicyURL"
	| "barcode"
	| "barcodes"
	| "beacons"
	| "boardingPass"
	| "changeSeatURL"
	| "contactVenueEmail"
	| "contactVenuePhoneNumber"
	| "contactVenueWebsite"
	| "coupon"
	| "description"
	| "directionsInformationURL"
	| "entertainmentURL"
	| "eventLogoText"
	| "eventTicket"
	| "expirationDate"
	| "footerBackgroundColor"
	| "foregroundColor"
	| "formatVersion"
	| "generic"
	| "groupingIdentifier"
	| "labelColor"
	| "locations"
	| "logoText"
	| "managementURL"
	| "maxDistance"
	| "merchandiseURL"
	| "nfc"
	| "orderFoodURL"
	| "organizationName"
	| "parkingInformationURL"
	| "passTypeIdentifier"
	| "preferredStyleSchemes"
	| "purchaseAdditionalBaggageURL"
	| "purchaseLoungeAccessURL"
	| "purchaseParkingURL"
	| "purchaseWifiURL"
	| "registerServiceAnimalURL"
	| "relevantDate"
	| "relevantDates"
	| "reportLostBagURL"
	| "requestWheelchairURL"
	| "sellURL"
	| "semantics"
	| "serialNumber"
	| "sharingProhibited"
	| "storeCard"
	| "suppressHeaderDarkening"
	| "suppressStripShine"
	| "teamIdentifier"
	| "trackBagsURL"
	| "transferURL"
	| "transitInformationURL"
	| "transitProviderEmail"
	| "transitProviderPhoneNumber"
	| "transitProviderWebsiteURL"
	| "upcomingPassInformation"
	| "upgradeURL"
	| "useAutomaticColors"
	| "userInfo"
	| "voided"
	| "webServiceURL";

export type PassJson = { [K in PassKey]?: unknown };

const PASS_TYPE_KEY = {
	loyalty: "storeCard",
	coupon: "coupon",
	eventTicket: "eventTicket",
	boardingPass: "boardingPass",
	giftCard: "storeCard",
	generic: "generic",
} as const satisfies Record<TemplateType, PassKey>;

const TRANSIT_TYPE: Record<
	NonNullable<Extract<ParsedTemplate, { type: "boardingPass" }>["transitType"]>,
	string
> = {
	air: "PKTransitTypeAir",
	train: "PKTransitTypeTrain",
	bus: "PKTransitTypeBus",
	boat: "PKTransitTypeBoat",
	generic: "PKTransitTypeGeneric",
};

const SLOT_KEY: Record<FieldDef["slot"], keyof AppleSlots> = {
	header: "headerFields",
	primary: "primaryFields",
	secondary: "secondaryFields",
	auxiliary: "auxiliaryFields",
	back: "backFields",
};

interface AppleField {
	attributedValue?: string;
	changeMessage?: string;
	currencyCode?: string;
	dataDetectorTypes?: string[];
	dateStyle?: string;
	ignoresTimeZone?: boolean;
	isRelative?: boolean;
	key: string;
	label?: string;
	numberStyle?: string;
	row?: 0 | 1;
	semantics?: Record<string, unknown>;
	textAlignment?: string;
	timeStyle?: string;
	value: string;
}

type AppleSlots = Record<
	| "headerFields"
	| "primaryFields"
	| "secondaryFields"
	| "auxiliaryFields"
	| "backFields",
	AppleField[]
>;

function buildField(f: FieldDef, value: string): AppleField {
	return {
		key: f.key,
		label: f.label,
		value,
		changeMessage: f.changeMessage,
		dateStyle: f.dateStyle && APPLE_DATE_STYLE[f.dateStyle],
		timeStyle: f.timeStyle && APPLE_DATE_STYLE[f.timeStyle],
		numberStyle: f.numberStyle && APPLE_NUMBER_STYLE[f.numberStyle],
		currencyCode: f.currencyCode || undefined,
		// attributedValue overrides value on iOS and is ignored on watchOS.
		attributedValue: f.attributedValue,
		// Only back fields support detectors; [] explicitly disables them.
		dataDetectorTypes:
			f.dataDetectorTypes !== undefined && f.slot === "back"
				? f.dataDetectorTypes.map((type) => APPLE_DATA_DETECTOR_TYPE[type])
				: undefined,
		ignoresTimeZone: f.ignoresTimeZone,
		isRelative: f.isRelative,
		semantics: f.semantics,
		// Apple ignores textAlignment on primary and back fields.
		textAlignment:
			f.textAlignment && f.slot !== "primary" && f.slot !== "back"
				? APPLE_TEXT_ALIGNMENT[f.textAlignment]
				: undefined,
		// Apple only supports `row` on auxiliary fields (event tickets).
		row: f.slot === "auxiliary" ? f.row : undefined,
	};
}

function buildSlots(
	fields: FieldDef[],
	values: Readonly<Record<string, string | null>>
): AppleSlots {
	const slots: AppleSlots = {
		headerFields: [],
		primaryFields: [],
		secondaryFields: [],
		auxiliaryFields: [],
		backFields: [],
	};

	for (const f of fields) {
		const value = fieldValue(f, values);
		if (value !== undefined) {
			slots[SLOT_KEY[f.slot]].push(buildField(f, value));
		}
	}

	return slots;
}

type EventTicketConfig = Extract<ParsedTemplate, { type: "eventTicket" }>;
type BoardingPassConfig = Extract<ParsedTemplate, { type: "boardingPass" }>;

// Omit seats with no populated seat/row/section fields.
function buildSeats(
	fields: FieldDef[],
	values: Readonly<Record<string, string | null>>
): Record<string, string>[] | undefined {
	const seat: Record<string, string> = {};
	const number = fieldValueByKey(fields, values, "seat");
	const row = fieldValueByKey(fields, values, "row");
	const section = fieldValueByKey(fields, values, "section");
	if (number) {
		seat.seatNumber = number;
	}
	if (row) {
		seat.seatRow = row;
	}
	if (section) {
		seat.seatSection = section;
	}
	return number || row || section ? [seat] : undefined;
}

// Apple's date keys take W3C timestamps ("YYYY-MM-DDThh:mmTZD"), which always
// carry a time zone designator: https://www.w3.org/TR/NOTE-datetime, cited by
// https://developer.apple.com/documentation/walletpasses/pass (relevantDate).
// Google takes venue-local times without one ("with or without an offset",
// https://developers.google.com/wallet/reference/rest/v1/eventticketclass), so
// a zone-less template time still reaches Google but stays out of pass.json
// rather than becoming a date Wallet cannot place.
function zoned(value: string | undefined): string | undefined {
	return value && TIMEZONE_RE.test(value) ? value : undefined;
}

// Top-level semantics enable Wallet flight tracking and event relevance.
function buildBoardingPassSemantics(
	template: BoardingPassConfig,
	values: Readonly<Record<string, string | null>>
): Record<string, unknown> | undefined {
	const { carrier, flightNumber, origin, destination } = template;
	const semantics: Record<string, unknown> = {};
	if (carrier) {
		semantics.airlineCode = carrier;
	}
	if (carrier && flightNumber) {
		semantics.flightCode = `${carrier}${flightNumber}`;
	}
	if (flightNumber) {
		// SemanticTagType.flightNumber is the numeric portion, as a JSON number
		const numeric = Number.parseInt(flightNumber, 10);
		if (!Number.isNaN(numeric)) {
			semantics.flightNumber = numeric;
		}
	}
	if (origin) {
		semantics.departureAirportCode = origin;
	}
	if (destination) {
		semantics.destinationAirportCode = destination;
	}
	const departure = zoned(template.departure);
	const arrival = zoned(template.arrival);
	if (departure) {
		semantics.originalDepartureDate = departure;
	}
	if (arrival) {
		semantics.originalArrivalDate = arrival;
	}
	const gate = fieldValueByKey(template.fields, values, "gate");
	const terminal = fieldValueByKey(template.fields, values, "terminal");
	const boardingGroup =
		fieldValueByKey(template.fields, values, "boardingZone") ??
		fieldValueByKey(template.fields, values, "boardingGroup");
	if (gate) {
		semantics.departureGate = gate;
	}
	if (terminal) {
		semantics.departureTerminal = terminal;
	}
	if (boardingGroup) {
		semantics.boardingGroup = boardingGroup;
	}
	const seats = buildSeats(template.fields, values);
	if (seats) {
		semantics.seats = seats;
	}
	return Object.keys(semantics).length > 0 ? semantics : undefined;
}

function buildEventTicketSemantics(
	template: EventTicketConfig,
	values: Readonly<Record<string, string | null>>
): Record<string, unknown> {
	const semantics: Record<string, unknown> = { eventName: template.name };
	const startsAt = zoned(template.startsAt);
	const endsAt = zoned(template.endsAt);
	if (startsAt) {
		semantics.eventStartDate = startsAt;
	}
	if (endsAt) {
		semantics.eventEndDate = endsAt;
	}
	// A per-pass `venue` field wins over the template's venue.
	// https://developer.apple.com/documentation/walletpasses/semantictags (venueName)
	const venue =
		fieldValueByKey(template.fields, values, "venue") ?? template.venue?.name;
	if (venue) {
		semantics.venueName = venue;
	}
	const seats = buildSeats(template.fields, values);
	if (seats) {
		semantics.seats = seats;
	}
	return semantics;
}

// Poster event tickets use eventLogoText instead of logoText.
function resolveLogoText(template: ParsedTemplate): string | undefined {
	if (
		template.type === "eventTicket" &&
		(template.apple?.eventLogoText ||
			template.apple?.preferredStyleSchemes?.includes("posterEventTicket"))
	) {
		return;
	}
	return template.apple?.logoText || undefined;
}

// Explicit semantic tags override derived values for every pass type.
function buildSemantics(
	template: ParsedTemplate,
	values: Readonly<Record<string, string | null>>
): Record<string, unknown> | undefined {
	let derived: Record<string, unknown> | undefined;
	if (template.type === "boardingPass") {
		derived = buildBoardingPassSemantics(template, values);
	} else if (template.type === "eventTicket") {
		derived = buildEventTicketSemantics(template, values);
	}
	const user = template.apple?.semantics;
	if (!user) {
		return derived;
	}
	const merged = { ...derived, ...user };
	return Object.keys(merged).length > 0 ? merged : undefined;
}

// A date, or an interval when the end is known too.
function relevantInterval(
	start: string | undefined,
	end: string | undefined
): RelevantDate[] | undefined {
	const startDate = zoned(start);
	if (!startDate) {
		return;
	}
	const endDate = zoned(end);
	return endDate ? [{ startDate, endDate }] : [{ date: startDate }];
}

// Explicit relevance dates override event/flight times.
function deriveRelevantDates(
	template: ParsedTemplate
): RelevantDate[] | undefined {
	if (template.apple?.relevantDates) {
		return template.apple.relevantDates;
	}
	if (template.type === "eventTicket") {
		return relevantInterval(template.startsAt, template.endsAt);
	}
	if (template.type === "boardingPass") {
		return relevantInterval(template.departure, template.arrival);
	}
	return;
}

// `relevantDates` needs iOS 18; earlier systems read only the deprecated
// singular `relevantDate`, so it carries the first entry's start.
// https://developer.apple.com/documentation/walletpasses/pass/relevantdates-data.dictionary
function legacyRelevantDate(
	relevantDates: RelevantDate[] | undefined
): string | undefined {
	const first = relevantDates?.[0];
	if (!first) {
		return;
	}
	return "date" in first ? first.date : first.startDate;
}

// `barcodes` (plural) wins when both are given; a lone `barcode` becomes a
// single-entry array so the modern key is always populated.
function resolveBarcodes(content: ParsedContent): ParsedBarcode[] | undefined {
	if (content.barcodes?.length) {
		return content.barcodes;
	}
	return content.barcode ? [content.barcode] : undefined;
}

function toAppleBarcode(barcode: ParsedBarcode): Record<string, unknown> {
	return {
		message: barcode.value,
		format: APPLE_BARCODE_FORMAT[barcode.format],
		messageEncoding: toAppleMessageEncoding(barcode.format),
		altText: barcode.altText,
	};
}

/** Where a pass's device fetches updates, and the token it presents there. */
export interface AppleUpdateTarget {
	authenticationToken: string;
	url: string;
}

export function buildPassJson(
	template: ParsedTemplate,
	content: ParsedContent,
	credentials: Pick<AppleCredentials, "passTypeIdentifier" | "teamId">,
	update?: AppleUpdateTarget
): PassJson {
	const values = content.values ?? {};
	const slots: AppleSlots & { transitType?: string } = buildSlots(
		template.fields,
		values
	);
	if (template.type === "boardingPass" && template.transitType) {
		slots.transitType = TRANSIT_TYPE[template.transitType];
	}
	// Every pass type's options at once; the template schema already keeps
	// each type's keys to its own type.
	const apple: AppleEventTicketOptions & AppleBoardingPassOptions =
		template.apple ?? {};
	const {
		// Archive files, not pass.json keys.
		icon,
		logo,
		strip,
		background,
		thumbnail,
		footer,
		// Hex in the template, rgb() in pass.json.
		foregroundColor,
		labelColor,
		footerBackgroundColor,
		// Derived from the rest of the template below.
		description,
		logoText,
		relevantDates: explicitRelevantDates,
		semantics,
		...rest
	} = apple;
	// Every other option already has its pass.json name and shape, so it is
	// copied as is; an option that isn't a pass.json key fails to compile here.
	const verbatim: Pick<PassJson, keyof typeof rest> = rest;
	const barcodes = resolveBarcodes(content);
	// The deprecated singular key accepts only QR, PDF417 and Aztec.
	const legacy = barcodes?.find((b) => LEGACY_BARCODE_FORMATS.has(b.format));
	const relevantDates = deriveRelevantDates(template);

	return {
		formatVersion: 1,
		passTypeIdentifier: credentials.passTypeIdentifier,
		serialNumber: content.serialNumber,
		teamIdentifier: credentials.teamId,
		organizationName: template.name,
		description: description ?? template.name,
		logoText: resolveLogoText(template),
		...verbatim,
		backgroundColor: template.color ? hexToRgb(template.color) : undefined,
		foregroundColor: foregroundColor ? hexToRgb(foregroundColor) : undefined,
		labelColor: labelColor ? hexToRgb(labelColor) : undefined,
		footerBackgroundColor: footerBackgroundColor
			? hexToRgb(footerBackgroundColor)
			: undefined,
		expirationDate: content.expiresAt,
		voided: content.apple?.voided,
		barcodes: barcodes?.map(toAppleBarcode),
		barcode: legacy ? toAppleBarcode(legacy) : undefined,
		locations: template.locations,
		relevantDates,
		relevantDate: legacyRelevantDate(relevantDates),
		// Wallet groups only boarding passes and event tickets.
		groupingIdentifier:
			template.type === "eventTicket" || template.type === "boardingPass"
				? content.group
				: undefined,
		semantics: buildSemantics(template, values),
		...(update && {
			webServiceURL: update.url,
			authenticationToken: update.authenticationToken,
		}),
		[PASS_TYPE_KEY[template.type]]: slots,
	};
}
