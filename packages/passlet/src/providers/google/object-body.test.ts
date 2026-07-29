import { generateKeyPairSync } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { GoogleCredentials } from "../../types/credentials";
import { generateGooglePass, updateGooglePass } from "./index";

// ─── Setup ────────────────────────────────────────────────────────────────────

let credentials: GoogleCredentials;

beforeAll(() => {
	const { privateKey } = generateKeyPairSync("rsa", {
		modulusLength: 2048,
		privateKeyEncoding: { type: "pkcs8", format: "pem" },
		publicKeyEncoding: { type: "spki", format: "pem" },
	});
	credentials = {
		issuerId: "3388000000022801234",
		clientEmail: "test@test-project.iam.gserviceaccount.com",
		privateKey: privateKey as string,
	};
});

afterEach(() => {
	vi.unstubAllGlobals?.();
	vi.restoreAllMocks();
});

// Stub fetch: OAuth token → fake token; GET class → 404 so the POST path is taken.
function stubFetch() {
	vi.stubGlobal(
		"fetch",
		vi.fn().mockImplementation((url: string, init?: RequestInit) => {
			if (url.includes("oauth2.googleapis.com")) {
				return Promise.resolve({
					ok: true,
					json: () => Promise.resolve({ access_token: "test-token" }),
				});
			}
			if (
				url.includes("walletobjects.googleapis.com") &&
				(!init?.method || init.method === "GET")
			) {
				return Promise.resolve({
					ok: false,
					status: 404,
					body: null,
					text: () => Promise.resolve(""),
				});
			}
			return Promise.resolve({
				ok: true,
				status: 201,
				body: null,
				text: () => Promise.resolve(""),
			});
		})
	);
}

async function run(
	passConfig: Parameters<typeof generateGooglePass>[0],
	createConfig: Parameters<typeof generateGooglePass>[1]
) {
	stubFetch();
	const { pass, warnings } = await generateGooglePass(
		passConfig,
		createConfig,
		credentials
	);
	if (!pass) {
		throw new Error("expected a JWT");
	}
	return { pass, warnings };
}

/** Body sent in the POST that creates the class. */
function captureClassBody(classType: string): Record<string, unknown> {
	const calls = vi.mocked(globalThis.fetch).mock.calls;
	const call = calls.find(
		([url, init]) =>
			typeof url === "string" &&
			url.includes(`/${classType}`) &&
			init?.method === "POST"
	);
	if (!call?.[1]?.body) {
		throw new Error(`no POST body found for ${classType}`);
	}
	return JSON.parse(call[1].body as string) as Record<string, unknown>;
}

/** Object body embedded in the JWT payload. */
function decodeObjectBody(
	jwt: string,
	objectsKey: string
): Record<string, unknown> {
	const [, segment] = jwt.split(".");
	if (!segment) {
		throw new Error("invalid JWT");
	}
	const padded = segment.replace(/-/g, "+").replace(/_/g, "/");
	const outer = JSON.parse(
		Buffer.from(padded, "base64").toString("utf-8")
	) as Record<string, unknown>;
	const inner = (outer.payload as Record<string, unknown>)[
		objectsKey
	] as Record<string, unknown>[];
	const obj = inner[0];
	if (!obj) {
		throw new Error(`no object found for key ${objectsKey}`);
	}
	return obj;
}

/** URL and parsed body of the PATCH request sent by updateGooglePass. */
function capturePatch(): { url: string; body: Record<string, unknown> } {
	const call = vi
		.mocked(globalThis.fetch)
		.mock.calls.find(([, init]) => init?.method === "PATCH");
	if (!call?.[1]?.body) {
		throw new Error("no PATCH request found");
	}
	return {
		url: call[0] as string,
		body: JSON.parse(call[1].body as string) as Record<string, unknown>,
	};
}

/** Decode the outer JWT claims (iss, aud, typ, origins, payload). */
function decodeJwtClaims(jwt: string): Record<string, unknown> {
	const [, segment] = jwt.split(".");
	if (!segment) {
		throw new Error("invalid JWT");
	}
	const padded = segment.replace(/-/g, "+").replace(/_/g, "/");
	return JSON.parse(Buffer.from(padded, "base64").toString("utf-8")) as Record<
		string,
		unknown
	>;
}

const ISSUER = "3388000000022801234";

