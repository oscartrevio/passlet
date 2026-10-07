import { WalletError } from "../errors";
import type { ParsedContent } from "../schema/content";
import type { FieldDef } from "../schema/parts";
import type { GoogleTransitOptions, ParsedTemplate } from "../schema/template";
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

// Flight: the `seat` field becomes boardingAndSeatingInfo.seatNumber, which
// Google renders in the card's SEAT slot and is the field a notifyOnUpdate
// PATCH announces to holders.
// https://developers.google.com/wallet/tickets/boarding-passes/resources/template
// https://developers.google.com/wallet/tickets/boarding-passes/use-cases/trigger-push-notifications
function buildFlightObjectFields(
	serialNumber: string,
	fields: FieldDef[],
	values: Record<string, string | null>
): Record<string, unknown> {
	const passengerName = values.passengerName;
	// Google rejects an empty flightObject.passengerName.
	if (!passengerName) {
		throw new WalletError("GOOGLE_FLIGHT_MISSING_PASSENGER_NAME");
	}
	const seatNumber = resolveValueByKey(fields, values, "seat");
	return {
		passengerName,
		reservationInfo: { confirmationCode: serialNumber },
		boardingAndSeatingInfo:
			seatNumber === undefined ? undefined : { seatNumber },
	};
}

// Transit: transitObject requires tripType. Origin/destination and times are
// carried by ticketLeg rather than the class, unlike the flight vertical.
function buildTransitObjectFields(
	template: Extract<ParsedTemplate, { type: "boardingPass" }>,
	transit: GoogleTransitOptions,
	content: ParsedContent,
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

// Money.micros is an int64 string: "$1 USD would be represented as 1000000
// micros". Parsed as decimal digits, never through a float, so the amount is
// exact and a non-number is rejected before any request.
// https://developers.google.com/wallet/reference/rest/v1/Money
const DECIMAL_RE = /^(\d+)(?:\.(\d{1,6}))?$/;

function balanceMicros(raw: string): string {
	const match = DECIMAL_RE.exec(raw.trim());
	if (!match) {
		const issue = {
			path: ["values", "balance"],
			message:
				'Google Wallet needs the gift card balance as a decimal number with up to 6 decimal places, e.g. "50.00"',
		};
		throw new WalletError(
			"CREATE_CONFIG_INVALID",
			`values.balance: ${issue.message}`,
			{ issues: [issue] }
		);
	}
	const [, whole = "", fraction = ""] = match;
	return String(BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0")));
}

function buildGiftCardObjectFields(
	template: Extract<ParsedTemplate, { type: "giftCard" }>,
	fields: FieldDef[],
	values: Record<string, string | null>,
	serialNumber: string
): Record<string, unknown> {
	const balanceField = fields.find((field) => field.key === "balance");
	const raw = balanceField && resolveFieldValue(balanceField, values);
	// Google requires cardNumber; use the serial number when no field supplies it.
	const cardNumber =
		resolveValueByKey(fields, values, "cardNumber") ?? serialNumber;
	return {
		cardNumber,
		balance:
			raw == null
				? undefined
				: {
						micros: balanceMicros(raw),
						// The balance field's Apple currencyCode names the same currency.
						currencyCode:
							template.currency ?? balanceField?.currencyCode ?? "USD",
					},
	};
}

// Event: structured seatInfo from well-known seat/row/section/gate field keys.
// Google renders these in dedicated ticket slots rather than as text modules.
// Every slot is stated, so an update clears one that no longer has a value.
function buildEventTicketObjectFields(
	fields: FieldDef[],
	values: Record<string, string | null>
): Record<string, unknown> {
	const seatInfo: Record<string, unknown> = {};
	for (const key of EVENT_SEAT_KEYS) {
		const value = resolveValueByKey(fields, values, key);
		seatInfo[key] = value === undefined ? undefined : localized(value);
	}
	return {
		seatInfo: Object.values(seatInfo).some((v) => v !== undefined)
			? seatInfo
			: undefined,
	};
}

const EVENT_SEAT_KEYS = ["seat", "row", "section", "gate"];

// Well-known field keys that map to structured object fields and so must be
// excluded from the generic textModulesData for that pass type.
function structuredFieldKeys(template: ParsedTemplate): string[] {
	switch (template.type) {
		case "loyalty":
			return ["member", "memberId", "points"];
		case "eventTicket":
			return EVENT_SEAT_KEYS;
		case "boardingPass":
			return transitOptions(template) ? [] : ["seat"];
		default:
			return [];
	}
}

// Only genericObject has header/subheader. Other verticals lead with the
// primary field in textModulesData (up to ten entries), replacing infoModuleData.
// https://developers.google.com/wallet/reference/rest/v1/genericobject
function buildDisplayFields(
	template: ParsedTemplate,
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
		structuredFieldKeys(template)
	);
	const body: Record<string, unknown> = {
		textModulesData: textModules.length > 0 ? textModules : undefined,
	};
	if (!generic) {
		return body;
	}
	const primaryValue = primaryField
		? resolveFieldValue(primaryField, values)
		: undefined;
	if (!primaryField || primaryValue === undefined) {
		return { ...body, header: undefined, subheader: undefined };
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

/**
 * The object as passlet owns it. Every field passlet can set for the object's
 * vertical is present, `undefined` when this content leaves it empty, so an
 * update can clear what the content no longer has. `state` is absent: the
 * insert sets it, and an update keeps whatever state the object is in.
 * Fields passlet never sets are absent and left to Google.
 */
export function buildObjectBody(
	template: ParsedTemplate,
	content: ParsedContent,
	classId: string,
	objectId: string
): Record<string, unknown> {
	const values = content.values ?? {};
	const fields = template.fields;
	const transit = transitOptions(template);
	const googleBarcode = content.barcodes?.[0] ?? content.barcode;
	const rotatingBarcode = content.google?.rotatingBarcode;

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
		// Rotating barcode replaces the static barcode when set. renderEncoding
		// is optional, so it is stated to clear one an earlier write set.
		rotatingBarcode: rotatingBarcode && {
			renderEncoding: undefined,
			...rotatingBarcode,
		},
		messages: content.google?.messages,
		groupingInfo: content.group ? { groupingId: content.group } : undefined,
		// Per-recipient links, images, and value-added modules. Google merges
		// these with the class-level modules of the same name. buildModuleData
		// omits empty modules, so each is stated here first.
		linksModuleData: undefined,
		imageModulesData: undefined,
		valueAddedModuleData: undefined,
		...buildModuleData(content.google),
		...(template.type === "loyalty" &&
			buildLoyaltyObjectFields(fields, values)),
		...(template.type === "eventTicket" &&
			buildEventTicketObjectFields(fields, values)),
		...(template.type === "boardingPass" &&
			(transit
				? buildTransitObjectFields(template, transit, content, values)
				: buildFlightObjectFields(content.serialNumber, fields, values))),
		...(template.type === "giftCard" &&
			buildGiftCardObjectFields(
				template,
				fields,
				values,
				content.serialNumber
			)),
		...(template.type === "generic" && {
			cardTitle: genericTitle,
			hexBackgroundColor: template.color,
			logo: imageUri(template.google?.logo),
			wideLogo: imageUri(template.google?.wideLogo),
			heroImage: imageUri(template.google?.hero),
			appLinkData: template.google?.appLinkData
				? buildAppLinkData(template.google.appLinkData)
				: undefined,
		}),
		...display,
		// genericObject requires a header even when no primary value is available.
		...(template.type === "generic" &&
			display.header == null && {
				header: genericTitle,
			}),
	};
}
