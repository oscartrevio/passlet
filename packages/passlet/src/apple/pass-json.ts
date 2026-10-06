import type { ParsedContent } from "../schema/content";
import type { FieldDef, ParsedBarcode, RelevantDate } from "../schema/parts";
import type { AppleCredentials } from "../schema/settings";
import type { ParsedTemplate, TemplateType } from "../schema/template";
import {
	hexToRgb,
	isLegacyBarcodeFormat,
	toAppleBarcodeFormat,
	toAppleDataDetectorTypes,
	toAppleDateStyle,
	toAppleMessageEncoding,
	toAppleNumberStyle,
	toAppleTextAlignment,
} from "./utils";

const PASS_TYPE_KEY: Record<TemplateType, string> = {
	loyalty: "storeCard",
	coupon: "coupon",
	eventTicket: "eventTicket",
	boardingPass: "boardingPass",
	giftCard: "storeCard",
	generic: "generic",
};

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
		changeMessage: f.changeMessage || undefined,
		dateStyle: f.dateStyle ? toAppleDateStyle(f.dateStyle) : undefined,
		timeStyle: f.timeStyle ? toAppleDateStyle(f.timeStyle) : undefined,
		numberStyle: f.numberStyle ? toAppleNumberStyle(f.numberStyle) : undefined,
		currencyCode: f.currencyCode || undefined,
		// attributedValue overrides value on iOS and is ignored on watchOS.
		attributedValue: f.attributedValue,
		// Only back fields support detectors; [] explicitly disables them.
		dataDetectorTypes:
			f.dataDetectorTypes !== undefined && f.slot === "back"
				? toAppleDataDetectorTypes(f.dataDetectorTypes)
				: undefined,
		ignoresTimeZone: f.ignoresTimeZone,
		isRelative: f.isRelative,
		semantics: f.semantics,
		// Apple ignores textAlignment on primary and back fields.
		textAlignment:
			f.textAlignment && f.slot !== "primary" && f.slot !== "back"
				? toAppleTextAlignment(f.textAlignment)
				: undefined,
		// Apple only supports `row` on auxiliary fields (event tickets).
		row: f.slot === "auxiliary" ? f.row : undefined,
	};
}

function buildSlots(
	fields: FieldDef[],
	values: Record<string, string | null>
): AppleSlots {
	const slots: AppleSlots = {
		headerFields: [],
		primaryFields: [],
		secondaryFields: [],
		auxiliaryFields: [],
		backFields: [],
	};

	for (const f of fields) {
		const value = f.key in values ? values[f.key] : f.value;
		if (value === null || value === undefined) {
			continue;
		}

		slots[SLOT_KEY[f.slot]].push(buildField(f, value));
	}

	return slots;
}

type EventTicketConfig = Extract<ParsedTemplate, { type: "eventTicket" }>;
type BoardingPassConfig = Extract<ParsedTemplate, { type: "boardingPass" }>;

function buildEventTicketAppleFields(
	template: EventTicketConfig
): Record<string, unknown> {
	const a = template.apple;
	return {
		eventLogoText: a?.eventLogoText,
		footerBackgroundColor: a?.footerBackgroundColor
			? hexToRgb(a.footerBackgroundColor)
			: undefined,
		suppressHeaderDarkening: a?.suppressHeaderDarkening,
		useAutomaticColors: a?.useAutomaticColors,
		preferredStyleSchemes: a?.preferredStyleSchemes,
		auxiliaryStoreIdentifiers: a?.auxiliaryStoreIdentifiers,
		accessibilityURL: a?.accessibilityURL,
		addOnURL: a?.addOnURL,
		bagPolicyURL: a?.bagPolicyURL,
		contactVenueEmail: a?.contactVenueEmail,
		contactVenuePhoneNumber: a?.contactVenuePhoneNumber,
		contactVenueWebsite: a?.contactVenueWebsite,
		directionsInformationURL: a?.directionsInformationURL,
		merchandiseURL: a?.merchandiseURL,
		orderFoodURL: a?.orderFoodURL,
		parkingInformationURL: a?.parkingInformationURL,
		purchaseParkingURL: a?.purchaseParkingURL,
		sellURL: a?.sellURL,
		transferURL: a?.transferURL,
		transitInformationURL: a?.transitInformationURL,
	};
}

function buildBoardingPassAppleFields(
	template: BoardingPassConfig
): Record<string, unknown> {
	const a = template.apple;
	return {
		changeSeatURL: a?.changeSeatURL,
		entertainmentURL: a?.entertainmentURL,
		managementURL: a?.managementURL,
		purchaseAdditionalBaggageURL: a?.purchaseAdditionalBaggageURL,
		purchaseLoungeAccessURL: a?.purchaseLoungeAccessURL,
		purchaseWifiURL: a?.purchaseWifiURL,
		registerServiceAnimalURL: a?.registerServiceAnimalURL,
		reportLostBagURL: a?.reportLostBagURL,
		requestWheelchairURL: a?.requestWheelchairURL,
		trackBagsURL: a?.trackBagsURL,
		transitProviderEmail: a?.transitProviderEmail,
		transitProviderPhoneNumber: a?.transitProviderPhoneNumber,
		transitProviderWebsiteURL: a?.transitProviderWebsiteURL,
		upgradeURL: a?.upgradeURL,
	};
}