describe("JWT origins", () => {
	const base = {
		type: "loyalty" as const,
		id: "p1",
		name: "Card",
		google: { logo: "https://example.com/logo.png" },
		fields: [],
	};

	it("includes origins when set on credentials", async () => {
		stubFetch();
		const { pass } = await generateGooglePass(
			base,
			{ serialNumber: "s1" },
			{ ...credentials, origins: ["https://example.com"] }
		);
		if (!pass) {
			throw new Error("expected a JWT");
		}
		expect(decodeJwtClaims(pass).origins).toEqual(["https://example.com"]);
	});

	it("omits origins when not set", async () => {
		const { pass } = await run(base, { serialNumber: "s2" });
		expect(decodeJwtClaims(pass).origins).toBeUndefined();
	});
});

// ─── Complete pass fixtures ───────────────────────────────────────────────────
//
// Each test generates a complete pass and compares the full class body (the POST
// sent to the Google Wallet API) and the full object body (the JWT payload entry)
// against expected fixtures.
//
// These fixtures are the source of truth. If Google requires a field, it must be
// here — and if the code stops producing it, the test will catch it.

describe("loyalty pass", () => {
	it("produces the correct class and object bodies", async () => {
		const { pass } = await run(
			{
				type: "loyalty",
				id: "test-loyalty",
				name: "Rewards Card",
				color: "#1a1a2e",
				google: { logo: "https://example.com/logo.png" },
				fields: [
					{ slot: "primary", key: "points", label: "Points", value: "1250" },
					{ slot: "secondary", key: "tier", label: "Tier", value: "Gold" },
					{ slot: "back", key: "member", label: "Member", value: "Jane Doe" },
				],
			},
			{ serialNumber: "loyalty-001" }
		);

		expect(captureClassBody("loyaltyClass")).toEqual({
			id: `${ISSUER}.test-loyalty`,
			programName: "Rewards Card",
			hexBackgroundColor: "#1a1a2e",
			issuerName: "Rewards Card",
			programLogo: {
				sourceUri: {
					uri: "https://example.com/logo.png",
				},
			},
			reviewStatus: "UNDER_REVIEW",
		});

		expect(decodeObjectBody(pass, "loyaltyObjects")).toEqual({
			id: `${ISSUER}.loyalty-001`,
			classId: `${ISSUER}.test-loyalty`,
			state: "ACTIVE",
			loyaltyPoints: { balance: { string: "1250" } },
			accountName: "Jane Doe",
			subheader: { defaultValue: { language: "en-US", value: "Points" } },
			header: { defaultValue: { language: "en-US", value: "1250" } },
			// "member" maps to the structured accountName, so it is kept out of
			// textModulesData even though it sits in the back slot
			textModulesData: [{ header: "Tier", body: "Gold", id: "tier" }],
		});
	});

	it("emits back fields as textModulesData, not the deprecated infoModuleData", async () => {
		const { pass } = await run(
			{
				type: "loyalty",
				id: "p1",
				name: "Rewards",
				google: { logo: "https://example.com/logo.png" },
				fields: [
					{ slot: "secondary", key: "tier", label: "Tier", value: "Gold" },
					{ slot: "back", key: "terms", label: "Terms", value: "No refunds." },
				],
			},
			{ serialNumber: "s1" }
		);

		const obj = decodeObjectBody(pass, "loyaltyObjects");
		expect(obj.infoModuleData).toBeUndefined();
		// back fields are merged into textModulesData, keyed by the field key
		expect(obj.textModulesData).toEqual([
			{ header: "Tier", body: "Gold", id: "tier" },
			{ header: "Terms", body: "No refunds.", id: "terms" },
		]);
	});

	it("uses createConfig.values to override field values", async () => {
		const { pass } = await run(
			{
				type: "loyalty",
				id: "p1",
				name: "Rewards",
				google: { logo: "https://example.com/logo.png" },
				fields: [
					{ slot: "primary", key: "points", label: "Points", value: "0" },
					{ slot: "secondary", key: "tier", label: "Tier", value: "Bronze" },
				],
			},
			{ serialNumber: "s1", values: { points: "1500", tier: "Platinum" } }
		);

		const obj = decodeObjectBody(pass, "loyaltyObjects");
		expect((obj.header as Record<string, unknown>).defaultValue).toMatchObject({
			value: "1500",
		});
		const firstModule = (obj.textModulesData as Record<string, unknown>[])[0];
		if (!firstModule) {
			throw new Error("no textModulesData");
		}
		expect(firstModule.body).toBe("Platinum");
	});

	it("omits fields whose value is null in createConfig.values", async () => {
		const { pass } = await run(
			{
				type: "loyalty",
				id: "p1",
				name: "Rewards",
				google: { logo: "https://example.com/logo.png" },
				fields: [
					{ slot: "secondary", key: "tier", label: "Tier", value: "Gold" },
				],
			},
			{ serialNumber: "s1", values: { tier: null } }
		);

		const obj = decodeObjectBody(pass, "loyaltyObjects");
		expect(obj.textModulesData).toBeUndefined();
	});

	// Apple documents label as optional, so Google needs a header fallback
	it("falls back to the field key when a field has no label", async () => {
		const { pass } = await run(
			{
				type: "loyalty",
				id: "p1",
				name: "Rewards",
				google: { logo: "https://example.com/logo.png" },
				fields: [
					{ slot: "primary", key: "points", value: "1250" },
					{ slot: "secondary", key: "tier", value: "Gold" },
				],
			},
			{ serialNumber: "s1" }
		);

		const obj = decodeObjectBody(pass, "loyaltyObjects");
		expect(obj.textModulesData).toEqual([
			{ header: "tier", body: "Gold", id: "tier" },
		]);
		expect(obj.subheader).toEqual({
			defaultValue: { language: "en-US", value: "points" },
		});
	});

	it("uses the first entry of createConfig.barcodes", async () => {
		const { pass } = await run(
			{
				type: "loyalty",
				id: "p1",
				name: "Rewards",
				google: { logo: "https://example.com/logo.png" },
				fields: [],
			},
			{
				serialNumber: "s1",
				barcodes: [
					{ value: "12345", format: "EAN13" },
					{ value: "ABC-123", format: "QR" },
				],
			}
		);

		const obj = decodeObjectBody(pass, "loyaltyObjects");
		expect(obj.barcode).toEqual({ type: "EAN_13", value: "12345" });
	});
});

