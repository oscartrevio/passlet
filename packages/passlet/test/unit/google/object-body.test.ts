import { describe, expect, it } from "vitest";
import { patchBody } from "../../../src/google/client";
import { buildObjectBody } from "../../../src/google/object-body";
import {
	type ParsedContent,
	passContentSchema,
} from "../../../src/schema/content";
import type {
	GoogleTransitOptions,
	ParsedTemplate,
} from "../../../src/schema/template";
import { FIXTURES, type FixtureName } from "../../support/fixtures";
import { ISSUER_ID, LOGO_URL } from "../../support/google";
import {
	assertGoogleSchema,
	assertRequiredKeys,
	type GoogleResource,
} from "../../support/google-schema";

const LOGO = { sourceUri: { uri: LOGO_URL } };

function en(value: string) {
	return { defaultValue: { language: "en-US", value } };
}

function build(pass: ParsedTemplate, create: ParsedContent) {
	return buildObjectBody(
		pass,
		create,
		`${ISSUER_ID}.${pass.id}`,
		`${ISSUER_ID}.${create.serialNumber}`
	);
}

function transitPass(transit: GoogleTransitOptions): ParsedTemplate {
	const pass = FIXTURES.transit.pass;
	if (pass.type !== "boardingPass") {
		throw new Error("transit fixture must be a flight pass");
	}
	return { ...pass, google: { logo: LOGO_URL, transit } };
}

// `state` is set by the insert request, not the body, so updates keep it.
const BASE_REQUIRED = ["id", "classId"];

interface Golden {
	body: Record<string, unknown>;
	required: readonly string[];
	resource: GoogleResource;
}

const GOLDEN: Record<FixtureName, Golden> = {
	loyalty: {
		resource: "loyaltyObject",
		required: BASE_REQUIRED,
		body: {
			id: `${ISSUER_ID}.loyalty-001`,
			classId: `${ISSUER_ID}.fx-loyalty`,
			barcode: { type: "QR_CODE", value: "LOY-1250" },
			// points and member feed structured fields, so they stay out of
			// textModulesData even though member sits in the back slot.
			loyaltyPoints: { balance: { string: "1250" } },
			accountName: "Jane Doe",
			textModulesData: [
				{ header: "Tier", body: "Gold", id: "tier" },
				{ header: "Terms", body: "No refunds.", id: "terms" },
			],
		},
	},
	eventTicket: {
		resource: "eventTicketObject",
		required: BASE_REQUIRED,
		body: {
			id: `${ISSUER_ID}.event-001`,
			classId: `${ISSUER_ID}.fx-event`,
			barcode: { type: "PDF_417", value: "EVT-1" },
			// seat/row/section/gate render in dedicated ticket slots; the primary
			// field has no home on eventTicketObject, so it leads textModulesData.
			seatInfo: {
				seat: en("A12"),
				row: en("12"),
				section: en("A"),
				gate: en("3"),
			},
			textModulesData: [{ header: "Venue", body: "Central Park", id: "venue" }],
		},
	},
	boardingPass: {
		resource: "flightObject",
		required: [...BASE_REQUIRED, "passengerName", "reservationInfo"],
		body: {
			id: `${ISSUER_ID}.flight-001`,
			classId: `${ISSUER_ID}.fx-flight`,
			barcode: { type: "AZTEC", value: "BP-1" },
			passengerName: "Jane Doe",
			reservationInfo: { confirmationCode: "flight-001" },
			// Google renders the seat in the card's SEAT slot, so it is not
			// repeated as a text module.
			boardingAndSeatingInfo: { seatNumber: "14A" },
			textModulesData: [
				{ header: "Gate", body: "B22", id: "gate" },
				{ header: "Passenger", body: "Jane Doe", id: "passengerName" },
				{ header: "Terminal", body: "4", id: "terminal" },
			],
		},
	},
	transit: {
		resource: "transitObject",
		required: [...BASE_REQUIRED, "tripType"],
		body: {
			id: `${ISSUER_ID}.transit-001`,
			classId: `${ISSUER_ID}.fx-transit`,
			tripType: "ROUND_TRIP",
			ticketNumber: "TK-9001",
			// transitObject pluralises the passenger field.
			passengerNames: "Jane Doe",
			// Google's REST API requires it alongside passengerNames.
			passengerType: "SINGLE_PASSENGER",
			// TicketLeg times accept an offset, unlike flightClass local times.
			ticketLeg: {
				originName: en("PAD"),
				destinationName: en("BRI"),
				departureDateTime: "2026-07-15T08:00:00+01:00",
				arrivalDateTime: "2026-07-15T09:45:00+01:00",
			},
			textModulesData: [
				{ header: "Platform", body: "4", id: "platform" },
				{ header: "Passenger", body: "Jane Doe", id: "passengerName" },
			],
		},
	},
	coupon: {
		resource: "offerObject",
		required: BASE_REQUIRED,
		body: {
			id: `${ISSUER_ID}.coupon-001`,
			classId: `${ISSUER_ID}.fx-coupon`,
			validTimeInterval: { end: { date: "2026-12-31T23:59:59Z" } },
			// offerObject has no structured display fields: everything is a text
			// module, primary field first.
			textModulesData: [
				{ header: "Offer", body: "20% off", id: "offer" },
				{ header: "Code", body: "SUMMER20", id: "code" },
			],
		},
	},
	giftCard: {
		resource: "giftCardObject",
		required: [...BASE_REQUIRED, "cardNumber"],
		body: {
			id: `${ISSUER_ID}.gift-001`,
			classId: `${ISSUER_ID}.fx-gift`,
			// cardNumber is required; it defaults to the serial number.
			cardNumber: "gift-001",
			balance: { micros: "50000000", currencyCode: "USD" },
			textModulesData: [
				{ header: "Balance", body: "50.00", id: "balance" },
				{ header: "Issued", body: "2026-01-15T00:00:00Z", id: "issued" },
				{ header: "PIN", body: "1234", id: "pin" },
			],
		},
	},
	generic: {
		resource: "genericObject",
		required: [...BASE_REQUIRED, "cardTitle", "header"],
		// genericObject carries the branding other verticals put on the class,
		// and shows the primary field as subheader (label) / header (value).
		body: {
			id: `${ISSUER_ID}.generic-001`,
			classId: `${ISSUER_ID}.fx-generic`,
			cardTitle: en("Member Card"),
			hexBackgroundColor: "#264653",
			logo: LOGO,
			subheader: en("Member ID"),
			header: en("M-98765"),
			textModulesData: [{ header: "Name", body: "Jane Doe", id: "name" }],
		},
	},
};

