import { WalletError } from "../errors";
import { fieldValue, fieldValueByKey } from "../field";
import type { ParsedContent } from "../schema/content";
import type { GoogleTransitOptions } from "../schema/google";
import type { FieldDef } from "../schema/parts";
import type { ParsedTemplate } from "../schema/template";
import {
	buildAppLinkData,
	buildModuleData,
	GOOGLE_BARCODE_TYPE,
	imageUri,
	localized,
	translationsFor,
} from "./utils";

/** The value a template field shows for this recipient, recorded as rendered. */
type Take = (key: string) => string | undefined;

type TemplateOf<T extends ParsedTemplate["type"]> = Extract<
	ParsedTemplate,
	{ type: T }
>;

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

const EVENT_SEAT_KEYS = ["seat", "row", "section", "gate"] as const;

// Flight: the `seat` field becomes boardingAndSeatingInfo.seatNumber, which
// Google renders in the card's SEAT slot and is the field a notifyOnUpdate
// PATCH announces to holders.
// https://developers.google.com/wallet/tickets/boarding-passes/resources/template
// https://developers.google.com/wallet/tickets/boarding-passes/use-cases/trigger-push-notifications
function flightObjectFields(
	serialNumber: string,
	passengerName: string | undefined,
	take: Take
) {
	// Google rejects an empty flightObject.passengerName.
	if (!passengerName) {
		throw new WalletError("GOOGLE_FLIGHT_MISSING_PASSENGER_NAME");
	}
	const seatNumber = take("seat");
	return {
		passengerName,
		reservationInfo: { confirmationCode: serialNumber },
		boardingAndSeatingInfo:
			seatNumber === undefined ? undefined : { seatNumber },
	};
}

// Transit: transitObject requires tripType. Origin/destination and times are
// carried by ticketLeg rather than the class, unlike the flight vertical.
function transitObjectFields(
	template: TemplateOf<"boardingPass">,
	transit: GoogleTransitOptions,
	content: ParsedContent,
	passengerNames: string | undefined
) {
	const originName = transit.originName ?? template.origin;
	const destinationName = transit.destinationName ?? template.destination;
	// TicketLeg times are documented as ISO 8601 "with or without an offset" —
	// unlike flightClass local times, so they are forwarded verbatim.
	const ticketLeg = {
		originName: originName ? localized(originName) : undefined,
		destinationName: destinationName ? localized(destinationName) : undefined,
		departureDateTime: template.departure,
		arrivalDateTime: template.arrival,
	};
	const tripType = content.google?.tripType ?? transit.tripType ?? "oneWay";
	return {
		tripType: tripType === "roundTrip" ? "ROUND_TRIP" : "ONE_WAY",
		ticketNumber: transit.ticketNumber,
		passengerNames,
		// The REST API rejects passengerNames without it ("passenger_type must
		// be set if passenger_names is set"); passlet issues one pass per person.
		passengerType: passengerNames ? "SINGLE_PASSENGER" : undefined,
		ticketLeg: Object.values(ticketLeg).some((v) => v !== undefined)
			? ticketLeg
			: undefined,
	};
}

// genericObject carries the branding other verticals put on the class, and
// is the only object with header/subheader: the primary field's value and
// label. Google requires a header, so the pass name stands in without one.
// https://developers.google.com/wallet/reference/rest/v1/genericobject
function genericObjectFields(template: TemplateOf<"generic">, take: Take) {
	const { google, locales } = template;
	const cardTitle = localized(template.name, translationsFor("name", locales));
	const primary = template.fields.find((f) => f.slot === "primary");
	const value = primary && take(primary.key);
	return {
		cardTitle,
		hexBackgroundColor: template.color,
		logo: imageUri(google?.logo),
		wideLogo: imageUri(google?.wideLogo),
		heroImage: imageUri(google?.hero),
		appLinkData: buildAppLinkData(google?.appLinkData),
		...(primary && value !== undefined
			? {
					header: localized(
						value,
						translationsFor(`${primary.key}_value`, locales)
					),
					subheader: localized(
						primary.label ?? primary.key,
						translationsFor(primary.key, locales)
					),
				}
			: { header: cardTitle, subheader: undefined }),
	};
}