describe("event pass", () => {
	it("produces the correct class and object bodies", async () => {
		const { pass } = await run(
			{
				type: "event",
				id: "test-event",
				name: "Summer Festival",
				color: "#6a0572",
				startsAt: "2026-07-15T20:00:00Z",
				endsAt: "2026-07-15T23:00:00Z",
				fields: [
					{
						slot: "primary",
						key: "venue",
						label: "Venue",
						value: "Central Park",
					},
					{
						slot: "secondary",
						key: "date",
						label: "Date",
						value: "Jul 15, 2026",
					},
					{ slot: "auxiliary", key: "seat", label: "Seat", value: "A12" },
				],
			},
			{ serialNumber: "event-001" }
		);

		expect(captureClassBody("eventTicketClass")).toEqual({
			id: `${ISSUER}.test-event`,
			eventName: {
				defaultValue: { language: "en-US", value: "Summer Festival" },
			},
			// EventDateTime accepts an offset and Google uses it to resolve the
			// instant — the original string is forwarded verbatim
			dateTime: {
				start: "2026-07-15T20:00:00Z",
				end: "2026-07-15T23:00:00Z",
			},
			hexBackgroundColor: "#6a0572",
			issuerName: "Summer Festival",
			reviewStatus: "UNDER_REVIEW",
		});

		expect(decodeObjectBody(pass, "eventTicketObjects")).toEqual({
			id: `${ISSUER}.event-001`,
			classId: `${ISSUER}.test-event`,
			state: "ACTIVE",
			// seat is rendered as structured seatInfo, not a text module
			seatInfo: {
				seat: { defaultValue: { language: "en-US", value: "A12" } },
			},
			subheader: { defaultValue: { language: "en-US", value: "Venue" } },
			header: { defaultValue: { language: "en-US", value: "Central Park" } },
			textModulesData: [{ header: "Date", body: "Jul 15, 2026", id: "date" }],
		});
	});

	it("forwards a UTC offset on event datetimes (EventDateTime accepts one)", async () => {
		await run(
			{
				type: "event",
				id: "e3",
				name: "Show",
				startsAt: "2026-07-15T20:00:00-04:00",
				endsAt: "2026-07-15T23:00:00-04:00",
				fields: [],
			},
			{ serialNumber: "event-003" }
		);

		expect(captureClassBody("eventTicketClass").dateTime).toEqual({
			start: "2026-07-15T20:00:00-04:00",
			end: "2026-07-15T23:00:00-04:00",
		});
	});

	it("maps seat/row/section/gate to seatInfo and venue to the class", async () => {
		const { pass } = await run(
			{
				type: "event",
				id: "e2",
				name: "Show",
				startsAt: "2026-07-15T20:00:00Z",
				venue: { name: "Arena", address: "1 Main St" },
				fields: [
					{ slot: "auxiliary", key: "section", label: "Section", value: "A" },
					{ slot: "auxiliary", key: "row", label: "Row", value: "12" },
					{ slot: "auxiliary", key: "seat", label: "Seat", value: "5" },
					{ slot: "auxiliary", key: "gate", label: "Gate", value: "3" },
				],
			},
			{ serialNumber: "event-002" }
		);

		const cls = captureClassBody("eventTicketClass");
		expect(cls.venue).toEqual({
			name: { defaultValue: { language: "en-US", value: "Arena" } },
			address: { defaultValue: { language: "en-US", value: "1 Main St" } },
		});

		const obj = decodeObjectBody(pass, "eventTicketObjects");
		expect(obj.seatInfo).toEqual({
			seat: { defaultValue: { language: "en-US", value: "5" } },
			row: { defaultValue: { language: "en-US", value: "12" } },
			section: { defaultValue: { language: "en-US", value: "A" } },
			gate: { defaultValue: { language: "en-US", value: "3" } },
		});
		// none of the structured keys leak into textModulesData
		expect(obj.textModulesData).toBeUndefined();
	});
});

