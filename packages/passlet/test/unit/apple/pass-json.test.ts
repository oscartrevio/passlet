import { describe, expect, it } from "vitest";
import {
	buildPassJson,
	validateAppleRequirements,
} from "../../../src/providers/apple/index";
import type { CreateConfig, PassConfig } from "../../../src/types/schemas";
import {
	ICON,
	PASS_TYPE_IDENTIFIER,
	TEAM_ID,
	UNSIGNED_APPLE_CREDENTIALS,
} from "../../support/apple";
import { FIXTURES, type FixtureName } from "../../support/fixtures";

type Json = Record<string, unknown>;
type SlotsJson = Record<
	| "headerFields"
	| "primaryFields"
	| "secondaryFields"
	| "auxiliaryFields"
	| "backFields",
	Json[]
> & { transitType?: string };

type LoyaltyPass = Extract<PassConfig, { type: "loyalty" }>;
type EventPass = Extract<PassConfig, { type: "event" }>;
type FlightPass = Extract<PassConfig, { type: "flight" }>;

const CREATE: CreateConfig = { serialNumber: "s1" };

/** pass.json as it lands in the archive — keys left undefined are gone. */
function passJson(pass: PassConfig, create: CreateConfig = CREATE): Json {
	return JSON.parse(
		JSON.stringify(buildPassJson(pass, create, UNSIGNED_APPLE_CREDENTIALS))
	);
}

function loyalty(overrides: Partial<LoyaltyPass> = {}): LoyaltyPass {
	return {
		type: "loyalty",
		id: "p1",
		name: "Acme Rewards",
		fields: [],
		...overrides,
	};
}

/** Apple files loyalty field slots under storeCard. */
function storeCard(pass: LoyaltyPass, create?: CreateConfig): SlotsJson {
	return passJson(pass, create).storeCard as SlotsJson;
}

function event(overrides: Partial<EventPass> = {}): EventPass {
	return {
		type: "event",
		id: "e1",
		name: "Show",
		startsAt: "2026-07-15T20:00:00Z",
		fields: [],
		...overrides,
	};
}

const FLIGHT: FlightPass = {
	type: "flight",
	id: "f1",
	name: "AA 100",
	transitType: "air",
	carrier: "AA",
	flightNumber: "100",
	origin: "JFK",
	destination: "LAX",
	departure: "2026-07-15T08:00:00Z",
	arrival: "2026-07-15T11:30:00Z",
	fields: [],
};