describe("buildObjectBody", () => {
	describe.each(Object.keys(GOLDEN) as FixtureName[])("%s", (name) => {
		const { resource, required, body: expected } = GOLDEN[name];

		it(`builds exactly the expected ${resource}`, () => {
			const { pass, create } = FIXTURES[name];
			const body = build(pass, create);
			assertGoogleSchema(resource, body);
			assertRequiredKeys(resource, body, required);
			expect(body).toEqual(expected);
		});
	});

	it("applies per-recipient values over field defaults and hides fields set to null", () => {
		const { pass, create } = FIXTURES.loyalty;
		const body = build(pass, {
			...create,
			values: { points: "1500", tier: "Platinum", member: null, terms: null },
		});
		expect(body.loyaltyPoints).toEqual({ balance: { string: "1500" } });
		expect(body.accountName).toBeUndefined();
		expect(body.textModulesData).toEqual([
			{ header: "Tier", body: "Platinum", id: "tier" },
		]);

		// Nothing left to show: the key stays unset rather than an empty list.
		const hidden = build(pass, {
			...create,
			values: { tier: null, terms: null },
		});
		expect(hidden.textModulesData).toBeUndefined();
	});

	it("falls back to the field key as header when a field has no label", () => {
		const body = build(
			{
				...FIXTURES.loyalty.pass,
				fields: [{ slot: "secondary", key: "tier", value: "Gold" }],
			},
			FIXTURES.loyalty.create
		);
		expect(body.textModulesData).toEqual([
			{ header: "tier", body: "Gold", id: "tier" },
		]);
	});

	it("takes the first entry of barcodes over the single barcode", () => {
		const body = build(FIXTURES.loyalty.pass, {
			serialNumber: "loyalty-002",
			barcode: { value: "LOY-1250", format: "QR" },
			barcodes: [
				{ value: "12345", format: "EAN13", altText: "1 2 3 4 5" },
				{ value: "ABC-123", format: "QR" },
			],
		});
		expect(body.barcode).toEqual({
			type: "EAN_13",
			value: "12345",
			alternateText: "1 2 3 4 5",
		});
	});

	it("throws GOOGLE_FLIGHT_MISSING_PASSENGER_NAME when no passengerName value is supplied", () => {
		expect(() =>
			build(FIXTURES.boardingPass.pass, { serialNumber: "flight-002" })
		).toThrow(
			expect.objectContaining({ code: "GOOGLE_FLIGHT_MISSING_PASSENGER_NAME" })
		);
	});

	describe("transit", () => {
		it.each([
			[undefined, undefined, "ONE_WAY"],
			[undefined, "roundTrip", "ROUND_TRIP"],
			["roundTrip", "oneWay", "ONE_WAY"],
		] as const)("resolves tripType %s with per-recipient %s to %s", (classLevel, perRecipient, expected) => {
			const body = build(transitPass({ tripType: classLevel }), {
				serialNumber: "transit-002",
				google: { tripType: perRecipient },
			});
			expect(body.tripType).toBe(expected);
		});

		it("prefers google.transit station names over the pass origin and destination codes", () => {
			const body = build(
				transitPass({
					originName: "Market Street",
					destinationName: "Harbour",
				}),
				FIXTURES.transit.create
			);
			expect(body.ticketLeg).toMatchObject({
				originName: en("Market Street"),
				destinationName: en("Harbour"),
			});
		});
	});

	it("uses a cardNumber field over the serial number on gift cards", () => {
		const { pass, create } = FIXTURES.giftCard;
		const body = build(
			{
				...pass,
				fields: [
					...pass.fields,
					{
						slot: "back",
						key: "cardNumber",
						label: "Card Number",
						value: "1234-5678-9012",
					},
				],
			},
			create
		);
		expect(body.cardNumber).toBe("1234-5678-9012");
	});

	describe("generic", () => {
		it("falls back header to the pass name when there is no primary field", () => {
			const { pass, create } = FIXTURES.generic;
			const body = build(
				{
					...pass,
					fields: pass.fields.filter((field) => field.slot !== "primary"),
				},
				create
			);
			// genericObject requires header even without a primary value.
			expect(body.header).toEqual(en("Member Card"));
			expect(body.subheader).toBeUndefined();
		});

		it("translates cardTitle, subheader and header from locales, leaving translatedValues unset when no locale matches", () => {
			const { pass, create } = FIXTURES.generic;
			const body = build(
				{
					...pass,
					locales: {
						es: {
							name: "Tarjeta de Socio",
							mid: "ID de socio",
							mid_value: "S-98765",
						},
						fr: { name: "Carte de Membre" },
					},
				},
				create
			);
			expect(body.cardTitle).toEqual({
				...en("Member Card"),
				translatedValues: [
					{ language: "es", value: "Tarjeta de Socio" },
					{ language: "fr", value: "Carte de Membre" },
				],
			});
			expect(body.subheader).toEqual({
				...en("Member ID"),
				translatedValues: [{ language: "es", value: "ID de socio" }],
			});
			// "<key>_value" translates the field value shown as header.
			expect(body.header).toEqual({
				...en("M-98765"),
				translatedValues: [{ language: "es", value: "S-98765" }],
			});

			// toEqual ignores undefined but not an empty translatedValues list.
			const unmatched = build(
				{ ...pass, locales: { es: { name: "Tarjeta de Socio" } } },
				create
			);
			expect(unmatched.subheader).toEqual(en("Member ID"));
			expect(unmatched.header).toEqual(en("M-98765"));
		});
	});

	it("lands per-recipient modules and messages on the object", () => {
		const body = build(FIXTURES.loyalty.pass, {
			serialNumber: "loyalty-002",
			google: {
				links: [{ uri: "https://example.com/me" }],
				images: [{ url: "https://example.com/me.png" }],
				valueAdded: [{ header: "Perks", uri: "https://example.com/perks" }],
				messages: [
					{
						header: "Welcome",
						body: "Thanks for joining",
						messageType: "TEXT",
					},
				],
			},
		});
		assertGoogleSchema("loyaltyObject", body);
		expect(body.linksModuleData).toEqual({
			uris: [{ uri: "https://example.com/me" }],
		});
		expect(body.imageModulesData).toEqual([
			{ mainImage: { sourceUri: { uri: "https://example.com/me.png" } } },
		]);
		expect(body.valueAddedModuleData).toEqual([
			{ header: en("Perks"), uri: "https://example.com/perks" },
		]);
		expect(body.messages).toEqual([
			{ header: "Welcome", body: "Thanks for joining", messageType: "TEXT" },
		]);
	});
});