describe("flight pass", () => {
	it("produces the correct class and object bodies", async () => {
		const { pass } = await run(
			{
				type: "flight",
				id: "test-flight",
				name: "AA 100",
				color: "#003087",
				carrier: "AA",
				flightNumber: "100",
				origin: "JFK",
				destination: "LAX",
				departure: "2026-07-15T08:00:00Z",
				arrival: "2026-07-15T11:30:00Z",
				fields: [
					{ slot: "primary", key: "gate", label: "Gate", value: "B22" },
					{ slot: "secondary", key: "seat", label: "Seat", value: "14A" },
				],
			},
			{ serialNumber: "flight-001", values: { passengerName: "Jane Doe" } }
		);

		expect(captureClassBody("flightClass")).toEqual({
			id: `${ISSUER}.test-flight`,
			flightHeader: {
				carrier: { carrierIataCode: "AA" },
				flightNumber: "100",
				operatingCarrier: { carrierIataCode: "AA" },
				operatingFlightNumber: "100",
			},
			localScheduledDepartureDateTime: "2026-07-15T08:00:00",
			// arrival time is a top-level flightClass field; destination AirportInfo
			// only carries airport data
			localScheduledArrivalDateTime: "2026-07-15T11:30:00",
			origin: { airportIataCode: "JFK" },
			destination: { airportIataCode: "LAX" },
			hexBackgroundColor: "#003087",
			issuerName: "AA 100",
			reviewStatus: "UNDER_REVIEW",
		});

		expect(decodeObjectBody(pass, "flightObjects")).toEqual({
			id: `${ISSUER}.flight-001`,
			classId: `${ISSUER}.test-flight`,
			state: "ACTIVE",
			passengerName: "Jane Doe",
			reservationInfo: { confirmationCode: "flight-001" },
			subheader: { defaultValue: { language: "en-US", value: "Gate" } },
			header: { defaultValue: { language: "en-US", value: "B22" } },
			textModulesData: [{ header: "Seat", body: "14A", id: "seat" }],
		});
	});

	it("throws when passengerName is missing (required by flightObject)", async () => {
		await expect(
			run(
				{
					type: "flight",
					id: "p1",
					name: "Flight",
					fields: [],
					carrier: "AA",
					flightNumber: "100",
					origin: "JFK",
					destination: "LAX",
					departure: "2026-07-15T08:00:00Z",
				},
				{ serialNumber: "s1" }
			)
		).rejects.toMatchObject({ code: "GOOGLE_FLIGHT_MISSING_PASSENGER_NAME" });
	});

	it("strips a UTC offset from flight datetimes (Google derives the zone)", async () => {
		await run(
			{
				type: "flight",
				id: "p1",
				name: "Flight",
				fields: [],
				carrier: "AA",
				flightNumber: "100",
				origin: "JFK",
				destination: "LAX",
				departure: "2026-07-15T08:00:00+04:00",
				arrival: "2026-07-15T11:30:00+04:00",
			},
			{ serialNumber: "s1", values: { passengerName: "Jane" } }
		);
		const cls = captureClassBody("flightClass");
		expect(cls.localScheduledDepartureDateTime).toBe("2026-07-15T08:00:00");
		expect(cls.localScheduledArrivalDateTime).toBe("2026-07-15T11:30:00");
	});

	it("throws when departure is missing (required by flightClass)", async () => {
		await expect(
			run(
				{
					type: "flight",
					id: "p1",
					name: "Flight",
					fields: [],
					carrier: "AA",
					flightNumber: "100",
					origin: "JFK",
					destination: "LAX",
				},
				{ serialNumber: "s1" }
			)
		).rejects.toMatchObject({ code: "GOOGLE_FLIGHT_MISSING_CLASS_FIELDS" });
	});
});