function fieldValue(
	fields: FieldDef[],
	values: Record<string, string | null>,
	key: string
): string | undefined {
	const f = fields.find((field) => field.key === key);
	if (!f) {
		return;
	}
	const v = f.key in values ? values[f.key] : f.value;
	return v == null ? undefined : v;
}

// Omit seats with no populated seat/row/section fields.
function buildSeats(
	fields: FieldDef[],
	values: Record<string, string | null>
): Record<string, string>[] | undefined {
	const seat: Record<string, string> = {};
	const number = fieldValue(fields, values, "seat");
	const row = fieldValue(fields, values, "row");
	const section = fieldValue(fields, values, "section");
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

// Top-level semantics enable Wallet flight tracking and event relevance.
function buildBoardingPassSemantics(
	template: BoardingPassConfig,
	values: Record<string, string | null>
): Record<string, unknown> | undefined {
	const { carrier, flightNumber, origin, destination, departure, arrival } =
		template;
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
	if (departure) {
		semantics.originalDepartureDate = departure;
	}
	if (arrival) {
		semantics.originalArrivalDate = arrival;
	}
	const gate = fieldValue(template.fields, values, "gate");
	const terminal = fieldValue(template.fields, values, "terminal");
	const boardingGroup =
		fieldValue(template.fields, values, "boardingZone") ??
		fieldValue(template.fields, values, "boardingGroup");
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
	values: Record<string, string | null>
): Record<string, unknown> {
	const semantics: Record<string, unknown> = { eventName: template.name };
	if (template.startsAt) {
		semantics.eventStartDate = template.startsAt;
	}
	if (template.endsAt) {
		semantics.eventEndDate = template.endsAt;
	}
	const venue = fieldValue(template.fields, values, "venue");
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
	values: Record<string, string | null>
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

// Explicit relevance dates override event/flight times.
function deriveRelevantDates(
	template: ParsedTemplate
): RelevantDate[] | undefined {
	if (template.apple?.relevantDates) {
		return template.apple.relevantDates;
	}
	if (template.type === "eventTicket" && template.startsAt) {
		return template.endsAt
			? [{ startDate: template.startsAt, endDate: template.endsAt }]
			: [{ date: template.startsAt }];
	}
	if (template.type === "boardingPass" && template.departure) {
		return template.arrival
			? [{ startDate: template.departure, endDate: template.arrival }]
			: [{ date: template.departure }];
	}
	return;
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
		format: toAppleBarcodeFormat(barcode.format),
		messageEncoding: toAppleMessageEncoding(barcode.format),
		altText: barcode.altText,
	};
}

function buildAppleCommonFields(
	template: ParsedTemplate,
	content: ParsedContent
): Record<string, unknown> {
	const a = template.apple;
	const barcodes = resolveBarcodes(content);
	// The deprecated singular key accepts only QR, PDF417 and Aztec.
	const legacy = barcodes?.find((b) => isLegacyBarcodeFormat(b.format));
	return {
		backgroundColor: template.color ? hexToRgb(template.color) : undefined,
		foregroundColor: a?.foregroundColor
			? hexToRgb(a.foregroundColor)
			: undefined,
		labelColor: a?.labelColor ? hexToRgb(a.labelColor) : undefined,
		expirationDate: content.expiresAt,
		voided: content.apple?.voided,
		barcodes: barcodes?.map(toAppleBarcode),
		barcode: legacy ? toAppleBarcode(legacy) : undefined,
		locations: template.locations?.map(
			({ latitude, longitude, altitude, relevantText }) => ({
				latitude,
				longitude,
				altitude,
				relevantText,
			})
		),
		beacons: a?.beacons,
		relevantDates: deriveRelevantDates(template),
		// Wallet groups only boarding passes and event tickets.
		groupingIdentifier:
			template.type === "eventTicket" || template.type === "boardingPass"
				? content.group
				: undefined,
		suppressStripShine: a?.suppressStripShine,
		sharingProhibited: a?.sharingProhibited,
		maxDistance: a?.maxDistance,
		nfc: a?.nfc
			? {
					message: a.nfc.message,
					encryptionPublicKey: a.nfc.encryptionPublicKey,
					requiresAuthentication: a.nfc.requiresAuthentication,
				}
			: undefined,
		appLaunchURL: a?.appLaunchURL,
		associatedStoreIdentifiers: a?.associatedStoreIdentifiers,
		userInfo: a?.userInfo,
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
	credentials: AppleCredentials,
	update?: AppleUpdateTarget
): Record<string, unknown> {
	const values = content.values ?? {};
	const slots: Record<string, unknown> = buildSlots(template.fields, values);
	if (template.type === "boardingPass" && template.transitType) {
		slots.transitType = TRANSIT_TYPE[template.transitType];
	}
	const a = template.apple;
	const semantics = buildSemantics(template, values);

	return {
		formatVersion: 1,
		passTypeIdentifier: credentials.passTypeIdentifier,
		serialNumber: content.serialNumber,
		teamIdentifier: credentials.teamId,
		organizationName: template.name,
		description: a?.description ?? template.name,
		logoText: resolveLogoText(template),
		...buildAppleCommonFields(template, content),
		...(update && {
			webServiceURL: update.url,
			authenticationToken: update.authenticationToken,
		}),
		...(template.type === "eventTicket" &&
			buildEventTicketAppleFields(template)),
		...(template.type === "boardingPass" &&
			buildBoardingPassAppleFields(template)),
		...(semantics && { semantics }),
		[PASS_TYPE_KEY[template.type]]: slots,
	};
}
