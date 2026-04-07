import { generateKeyPairSync } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { GoogleCredentials } from "../../types/credentials";
import { generateGooglePass } from "./index";

// ─── Setup ────────────────────────────────────────────────────────────────────

let credentials: GoogleCredentials;

beforeAll(() => {
	const { privateKey } = generateKeyPairSync("rsa", {
		modulusLength: 2048,
		privateKeyEncoding: { type: "pkcs8", format: "pem" },
	});
	credentials = {
		issuerId: "3388000000022801234",
		clientEmail: "test@test-project.iam.gserviceaccount.com",
		privateKey: privateKey as string,
	};
});

afterEach(() => {
	vi.unstubAllGlobals();
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
	const padded = segment.replace(/-/g, "+").replace(/_/g, "/");
	const outer = JSON.parse(
		Buffer.from(padded, "base64").toString("utf-8")
	) as Record<string, unknown>;
	const inner = (outer.payload as Record<string, unknown>)[
		objectsKey
	] as Record<string, unknown>[];
	return inner[0];
}

const ISSUER = "3388000000022801234";

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
			textModulesData: [{ header: "Tier", body: "Gold", id: "tier" }],
			infoModuleData: {
				labelValueRows: [{ columns: [{ label: "Member", value: "Jane Doe" }] }],
			},
		});
	});

	it("uses createConfig.values to override field values", async () => {
		const { pass } = await run(
			{
				type: "loyalty",
				id: "p1",
				name: "Rewards",
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
		expect((obj.textModulesData as Record<string, unknown>[])[0].body).toBe(
			"Platinum"
		);
	});

	it("omits fields whose value is null in createConfig.values", async () => {
		const { pass } = await run(
			{
				type: "loyalty",
				id: "p1",
				name: "Rewards",
				fields: [
					{ slot: "secondary", key: "tier", label: "Tier", value: "Gold" },
				],
			},
			{ serialNumber: "s1", values: { tier: null } }
		);

		const obj = decodeObjectBody(pass, "loyaltyObjects");
		expect(obj.textModulesData).toBeUndefined();
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
			localScheduledStartDateTime: "2026-07-15T20:00:00",
			localScheduledEndDateTime: "2026-07-15T23:00:00",
			hexBackgroundColor: "#6a0572",
			issuerName: "Summer Festival",
			reviewStatus: "UNDER_REVIEW",
		});

		expect(decodeObjectBody(pass, "eventTicketObjects")).toEqual({
			id: `${ISSUER}.event-001`,
			classId: `${ISSUER}.test-event`,
			state: "ACTIVE",
			subheader: { defaultValue: { language: "en-US", value: "Venue" } },
			header: { defaultValue: { language: "en-US", value: "Central Park" } },
			textModulesData: [
				{ header: "Date", body: "Jul 15, 2026", id: "date" },
				{ header: "Seat", body: "A12", id: "seat" },
			],
		});
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
			origin: { airportIataCode: "JFK" },
			destination: {
				airportIataCode: "LAX",
				localScheduledArrivalDateTime: "2026-07-15T11:30:00",
			},
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

	it("warns when passengerName is missing", async () => {
		const { warnings } = await run(
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
		);
		expect(warnings.some((w) => w.includes("passengerName"))).toBe(true);
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
			textModulesData: [{ header: "Code", body: "SUMMER20", id: "code" }],
			infoModuleData: {
				labelValueRows: [
					{ columns: [{ label: "Expires", value: "Dec 31, 2026" }] },
				],
			},
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
			cardTitle: {
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
			balance: { micros: "50000000", currencyCode: "USD" },
			subheader: { defaultValue: { language: "en-US", value: "Balance" } },
			header: { defaultValue: { language: "en-US", value: "50.00" } },
			textModulesData: [{ header: "PIN", body: "1234", id: "pin" }],
		});
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

		// genericClass has no reviewStatus — Google rejects the field on this type
		expect(captureClassBody("genericClass")).toEqual({
			id: `${ISSUER}.test-generic`,
			cardTitle: { defaultValue: { language: "en-US", value: "Member Card" } },
			hexBackgroundColor: "#264653",
			issuerName: "Member Card",
		});

		// genericObject requires cardTitle — this was missing before and caused a smoke test failure
		expect(decodeObjectBody(pass, "genericObjects")).toEqual({
			id: `${ISSUER}.generic-001`,
			classId: `${ISSUER}.test-generic`,
			state: "ACTIVE",
			cardTitle: { defaultValue: { language: "en-US", value: "Member Card" } },
			subheader: { defaultValue: { language: "en-US", value: "Member ID" } },
			header: { defaultValue: { language: "en-US", value: "M-98765" } },
			textModulesData: [{ header: "Name", body: "Jane Doe", id: "name" }],
			infoModuleData: {
				labelValueRows: [
					{ columns: [{ label: "Member Since", value: "2024" }] },
				],
			},
		});
	});
});