describe("coupon pass", () => {
	it("produces the correct class and object bodies", async () => {
		const { pass } = await run(
			{
				type: "coupon",
				id: "test-coupon",
				name: "20% Off",
				color: "#e63946",
				redemptionChannel: "both",
				fields: [
					{
						slot: "primary",
						key: "offer",
						label: "Offer",
						value: "20% off your next order",
					},
					{ slot: "secondary", key: "code", label: "Code", value: "SUMMER20" },
					{
						slot: "back",
						key: "expires",
						label: "Expires",
						value: "Dec 31, 2026",
					},
				],
			},
			{ serialNumber: "coupon-001" }
		);

		expect(captureClassBody("offerClass")).toEqual({
			id: `${ISSUER}.test-coupon`,
			title: "20% Off",
			provider: "20% Off",
			redemptionChannel: "BOTH",
			hexBackgroundColor: "#e63946",
			issuerName: "20% Off",
			reviewStatus: "UNDER_REVIEW",
		});

		expect(decodeObjectBody(pass, "offerObjects")).toEqual({
			id: `${ISSUER}.coupon-001`,
			classId: `${ISSUER}.test-coupon`,
			state: "ACTIVE",
			subheader: { defaultValue: { language: "en-US", value: "Offer" } },
			header: {
				defaultValue: {
					language: "en-US",
					value: "20% off your next order",
				},
			},
			textModulesData: [
				{ header: "Code", body: "SUMMER20", id: "code" },
				{ header: "Expires", body: "Dec 31, 2026", id: "expires" },
			],
		});
	});
});

describe("giftCard pass", () => {
	it("produces the correct class and object bodies", async () => {
		const { pass } = await run(
			{
				type: "giftCard",
				id: "test-giftcard",
				name: "Store Gift Card",
				color: "#2a9d8f",
				currency: "USD",
				fields: [
					{ slot: "primary", key: "balance", label: "Balance", value: "50.00" },
					{ slot: "secondary", key: "pin", label: "PIN", value: "1234" },
				],
			},
			{ serialNumber: "gift-001" }
		);

		expect(captureClassBody("giftCardClass")).toEqual({
			id: `${ISSUER}.test-giftcard`,
			// giftCardClass has no cardTitle — the merchant/title slot is merchantName
			merchantName: {
				defaultValue: { language: "en-US", value: "Store Gift Card" },
			},
			hexBackgroundColor: "#2a9d8f",
			issuerName: "Store Gift Card",
			reviewStatus: "UNDER_REVIEW",
		});

		expect(decodeObjectBody(pass, "giftCardObjects")).toEqual({
			id: `${ISSUER}.gift-001`,
			classId: `${ISSUER}.test-giftcard`,
			state: "ACTIVE",
			// cardNumber is required by giftCardObject — defaults to the serial number
			cardNumber: "gift-001",
			balance: { micros: "50000000", currencyCode: "USD" },
			subheader: { defaultValue: { language: "en-US", value: "Balance" } },
			header: { defaultValue: { language: "en-US", value: "50.00" } },
			textModulesData: [{ header: "PIN", body: "1234", id: "pin" }],
		});
	});

	it("uses a cardNumber field when provided", async () => {
		const { pass } = await run(
			{
				type: "giftCard",
				id: "p1",
				name: "Gift Card",
				currency: "USD",
				fields: [
					{
						slot: "back",
						key: "cardNumber",
						label: "Card Number",
						value: "1234-5678-9012",
					},
				],
			},
			{ serialNumber: "gift-002" }
		);

		const obj = decodeObjectBody(pass, "giftCardObjects");
		expect(obj.cardNumber).toBe("1234-5678-9012");
	});
});