/**
 * The fields only this template's object type has. Template fields they show
 * are read through `take`, so text modules leave them out instead of showing
 * the same value twice.
 */
function verticalObjectFields(
	template: ParsedTemplate,
	content: ParsedContent,
	take: Take
) {
	switch (template.type) {
		case "loyalty": {
			const points = take("points");
			return {
				loyaltyPoints:
					points === undefined ? undefined : { balance: { string: points } },
				accountName: take("member"),
				accountId: take("memberId"),
			};
		}
		case "eventTicket": {
			// seat/row/section/gate render in dedicated ticket slots. Every slot is
			// stated, so an update clears one that no longer has a value.
			const seatInfo = Object.fromEntries(
				EVENT_SEAT_KEYS.map((key) => {
					const value = take(key);
					return [key, value === undefined ? undefined : localized(value)];
				})
			);
			return {
				seatInfo: Object.values(seatInfo).some((v) => v !== undefined)
					? seatInfo
					: undefined,
			};
		}
		case "boardingPass": {
			// Senders may pass `values.passengerName` without a template field, so
			// the raw value stands in when the template has none.
			const passengerName =
				take("passengerName") ?? content.values?.passengerName ?? undefined;
			const transit = template.google?.transit;
			return transit
				? transitObjectFields(template, transit, content, passengerName)
				: flightObjectFields(content.serialNumber, passengerName, take);
		}
		case "giftCard": {
			const balance = take("balance");
			return {
				// Google requires cardNumber; the serial number stands in.
				cardNumber: take("cardNumber") ?? content.serialNumber,
				balance:
					balance === undefined
						? undefined
						: {
								micros: balanceMicros(balance),
								// The balance field's Apple currencyCode names the same currency.
								currencyCode:
									template.currency ??
									template.fields.find((f) => f.key === "balance")
										?.currencyCode ??
									"USD",
							},
			};
		}
		case "coupon":
			// offerObject has no structured display fields.
			return {};
		case "generic":
			return genericObjectFields(template, take);
		default:
			return template satisfies never;
	}
}

// Every field a vertical did not render becomes a text module, the primary
// field first; label is optional on Apple, so the key stands in as header.
function buildTextModules(
	fields: readonly FieldDef[],
	values: Readonly<Record<string, string | null>>,
	rendered: ReadonlySet<string>
) {
	const primary = fields.find((f) => f.slot === "primary");
	const ordered = primary
		? [primary, ...fields.filter((f) => f !== primary)]
		: fields;
	const modules = ordered.flatMap((f) => {
		const body = rendered.has(f.key) ? undefined : fieldValue(f, values);
		return body === undefined
			? []
			: [{ header: f.label ?? f.key, body, id: f.key }];
	});
	return modules.length > 0 ? modules : undefined;
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
	const rendered = new Set<string>();
	const verticalFields = verticalObjectFields(template, content, (key) => {
		rendered.add(key);
		return fieldValueByKey(template.fields, values, key);
	});
	// A Google object holds a single barcode, so it takes the first one.
	const barcode = content.barcodes?.[0] ?? content.barcode;
	const rotatingBarcode = content.google?.rotatingBarcode;

	return {
		id: objectId,
		classId,
		barcode: barcode && {
			type: GOOGLE_BARCODE_TYPE[barcode.format],
			value: barcode.value,
			alternateText: barcode.altText,
		},
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
		// these with the class-level modules of the same name.
		...buildModuleData(content.google),
		...verticalFields,
		textModulesData: buildTextModules(template.fields, values, rendered),
	};
}