const PASS_JSON: Record<FixtureName, Json> = {
	// storeCard is Apple's loyalty layout — there is no dedicated loyalty type.
	loyalty: {
		formatVersion: 1,
		passTypeIdentifier: PASS_TYPE_IDENTIFIER,
		serialNumber: "loyalty-001",
		teamIdentifier: TEAM_ID,
		organizationName: "Acme Rewards",
		description: "Acme loyalty card",
		logoText: "Acme",
		// Apple's colour keys take CSS rgb() triplets, never hex.
		backgroundColor: "rgb(26, 26, 46)",
		foregroundColor: "rgb(255, 255, 255)",
		labelColor: "rgb(204, 204, 204)",
		// `barcodes` is the modern key; `barcode` is the deprecated singular
		// fallback older OS versions read, emitted only for QR/PDF417/Aztec.
		barcodes: [
			{
				message: "LOY-1250",
				format: "PKBarcodeFormatQR",
				messageEncoding: "utf-8",
			},
		],
		barcode: {
			message: "LOY-1250",
			format: "PKBarcodeFormatQR",
			messageEncoding: "utf-8",
		},
		storeCard: {
			headerFields: [],
			primaryFields: [{ key: "points", label: "Points", value: "1250" }],
			secondaryFields: [{ key: "tier", label: "Tier", value: "Gold" }],
			auxiliaryFields: [],
			backFields: [
				{ key: "member", label: "Member", value: "Jane Doe" },
				{
					key: "terms",
					label: "Terms",
					value: "No refunds.",
					dataDetectorTypes: [],
				},
			],
		},
	},

	// Poster tickets use eventLogoText; Apple ignores logoText for this style.
	event: {
		formatVersion: 1,
		passTypeIdentifier: PASS_TYPE_IDENTIFIER,
		serialNumber: "event-001",
		teamIdentifier: TEAM_ID,
		organizationName: "Summer Festival",
		description: "Summer Festival",
		backgroundColor: "rgb(106, 5, 114)",
		// PDF417 is not UTF-8 safe — Apple documents iso-8859-1 for it.
		barcodes: [
			{
				message: "EVT-1",
				format: "PKBarcodeFormatPDF417",
				messageEncoding: "iso-8859-1",
			},
		],
		barcode: {
			message: "EVT-1",
			format: "PKBarcodeFormatPDF417",
			messageEncoding: "iso-8859-1",
		},
		relevantDates: [
			{ startDate: "2026-07-15T20:00:00Z", endDate: "2026-07-15T23:00:00Z" },
		],
		eventLogoText: "Festival",
		footerBackgroundColor: "rgb(18, 52, 86)",
		preferredStyleSchemes: ["posterEventTicket"],
		bagPolicyURL: "https://example.com/bags",
		// The venue and seat tags come from the fields, not from pass.venue.
		semantics: {
			eventName: "Summer Festival",
			eventStartDate: "2026-07-15T20:00:00Z",
			eventEndDate: "2026-07-15T23:00:00Z",
			venueName: "Central Park",
			seats: [{ seatNumber: "A12", seatRow: "12", seatSection: "A" }],
		},
		eventTicket: {
			headerFields: [],
			primaryFields: [{ key: "venue", label: "Venue", value: "Central Park" }],
			secondaryFields: [],
			// `row` is an auxiliary-only key on event tickets.
			auxiliaryFields: [
				{ key: "seat", label: "Seat", value: "A12", row: 0 },
				{ key: "row", label: "Row", value: "12", row: 1 },
				{ key: "section", label: "Section", value: "A" },
				{ key: "gate", label: "Gate", value: "3" },
			],
			backFields: [],
		},
	},

	// boardingPass — transitType is required and lives inside the pass-type
	// dictionary, not at the top level.
	flight: {
		formatVersion: 1,
		passTypeIdentifier: PASS_TYPE_IDENTIFIER,
		serialNumber: "flight-001",
		teamIdentifier: TEAM_ID,
		organizationName: "AA 100",
		description: "AA 100",
		backgroundColor: "rgb(0, 48, 135)",
		barcodes: [
			{
				message: "BP-1",
				format: "PKBarcodeFormatAztec",
				messageEncoding: "utf-8",
			},
		],
		barcode: {
			message: "BP-1",
			format: "PKBarcodeFormatAztec",
			messageEncoding: "utf-8",
		},
		relevantDates: [
			{ startDate: "2026-07-15T08:00:00Z", endDate: "2026-07-15T11:30:00Z" },
		],
		upgradeURL: "https://example.com/upgrade",
		// flightNumber is numeric; flightCode includes the carrier.
		semantics: {
			airlineCode: "AA",
			flightCode: "AA100",
			flightNumber: 100,
			departureAirportCode: "JFK",
			destinationAirportCode: "LAX",
			originalDepartureDate: "2026-07-15T08:00:00Z",
			originalArrivalDate: "2026-07-15T11:30:00Z",
			departureGate: "B22",
			departureTerminal: "4",
			seats: [{ seatNumber: "14A" }],
		},
		boardingPass: {
			headerFields: [],
			primaryFields: [{ key: "gate", label: "Gate", value: "B22" }],
			// passengerName has no template value; it comes from create.values.
			secondaryFields: [
				{ key: "passengerName", label: "Passenger", value: "Jane Doe" },
				{ key: "seat", label: "Seat", value: "14A" },
			],
			auxiliaryFields: [{ key: "terminal", label: "Terminal", value: "4" }],
			backFields: [],
			transitType: "PKTransitTypeAir",
		},
	},

	// Rail shares the boardingPass layout. Without a carrier or flight number
	// there are no airline tags; the origin/destination and times still map,
	// and a UTC offset is kept as given.
	transit: {
		formatVersion: 1,
		passTypeIdentifier: PASS_TYPE_IDENTIFIER,
		serialNumber: "transit-001",
		teamIdentifier: TEAM_ID,
		organizationName: "Northern Line",
		description: "Northern Line",
		backgroundColor: "rgb(198, 12, 48)",
		relevantDates: [
			{
				startDate: "2026-07-15T08:00:00+01:00",
				endDate: "2026-07-15T09:45:00+01:00",
			},
		],
		semantics: {
			departureAirportCode: "PAD",
			destinationAirportCode: "BRI",
			originalDepartureDate: "2026-07-15T08:00:00+01:00",
			originalArrivalDate: "2026-07-15T09:45:00+01:00",
		},
		boardingPass: {
			headerFields: [],
			primaryFields: [{ key: "platform", label: "Platform", value: "4" }],
			secondaryFields: [
				{ key: "passengerName", label: "Passenger", value: "Jane Doe" },
			],
			auxiliaryFields: [],
			backFields: [],
			transitType: "PKTransitTypeTrain",
		},
	},

	coupon: {
		formatVersion: 1,
		passTypeIdentifier: PASS_TYPE_IDENTIFIER,
		serialNumber: "coupon-001",
		teamIdentifier: TEAM_ID,
		organizationName: "20% Off",
		description: "20% Off",
		backgroundColor: "rgb(230, 57, 70)",
		expirationDate: "2026-12-31T23:59:59Z",
		coupon: {
			headerFields: [],
			primaryFields: [{ key: "offer", label: "Offer", value: "20% off" }],
			secondaryFields: [{ key: "code", label: "Code", value: "SUMMER20" }],
			auxiliaryFields: [],
			backFields: [],
		},
	},

	// Apple has no gift-card layout — it shares storeCard with loyalty. The
	// currency is expressed per field, via currencyCode + numberStyle.
	giftCard: {
		formatVersion: 1,
		passTypeIdentifier: PASS_TYPE_IDENTIFIER,
		serialNumber: "gift-001",
		teamIdentifier: TEAM_ID,
		organizationName: "Store Gift Card",
		description: "Store Gift Card",
		backgroundColor: "rgb(42, 157, 143)",
		storeCard: {
			headerFields: [],
			primaryFields: [
				{
					key: "balance",
					label: "Balance",
					value: "50.00",
					numberStyle: "PKNumberStyleDecimal",
					currencyCode: "USD",
				},
			],
			secondaryFields: [
				{
					key: "issued",
					label: "Issued",
					value: "2026-01-15T00:00:00Z",
					dateStyle: "PKDateStyleMedium",
					timeStyle: "PKDateStyleNone",
					textAlignment: "PKTextAlignmentRight",
				},
			],
			auxiliaryFields: [],
			backFields: [{ key: "pin", label: "PIN", value: "1234" }],
		},
	},

	generic: {
		formatVersion: 1,
		passTypeIdentifier: PASS_TYPE_IDENTIFIER,
		serialNumber: "generic-001",
		teamIdentifier: TEAM_ID,
		organizationName: "Member Card",
		description: "Member Card",
		backgroundColor: "rgb(38, 70, 83)",
		sharingProhibited: true,
		// requiresAuthentication is omitted when unset rather than defaulted.
		nfc: { message: "hello", encryptionPublicKey: "KEY" },
		generic: {
			headerFields: [],
			primaryFields: [{ key: "mid", label: "Member ID", value: "M-98765" }],
			secondaryFields: [{ key: "name", label: "Name", value: "Jane Doe" }],
			auxiliaryFields: [],
			backFields: [],
		},
	},
};