describe("generic pass", () => {
	it("produces the correct class and object bodies", async () => {
		const { pass } = await run(
			{
				type: "generic",
				id: "test-generic",
				name: "Member Card",
				color: "#264653",
				fields: [
					{ slot: "primary", key: "mid", label: "Member ID", value: "M-98765" },
					{ slot: "secondary", key: "name", label: "Name", value: "Jane Doe" },
					{ slot: "back", key: "since", label: "Member Since", value: "2024" },
				],
			},
			{ serialNumber: "generic-001" }
		);

		// genericClass has no branding fields at all — cardTitle, color, images,
		// issuerName, and reviewStatus are object-level (or nonexistent) for generic
		expect(captureClassBody("genericClass")).toEqual({
			id: `${ISSUER}.test-generic`,
		});

		// genericObject carries all branding: cardTitle, color, logo, hero
		expect(decodeObjectBody(pass, "genericObjects")).toEqual({
			id: `${ISSUER}.generic-001`,
			classId: `${ISSUER}.test-generic`,
			state: "ACTIVE",
			cardTitle: { defaultValue: { language: "en-US", value: "Member Card" } },
			hexBackgroundColor: "#264653",
			subheader: { defaultValue: { language: "en-US", value: "Member ID" } },
			header: { defaultValue: { language: "en-US", value: "M-98765" } },
			textModulesData: [
				{ header: "Name", body: "Jane Doe", id: "name" },
				{ header: "Member Since", body: "2024", id: "since" },
			],
		});
	});

	it("falls back header to the pass name when there is no primary field", async () => {
		const { pass } = await run(
			{
				type: "generic",
				id: "p1",
				name: "Member Card",
				fields: [
					{ slot: "secondary", key: "name", label: "Name", value: "Jane Doe" },
				],
			},
			{ serialNumber: "generic-002" }
		);

		// genericObject requires both cardTitle and header
		const obj = decodeObjectBody(pass, "genericObjects");
		expect(obj.cardTitle).toEqual({
			defaultValue: { language: "en-US", value: "Member Card" },
		});
		expect(obj.header).toEqual({
			defaultValue: { language: "en-US", value: "Member Card" },
		});
	});
});

// ─── Class-level geo and module data ──────────────────────────────────────────

describe("merchantLocations", () => {
	it("emits merchantLocations, not the deprecated locations field", async () => {
		await run(
			{
				type: "loyalty",
				id: "p1",
				name: "Rewards",
				google: { logo: "https://example.com/logo.png" },
				fields: [],
				locations: [
					{
						latitude: 37.4,
						longitude: -122.1,
						altitude: 30,
						relevantText: "Hi",
					},
					{ latitude: 40.7, longitude: -74 },
				],
			},
			{ serialNumber: "s1" }
		);

		const cls = captureClassBody("loyaltyClass");
		expect(cls.locations).toBeUndefined();
		// MerchantLocation carries latitude/longitude only — altitude and
		// relevantText are Apple-only and dropped
		expect(cls.merchantLocations).toEqual([
			{ latitude: 37.4, longitude: -122.1 },
			{ latitude: 40.7, longitude: -74 },
		]);
	});
});

describe("links, images, and value-added modules", () => {
	it("emits class-level module data", async () => {
		await run(
			{
				type: "loyalty",
				id: "p1",
				name: "Rewards",
				google: {
					logo: "https://example.com/logo.png",
					links: [
						{ uri: "https://example.com", description: "Website", id: "web" },
						{ uri: "tel:+15551234567" },
					],
					images: [{ url: "https://example.com/banner.png", id: "banner" }],
					valueAdded: [
						{
							header: "Parking",
							uri: "https://example.com/parking",
							body: "Reserve a spot",
							imageUrl: "https://example.com/parking.png",
							sortIndex: 1,
						},
					],
				},
				fields: [],
			},
			{ serialNumber: "s1" }
		);

		const cls = captureClassBody("loyaltyClass");
		expect(cls.linksModuleData).toEqual({
			uris: [
				{ uri: "https://example.com", description: "Website", id: "web" },
				{ uri: "tel:+15551234567" },
			],
		});
		expect(cls.imageModulesData).toEqual([
			{
				mainImage: { sourceUri: { uri: "https://example.com/banner.png" } },
				id: "banner",
			},
		]);
		expect(cls.valueAddedModuleData).toEqual([
			{
				header: { defaultValue: { language: "en-US", value: "Parking" } },
				body: { defaultValue: { language: "en-US", value: "Reserve a spot" } },
				uri: "https://example.com/parking",
				image: { sourceUri: { uri: "https://example.com/parking.png" } },
				sortIndex: 1,
			},
		]);
	});

	it("emits per-recipient module data on the object", async () => {
		const { pass } = await run(
			{
				type: "loyalty",
				id: "p1",
				name: "Rewards",
				google: { logo: "https://example.com/logo.png" },
				fields: [],
			},
			{
				serialNumber: "s1",
				google: {
					links: [{ uri: "https://example.com/me" }],
					images: [{ url: "https://example.com/me.png" }],
					valueAdded: [{ header: "Perks", uri: "https://example.com/perks" }],
				},
			}
		);

		const obj = decodeObjectBody(pass, "loyaltyObjects");
		expect(obj.linksModuleData).toEqual({
			uris: [{ uri: "https://example.com/me" }],
		});
		expect(obj.imageModulesData).toEqual([
			{ mainImage: { sourceUri: { uri: "https://example.com/me.png" } } },
		]);
		expect(obj.valueAddedModuleData).toEqual([
			{
				header: { defaultValue: { language: "en-US", value: "Perks" } },
				uri: "https://example.com/perks",
			},
		]);
	});

	it("omits module keys entirely when unset", async () => {
		const { pass } = await run(
			{
				type: "loyalty",
				id: "p1",
				name: "Rewards",
				google: { logo: "https://example.com/logo.png" },
				fields: [],
			},
			{ serialNumber: "s1" }
		);

		const cls = captureClassBody("loyaltyClass");
		expect(cls).not.toHaveProperty("linksModuleData");
		expect(cls).not.toHaveProperty("imageModulesData");
		expect(cls).not.toHaveProperty("valueAddedModuleData");
		expect(decodeObjectBody(pass, "loyaltyObjects")).not.toHaveProperty(
			"linksModuleData"
		);
	});
});

