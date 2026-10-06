import { WalletError } from "../errors";
import type { PassContent } from "../schema/content";
import type { FieldDef } from "../schema/parts";
import type {
	GoogleTransitOptions,
	TemplateConfig,
	TemplateType,
} from "../schema/template";
import {
	buildAppLinkData,
	buildModuleData,
	imageUri,
	localized,
	toGoogleBarcodeType,
	transitOptions,
	translationsFor,
} from "./utils";

function resolveFieldValue(
	field: FieldDef,
	values: Record<string, string | null>
): string | undefined {
	const value = field.key in values ? values[field.key] : field.value;
	return value ?? undefined;
}

function resolveValueByKey(
	fields: FieldDef[],
	values: Record<string, string | null>,
	key: string
): string | undefined {
	const match = fields.find((field) => field.key === key);
	if (!match) {
		return;
	}
	return resolveFieldValue(match, values);
}

function buildTextModules(
	fields: FieldDef[],
	values: Record<string, string | null>,
	excludeSlots: FieldDef["slot"][],
	excludeKeys: string[] = []
): Array<{ header: string; body: string; id: string }> {
	const modules: Array<{ header: string; body: string; id: string }> = [];
	for (const f of fields) {
		if (excludeSlots.includes(f.slot)) {
			continue;
		}
		if (excludeKeys.includes(f.key)) {
			continue;
		}
		const value = resolveFieldValue(f, values);
		if (value === undefined) {
			continue;
		}
		// label is optional on Apple; Google's textModulesData needs a header, so
		// fall back to the field key.
		modules.push({ header: f.label ?? f.key, body: value, id: f.key });
	}
	return modules;
}

function buildLoyaltyObjectFields(
	fields: FieldDef[],
	values: Record<string, string | null>
): Record<string, unknown> {
	const points = resolveValueByKey(fields, values, "points");
	const member = resolveValueByKey(fields, values, "member");
	const memberId = resolveValueByKey(fields, values, "memberId");
	return {
		loyaltyPoints: points == null ? undefined : { balance: { string: points } },
		accountName: member,
		accountId: memberId,
	};
}

function buildFlightObjectFields(
	serialNumber: string,
	values: Record<string, string | null>
): Record<string, unknown> {
	const passengerName = values.passengerName;
	// Google rejects an empty flightObject.passengerName.
	if (!passengerName) {
		throw new WalletError("GOOGLE_FLIGHT_MISSING_PASSENGER_NAME");
	}
	return {
		passengerName,
		reservationInfo: { confirmationCode: serialNumber },
	};
}

// Transit: transitObject requires tripType. Origin/destination and times are
// carried by ticketLeg rather than the class, unlike the flight vertical.
function buildTransitObjectFields(
	template: Extract<TemplateConfig, { type: "boardingPass" }>,
	transit: GoogleTransitOptions,
	content: PassContent,
	values: Record<string, string | null>
): Record<string, unknown> {
	const originName = transit.originName ?? template.origin;
	const destinationName = transit.destinationName ?? template.destination;
	// TicketLeg times are documented as ISO 8601 "with or without an offset" —
	// unlike flightClass local times, so they are forwarded verbatim.
	const ticketLeg: Record<string, unknown> = {
		originName: originName ? localized(originName) : undefined,
		destinationName: destinationName ? localized(destinationName) : undefined,
		departureDateTime: template.departure,
		arrivalDateTime: template.arrival,
	};
	const hasLeg = Object.values(ticketLeg).some((v) => v !== undefined);
	const tripType = content.google?.tripType ?? transit.tripType ?? "oneWay";
	const passengerNames = values.passengerName ?? undefined;
	return {
		tripType: tripType === "roundTrip" ? "ROUND_TRIP" : "ONE_WAY",
		ticketNumber: transit.ticketNumber,
		passengerNames,
		// The REST API rejects passengerNames without it ("passenger_type must
		// be set if passenger_names is set"); passlet issues one pass per person.
		passengerType: passengerNames ? "SINGLE_PASSENGER" : undefined,
		ticketLeg: hasLeg ? ticketLeg : undefined,
	};
}

function buildGiftCardObjectFields(
	template: Extract<TemplateConfig, { type: "giftCard" }>,
	fields: FieldDef[],
	values: Record<string, string | null>,
	serialNumber: string
): Record<string, unknown> {
	const raw = resolveValueByKey(fields, values, "balance");
	// Google requires cardNumber; use the serial number when no field supplies it.
	const cardNumber =
		resolveValueByKey(fields, values, "cardNumber") ?? serialNumber;
	return {
		cardNumber,
		balance:
			raw == null
				? undefined
				: {
						micros: String(Math.round(Number.parseFloat(raw) * 1_000_000)),
						currencyCode: template.currency ?? "USD",
					},
	};
}