describe.each(Object.keys(PASS_JSON) as FixtureName[])("%s fixture", (name) => {
	it("emits exactly the expected pass.json", () => {
		const { pass, create } = FIXTURES[name];
		expect(passJson(pass, create)).toEqual(PASS_JSON[name]);
	});
});

describe("bare pass", () => {
	it("emits only the required keys — no defaulted colour, logoText, barcode or semantics", () => {
		expect(passJson(loyalty())).toEqual({
			formatVersion: 1,
			passTypeIdentifier: PASS_TYPE_IDENTIFIER,
			serialNumber: "s1",
			teamIdentifier: TEAM_ID,
			organizationName: "Acme Rewards",
			description: "Acme Rewards",
			storeCard: {
				headerFields: [],
				primaryFields: [],
				secondaryFields: [],
				auxiliaryFields: [],
				backFields: [],
			},
		});
	});
});

describe("barcodes", () => {
	it("emits every barcodes entry, ignores the singular input, and mirrors the first legacy-legal one", () => {
		const json = passJson(loyalty(), {
			...CREATE,
			barcode: { value: "OLD", format: "QR" },
			barcodes: [
				{ value: "12345", format: "EAN13" },
				{ value: "NEW", format: "QR" },
			],
		});
		expect(json.barcodes).toEqual([
			{
				message: "12345",
				format: "PKBarcodeFormatEAN13",
				messageEncoding: "iso-8859-1",
			},
			{ message: "NEW", format: "PKBarcodeFormatQR", messageEncoding: "utf-8" },
		]);
		expect(json.barcode).toEqual({
			message: "NEW",
			format: "PKBarcodeFormatQR",
			messageEncoding: "utf-8",
		});
	});

	it("omits the singular barcode when no entry is legal there", () => {
		const json = passJson(loyalty(), {
			...CREATE,
			barcode: { value: "ABC", format: "Code128" },
		});
		expect(json.barcodes).toEqual([
			{
				message: "ABC",
				format: "PKBarcodeFormatCode128",
				messageEncoding: "iso-8859-1",
			},
		]);
		expect(json).not.toHaveProperty("barcode");
	});
});