// ─── Transit vertical ─────────────────────────────────────────────────────────

describe("transit pass", () => {
	it("produces transitClass and transitObject bodies", async () => {
		const { pass } = await run(
			{
				type: "flight",
				id: "test-transit",
				name: "Northern Line",
				color: "#c60c30",
				transitType: "train",
				origin: "PAD",
				destination: "BRI",
				departure: "2026-07-15T08:00:00+01:00",
				arrival: "2026-07-15T09:45:00+01:00",
				google: {
					logo: "https://example.com/rail.png",
					transit: { tripType: "roundTrip", ticketNumber: "TK-9001" },
				},
				fields: [
					{ slot: "primary", key: "platform", label: "Platform", value: "4" },
				],
			},
			{ serialNumber: "transit-001", values: { passengerName: "Jane Doe" } }
		);

		expect(captureClassBody("transitClass")).toEqual({
			id: `${ISSUER}.test-transit`,
			// transitType is required on transitClass; "train" maps to Google's RAIL
			transitType: "RAIL",
			hexBackgroundColor: "#c60c30",
			issuerName: "Northern Line",
			// transitClass names its logo "logo", unlike flightClass
			logo: { sourceUri: { uri: "https://example.com/rail.png" } },
			reviewStatus: "UNDER_REVIEW",
		});

		expect(decodeObjectBody(pass, "transitObjects")).toEqual({
			id: `${ISSUER}.transit-001`,
			classId: `${ISSUER}.test-transit`,
			state: "ACTIVE",
			// tripType is required on transitObject
			tripType: "ROUND_TRIP",
			ticketNumber: "TK-9001",
			passengerNames: "Jane Doe",
			ticketLeg: {
				originName: { defaultValue: { language: "en-US", value: "PAD" } },
				destinationName: { defaultValue: { language: "en-US", value: "BRI" } },
				// TicketLeg times accept an offset, unlike flightClass local times
				departureDateTime: "2026-07-15T08:00:00+01:00",
				arrivalDateTime: "2026-07-15T09:45:00+01:00",
			},
			subheader: { defaultValue: { language: "en-US", value: "Platform" } },
			header: { defaultValue: { language: "en-US", value: "4" } },
		});
	});

	it("defaults tripType to ONE_WAY", async () => {
		const { pass } = await run(
			{
				type: "flight",
				id: "p1",
				name: "Bus",
				transitType: "bus",
				google: { logo: "https://example.com/bus.png", transit: {} },
				fields: [],
			},
			{ serialNumber: "s1" }
		);

		const obj = decodeObjectBody(pass, "transitObjects");
		expect(obj.tripType).toBe("ONE_WAY");
		expect(captureClassBody("transitClass").transitType).toBe("BUS");
	});

	// Apple's PKTransitTypeGeneric has no Google counterpart
	it("maps the generic transitType to OTHER", async () => {
		await run(
			{
				type: "flight",
				id: "p1",
				name: "Shuttle",
				transitType: "generic",
				google: { logo: "https://example.com/shuttle.png", transit: {} },
				fields: [],
			},
			{ serialNumber: "s1" }
		);

		expect(captureClassBody("transitClass").transitType).toBe("OTHER");
	});

	it("lets createConfig override tripType per recipient", async () => {
		const { pass } = await run(
			{
				type: "flight",
				id: "p1",
				name: "Ferry",
				transitType: "boat",
				google: {
					logo: "https://example.com/ferry.png",
					transit: { tripType: "roundTrip" },
				},
				fields: [],
			},
			{ serialNumber: "s1", google: { tripType: "oneWay" } }
		);

		expect(decodeObjectBody(pass, "transitObjects").tripType).toBe("ONE_WAY");
		// "boat" maps to Google's FERRY
		expect(captureClassBody("transitClass").transitType).toBe("FERRY");
	});

	it("prefers an explicit google.transit.transitType and station names", async () => {
		const { pass } = await run(
			{
				type: "flight",
				id: "p1",
				name: "Tram",
				transitType: "train",
				google: {
					logo: "https://example.com/tram.png",
					transit: {
						transitType: "tram",
						originName: "Market Street",
						destinationName: "Harbour",
						operatorName: "City Transit",
					},
				},
				fields: [],
			},
			{ serialNumber: "s1" }
		);

		const cls = captureClassBody("transitClass");
		expect(cls.transitType).toBe("TRAM");
		expect(cls.transitOperatorName).toEqual({
			defaultValue: { language: "en-US", value: "City Transit" },
		});
		const leg = decodeObjectBody(pass, "transitObjects").ticketLeg as Record<
			string,
			unknown
		>;
		expect(leg.originName).toEqual({
			defaultValue: { language: "en-US", value: "Market Street" },
		});
		expect(leg.destinationName).toEqual({
			defaultValue: { language: "en-US", value: "Harbour" },
		});
	});

	it("does not require IATA fields or a passengerName", async () => {
		await expect(
			run(
				{
					type: "flight",
					id: "p1",
					name: "Bus",
					google: { logo: "https://example.com/bus.png", transit: {} },
					fields: [],
				},
				{ serialNumber: "s1" }
			)
		).resolves.toBeDefined();
	});

	it("throws when the transit logo is missing (required by transitClass)", async () => {
		await expect(
			run(
				{
					type: "flight",
					id: "p1",
					name: "Bus",
					google: { transit: {} },
					fields: [],
				},
				{ serialNumber: "s1" }
			)
		).rejects.toMatchObject({ code: "GOOGLE_MISSING_LOGO" });
	});

	it("still uses flightClass when google.transit is absent", async () => {
		const { pass } = await run(
			{
				type: "flight",
				id: "p1",
				name: "Flight",
				transitType: "train",
				carrier: "AA",
				flightNumber: "100",
				origin: "JFK",
				destination: "LAX",
				departure: "2026-07-15T08:00:00Z",
				fields: [],
			},
			{ serialNumber: "s1", values: { passengerName: "Jane" } }
		);

		expect(captureClassBody("flightClass").flightHeader).toBeDefined();
		expect(decodeObjectBody(pass, "flightObjects").passengerName).toBe("Jane");
	});
});