// Event: structured seatInfo from well-known seat/row/section/gate field keys.
// Google renders these in dedicated ticket slots rather than as text modules.
function buildEventTicketObjectFields(
	fields: FieldDef[],
	values: Record<string, string | null>
): Record<string, unknown> {
	const seatInfo: Record<string, unknown> = {};
	for (const key of EVENT_SEAT_KEYS) {
		const value = resolveValueByKey(fields, values, key);
		if (value !== undefined) {
			seatInfo[key] = localized(value);
		}
	}
	return Object.keys(seatInfo).length > 0 ? { seatInfo } : {};
}

const EVENT_SEAT_KEYS = ["seat", "row", "section", "gate"];

// Well-known field keys that map to structured object fields and so must be
// excluded from the generic textModulesData for that pass type.
const STRUCTURED_FIELD_KEYS: Partial<Record<TemplateType, string[]>> = {
	loyalty: ["member", "memberId", "points"],
	eventTicket: EVENT_SEAT_KEYS,
};

// Only genericObject has header/subheader. Other verticals lead with the
// primary field in textModulesData (up to ten entries), replacing infoModuleData.
// https://developers.google.com/wallet/reference/rest/v1/genericobject
function buildDisplayFields(
	template: TemplateConfig,
	values: Record<string, string | null>
): Record<string, unknown> {
	const { fields, locales } = template;
	const generic = template.type === "generic";
	const primaryField = fields.find((f) => f.slot === "primary");
	const textModules = buildTextModules(
		generic || !primaryField
			? fields
			: [primaryField, ...fields.filter((f) => f !== primaryField)],
		values,
		generic ? ["primary"] : [],
		STRUCTURED_FIELD_KEYS[template.type] ?? []
	);
	const body: Record<string, unknown> = {
		textModulesData: textModules.length > 0 ? textModules : undefined,
	};
	if (!(generic && primaryField)) {
		return body;
	}
	const primaryValue = resolveFieldValue(primaryField, values);
	if (primaryValue === undefined) {
		return body;
	}
	body.subheader = localized(
		primaryField.label ?? primaryField.key,
		"en-US",
		translationsFor(primaryField.key, locales)
	);
	body.header = localized(
		primaryValue,
		"en-US",
		translationsFor(`${primaryField.key}_value`, locales)
	);
	return body;
}

export function buildObjectBody(
	template: TemplateConfig,
	content: PassContent,
	classId: string,
	objectId: string
): Record<string, unknown> {
	const values = content.values ?? {};
	const fields = template.fields;
	const transit = transitOptions(template);
	const googleBarcode = content.barcodes?.[0] ?? content.barcode;

	const display = buildDisplayFields(template, values);
	const genericTitle =
		template.type === "generic"
			? localized(
					template.name,
					"en-US",
					translationsFor("name", template.locales)
				)
			: undefined;

	return {
		id: objectId,
		classId,
		state: "ACTIVE",
		// A Google object holds a single barcode — when several are supplied it
		// takes the first entry.
		barcode: googleBarcode
			? {
					type: toGoogleBarcodeType(googleBarcode.format),
					value: googleBarcode.value,
					alternateText: googleBarcode.altText,
				}
			: undefined,
		validTimeInterval:
			content.validFrom || content.expiresAt
				? {
						start: content.validFrom ? { date: content.validFrom } : undefined,
						end: content.expiresAt ? { date: content.expiresAt } : undefined,
					}
				: undefined,
		// Smart Tap: per-recipient redemption value sent to NFC terminals
		smartTapRedemptionValue: content.google?.smartTapRedemptionValue,
		// Rotating barcode replaces the static barcode when set
		rotatingBarcode: content.google?.rotatingBarcode,
		messages: content.google?.messages,
		groupingInfo: content.group ? { groupingId: content.group } : undefined,
		// Per-recipient links, images, and value-added modules. Google merges
		// these with the class-level modules of the same name.
		...buildModuleData(content.google),
		...(template.type === "loyalty" &&
			buildLoyaltyObjectFields(fields, values)),
		...(template.type === "eventTicket" &&
			buildEventTicketObjectFields(fields, values)),
		...(template.type === "boardingPass" &&
			(transit
				? buildTransitObjectFields(template, transit, content, values)
				: buildFlightObjectFields(content.serialNumber, values))),
		...(template.type === "giftCard" &&
			buildGiftCardObjectFields(
				template,
				fields,
				values,
				content.serialNumber
			)),
		// Generic branding is object-level, unlike other pass types.
		...(template.type === "generic" && {
			cardTitle: genericTitle,
			hexBackgroundColor: template.color,
			logo: imageUri(template.google?.logo),
			wideLogo: imageUri(template.google?.wideLogo),
			heroImage: imageUri(template.google?.hero),
			...(template.google?.appLinkData && {
				appLinkData: buildAppLinkData(template.google.appLinkData),
			}),
		}),
		...display,
		// genericObject requires a header even when no primary value is available.
		...(template.type === "generic" &&
			display.header == null && {
				header: genericTitle,
			}),
	};
}