describe("field slots", () => {
	it("files each field under its slot array, omitting label when the field has none", () => {
		const card = storeCard(
			loyalty({
				fields: [
					{ slot: "header", key: "tier", value: "Gold" },
					{ slot: "primary", key: "points", value: "500" },
					{ slot: "secondary", key: "member", value: "Jane" },
					{ slot: "auxiliary", key: "level", value: "3" },
					{ slot: "back", key: "terms", value: "No refunds." },
				],
			})
		);
		expect(card).toEqual({
			headerFields: [{ key: "tier", value: "Gold" }],
			primaryFields: [{ key: "points", value: "500" }],
			secondaryFields: [{ key: "member", value: "Jane" }],
			auxiliaryFields: [{ key: "level", value: "3" }],
			backFields: [{ key: "terms", value: "No refunds." }],
		});
	});

	it("takes per-recipient values over the template value and hides a field set to null", () => {
		const card = storeCard(
			loyalty({
				fields: [
					{ slot: "primary", key: "points", label: "Points", value: "0" },
					{ slot: "secondary", key: "tier", label: "Tier", value: "Gold" },
				],
			}),
			{ ...CREATE, values: { points: "750", tier: null } }
		);
		expect(card.primaryFields).toEqual([
			{ key: "points", label: "Points", value: "750" },
		]);
		expect(card.secondaryFields).toEqual([]);
	});
});