// Google's PATCH as observed against the live API: nested objects merge, null
// clears, and lists and scalars replace.
function applyPatch(stored: object, patch: object): Record<string, unknown> {
	const result: Record<string, unknown> = { ...stored };
	for (const [key, value] of Object.entries(patch)) {
		const current = result[key];
		if (value === null) {
			result[key] = undefined;
		} else if (typeof value === "object" && !Array.isArray(value)) {
			const base =
				typeof current === "object" &&
				current !== null &&
				!Array.isArray(current)
					? current
					: {};
			result[key] = applyPatch(base, value);
		} else {
			result[key] = value;
		}
	}
	return result;
}

describe("updating an object", () => {
	// Everything passlet can put on an object, so a later write that leaves it
	// out shows whether the field is cleared or left stale.
	function rich(create: ParsedContent): ParsedContent {
		return passContentSchema.parse({
			...create,
			barcode: { format: "QR", value: "R-1", altText: "Show at the door" },
			validFrom: "2026-01-01T00:00:00Z",
			expiresAt: "2027-01-01T00:00:00Z",
			group: "household",
			google: {
				smartTapRedemptionValue: "tap-1",
				rotatingBarcode: {
					valuePattern: "https://example.com/{totp_value_hex}",
					totpDetails: { parameters: [{ key: "k", valueLength: 8 }] },
					renderEncoding: "UTF_8",
				},
				messages: [{ header: "Hi", body: "Welcome" }],
				links: [{ uri: "https://example.com/me" }],
				images: [{ url: "https://example.com/me.png" }],
				valueAdded: [{ header: "Perks", uri: "https://example.com/perks" }],
			},
		});
	}

	// Every other value nulled and every optional part dropped or trimmed.
	function sparse(pass: ParsedTemplate, create: ParsedContent): ParsedContent {
		return passContentSchema.parse({
			serialNumber: create.serialNumber,
			barcode: { format: "QR", value: "R-2" },
			validFrom: "2026-02-01T00:00:00Z",
			google: {
				rotatingBarcode: {
					valuePattern: "https://example.com/{totp_value_hex}",
					totpDetails: { parameters: [{ key: "k", valueLength: 8 }] },
				},
			},
			values: Object.fromEntries(
				pass.fields.map((field, index) => [
					field.key,
					// Google rejects a flight object without a passenger name.
					index % 2 === 0 && field.key !== "passengerName"
						? null
						: (create.values?.[field.key] ?? field.value ?? "kept"),
				])
			),
		});
	}

	function empty(pass: ParsedTemplate, create: ParsedContent): ParsedContent {
		return {
			serialNumber: create.serialNumber,
			values: Object.fromEntries(
				pass.fields.map((field) => [
					field.key,
					field.key === "passengerName" ? "Jane Doe" : null,
				])
			),
		};
	}

	describe.each(Object.keys(FIXTURES) as FixtureName[])("%s", (name) => {
		const { pass, create } = FIXTURES[name];
		const stored = JSON.parse(JSON.stringify(build(pass, rich(create))));

		it.each([
			{ label: "a sparser", next: sparse(pass, create) },
			{ label: "an empty", next: empty(pass, create) },
		])("leaves exactly $label content after a patch", ({ next }) => {
			const body = build(pass, next);
			expect(applyPatch(stored, patchBody(body))).toEqual(body);
		});
	});

	it("clears loyalty points and text modules whose values became null", () => {
		const { pass, create } = FIXTURES.loyalty;
		const patch = patchBody(
			build(pass, {
				...create,
				values: { points: null, tier: null, terms: null },
			})
		);
		expect(patch).toMatchObject({
			loyaltyPoints: null,
			textModulesData: null,
		});
		expect(patch).not.toHaveProperty("state");
	});

	it("clears a flight's seat number once the seat value is gone", () => {
		const { pass, create } = FIXTURES.boardingPass;
		const patch = patchBody(
			build(pass, { ...create, values: { ...create.values, seat: null } })
		);
		expect(patch).toMatchObject({ boardingAndSeatingInfo: null });
	});
});