// ─── Update notifications ─────────────────────────────────────────────────────

describe("updateGooglePass notifyPreference", () => {
	const base = {
		type: "loyalty" as const,
		id: "p1",
		name: "Rewards",
		google: { logo: "https://example.com/logo.png" },
		fields: [],
	};

	it("sets notifyPreference in the PATCH body when notify is requested", async () => {
		stubFetch();
		await updateGooglePass(base, { serialNumber: "s1" }, credentials, {
			notify: true,
		});

		const { url, body } = capturePatch();
		expect(body.notifyPreference).toBe("NOTIFY_ON_UPDATE");
		// notifyPreference is a body field, not a query parameter
		expect(url).not.toContain("notifyPreference");
		expect(url).toContain(`/loyaltyObject/${ISSUER}.s1`);
	});

	it("omits notifyPreference by default (backward compatible)", async () => {
		stubFetch();
		await updateGooglePass(base, { serialNumber: "s1" }, credentials);
		expect(capturePatch().body).not.toHaveProperty("notifyPreference");
	});

	it("patches transitObject for a transit pass", async () => {
		stubFetch();
		await updateGooglePass(
			{
				type: "flight",
				id: "p1",
				name: "Bus",
				google: { logo: "https://example.com/bus.png", transit: {} },
				fields: [],
			},
			{ serialNumber: "s1" },
			credentials
		);
		expect(capturePatch().url).toContain(`/transitObject/${ISSUER}.s1`);
	});
});