describe("field content", () => {
	it("keeps explicit false for ignoresTimeZone and isRelative", () => {
		const card = storeCard(
			loyalty({
				fields: [
					{
						slot: "secondary",
						key: "expires",
						label: "Expires",
						value: "2024-06-01T20:00:00Z",
						dateStyle: "short",
						attributedValue: '<a href="https://example.com">Renew</a>',
						ignoresTimeZone: false,
						isRelative: false,
					},
				],
			})
		);
		expect(card.secondaryFields.at(0)).toEqual({
			key: "expires",
			label: "Expires",
			value: "2024-06-01T20:00:00Z",
			dateStyle: "PKDateStyleShort",
			attributedValue: '<a href="https://example.com">Renew</a>',
			ignoresTimeZone: false,
			isRelative: false,
		});
	});

	it("emits dataDetectorTypes on back fields only, keeping [] to disable detectors", () => {
		const card = storeCard(
			loyalty({
				fields: [
					{
						slot: "back",
						key: "contact",
						label: "Contact",
						value: "Call 555-0100",
						dataDetectorTypes: ["phoneNumber", "link"],
					},
					{
						slot: "back",
						key: "terms",
						label: "Terms",
						value: "See example.com",
						dataDetectorTypes: [],
					},
					{
						slot: "secondary",
						key: "phone",
						label: "Phone",
						value: "555-0100",
						dataDetectorTypes: ["phoneNumber"],
					},
				],
			})
		);
		expect(card.backFields.map((f) => f.dataDetectorTypes)).toEqual([
			["PKDataDetectorTypePhoneNumber", "PKDataDetectorTypeLink"],
			[],
		]);
		expect(card.secondaryFields.at(0)).not.toHaveProperty("dataDetectorTypes");
	});

	it("drops textAlignment on primary and back fields", () => {
		const card = storeCard(
			loyalty({
				fields: [
					{ slot: "primary", key: "a", value: "1", textAlignment: "right" },
					{ slot: "secondary", key: "b", value: "2", textAlignment: "right" },
					{ slot: "back", key: "c", value: "3", textAlignment: "right" },
				],
			})
		);
		expect(card.primaryFields.at(0)).not.toHaveProperty("textAlignment");
		expect(card.secondaryFields.at(0)).toMatchObject({
			textAlignment: "PKTextAlignmentRight",
		});
		expect(card.backFields.at(0)).not.toHaveProperty("textAlignment");
	});

	it("keeps row on auxiliary fields only", () => {
		const card = storeCard(
			loyalty({
				fields: [
					{ slot: "auxiliary", key: "seat", value: "A12", row: 1 },
					{ slot: "secondary", key: "gate", value: "3", row: 1 },
				],
			})
		);
		expect(card.auxiliaryFields.at(0)).toMatchObject({ row: 1 });
		expect(card.secondaryFields.at(0)).not.toHaveProperty("row");
	});
});

describe("pass-level keys", () => {
	it("keeps logoText on a plain event ticket but drops it once the ticket is a poster", () => {
		const logoText = "Ignored on posters";
		expect(passJson(event({ apple: { logoText } })).logoText).toBe(logoText);
		expect(
			passJson(event({ apple: { logoText, eventLogoText: "Festival" } }))
		).not.toHaveProperty("logoText");
		expect(
			passJson(
				event({
					apple: { logoText, preferredStyleSchemes: ["posterEventTicket"] },
				})
			)
		).not.toHaveProperty("logoText");
	});

	it("emits nfc with requiresAuthentication only when it is set", () => {
		const nfc = { message: "tap-payload", encryptionPublicKey: "BASE64KEY" };
		expect(passJson(loyalty({ apple: { nfc } })).nfc).toEqual(nfc);
		expect(
			passJson(
				loyalty({ apple: { nfc: { ...nfc, requiresAuthentication: true } } })
			).nfc
		).toEqual({ ...nfc, requiresAuthentication: true });
	});

	it.each([
		["train", "PKTransitTypeTrain"],
		["bus", "PKTransitTypeBus"],
		["boat", "PKTransitTypeBoat"],
		["generic", "PKTransitTypeGeneric"],
	] as const)("maps transitType %s to %s inside boardingPass", (transitType, constant) => {
		const boardingPass = passJson({ ...FLIGHT, transitType })
			.boardingPass as SlotsJson;
		expect(boardingPass.transitType).toBe(constant);
	});
});

describe("semantics and relevantDates", () => {
	it("emits user semantics on a pass with no derived tags", () => {
		const semantics = {
			balance: { amount: "25.00", currencyCode: "USD" },
			membershipProgramName: "Acme Rewards",
		};
		expect(passJson(loyalty({ apple: { semantics } })).semantics).toEqual(
			semantics
		);
	});

	it("merges user semantics over the derived flight tags — the user wins", () => {
		const json = passJson({
			...FLIGHT,
			apple: { semantics: { airlineCode: "ZZ", silenceRequested: true } },
		});
		expect(json.semantics).toEqual({
			airlineCode: "ZZ",
			silenceRequested: true,
			flightCode: "AA100",
			flightNumber: 100,
			departureAirportCode: "JFK",
			destinationAirportCode: "LAX",
			originalDepartureDate: "2026-07-15T08:00:00Z",
			originalArrivalDate: "2026-07-15T11:30:00Z",
		});
	});

	it("keeps a letter suffix in flightCode but takes only the digits for flightNumber", () => {
		expect(
			passJson({ ...FLIGHT, flightNumber: "1234A" }).semantics
		).toMatchObject({ flightCode: "AA1234A", flightNumber: 1234 });
	});

	it("derives boardingGroup from a boardingZone or boardingGroup field", () => {
		const zone = passJson({
			...FLIGHT,
			fields: [
				{ slot: "auxiliary", key: "boardingZone", label: "Zone", value: "2" },
			],
		});
		const group = passJson({
			...FLIGHT,
			fields: [
				{ slot: "auxiliary", key: "boardingGroup", label: "Group", value: "B" },
			],
		});
		expect(zone.semantics).toMatchObject({ boardingGroup: "2" });
		expect(group.semantics).toMatchObject({ boardingGroup: "B" });
	});

	it("lets explicit apple.relevantDates override the dates derived from the event", () => {
		const json = passJson(
			event({
				endsAt: "2026-07-15T23:00:00Z",
				apple: { relevantDates: [{ date: "2026-07-14T20:00:00Z" }] },
			})
		);
		expect(json.relevantDates).toEqual([{ date: "2026-07-14T20:00:00Z" }]);
	});

	it("emits a single-moment relevantDate when only the start time is known", () => {
		expect(passJson(event()).relevantDates).toEqual([
			{ date: "2026-07-15T20:00:00Z" },
		]);
		expect(passJson({ ...FLIGHT, arrival: undefined }).relevantDates).toEqual([
			{ date: "2026-07-15T08:00:00Z" },
		]);
	});
});

describe("validateAppleRequirements", () => {
	it.each<[string, PassConfig]>([
		["APPLE_MISSING_ICON", loyalty()],
		[
			"APPLE_BOARDING_MISSING_TRANSIT_TYPE",
			{
				type: "flight",
				id: "f1",
				name: "Flight",
				fields: [],
				apple: { icon: ICON },
			},
		],
		[
			"APPLE_MISSING_AUTH_TOKEN",
			loyalty({
				apple: { icon: ICON, webServiceURL: "https://example.com/passes" },
			}),
		],
		[
			"APPLE_APP_LAUNCH_URL_REQUIRES_STORE_IDS",
			loyalty({
				apple: { icon: ICON, appLaunchURL: "https://example.com/app" },
			}),
		],
	])("throws %s", (code, pass) => {
		expect(() => validateAppleRequirements(pass)).toThrow(
			expect.objectContaining({ code })
		);
	});
});
