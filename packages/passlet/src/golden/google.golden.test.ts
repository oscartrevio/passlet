/**
 * GOLDEN TESTS — Google Wallet
 *
 * PHILOSOPHY
 * These tests encode the *vendor contract*, not passlet's current behaviour.
 * Every assertion here answers "is this what Google's API accepts?", never
 * "is this what our code happens to emit today?".
 *
 * Two layers, deliberately:
 *   1. STRUCTURAL — each captured class/object body is checked against the
 *      allowed top-level keys of its resource, transcribed from Google's
 *      discovery document into src/golden/google-schema.ts. A key that the
 *      resource does not define is a bug even when the unit tests are green,
 *      because it only surfaces as a 400 against the live API.
 *   2. GOLDEN — a handful of explicit expectations for the shapes that vendor
 *      docs single out (genericClass carries no branding, giftCardClass uses
 *      merchantName rather than cardTitle, flightClass keeps arrival time at
 *      the top level, transitClass names its logo "logo").
 *
 * HOW TO UPDATE
 * A failure here means one of two things: passlet regressed, or Google changed
 * the contract. Change these expectations ONLY in the second case, and ONLY
 * with the doc reference (a developers.google.com/wallet/reference/rest/v1/*
 * URL) recorded in the commit message. Never relax an assertion to make a
 * refactor pass — that is exactly the regression this file exists to catch.
 */

import { generateKeyPairSync } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { generateGooglePass } from "../providers/google/index";
import type { GoogleCredentials } from "../types/credentials";
import type { CreateConfig, PassConfig } from "../types/schemas";
import {
	assertGoogleSchema,
	assertRequiredKeys,
	type GoogleResource,
} from "./google-schema";

// ─── Known schema deviations ─────────────────────────────────────────────────
//
// Keys passlet emits today that the target resource does NOT define. Each entry
// is an acknowledged bug, kept explicit so it is reviewed rather than forgotten.
// `assertGoogleSchema` is exact in both directions, so removing the underlying
// bug makes these tests fail until the entry is deleted here too.
//
// There are none today — keep it that way.
const KNOWN_DEVIATIONS: Partial<Record<GoogleResource, readonly string[]>> = {};

// ─── Harness ─────────────────────────────────────────────────────────────────

const ISSUER = "3388000000022801234";

let credentials: GoogleCredentials;

beforeAll(() => {
	const { privateKey } = generateKeyPairSync("rsa", {
		modulusLength: 2048,
		privateKeyEncoding: { type: "pkcs8", format: "pem" },
		publicKeyEncoding: { type: "spki", format: "pem" },
	});
	credentials = {
		issuerId: ISSUER,
		clientEmail: "test@test-project.iam.gserviceaccount.com",
		privateKey: privateKey as string,
	};
});

afterEach(() => {
	vi.unstubAllGlobals?.();
	vi.restoreAllMocks();
});

// OAuth token → fake token; GET class → 404 so the create (POST) path is taken.
function stubFetch(): void {
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

/** Body of the POST that creates the class. */
function captureClassBody(classType: string): Record<string, unknown> {
	const call = vi
		.mocked(globalThis.fetch)
		.mock.calls.find(
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

/** Object body embedded in the signed JWT payload. */
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
	const objects = (outer.payload as Record<string, unknown>)[
		objectsKey
	] as Record<string, unknown>[];
	const body = objects[0];
	if (!body) {
		throw new Error(`no object found for key ${objectsKey}`);
	}
	return body;
}

interface Captured {
	classBody: Record<string, unknown>;
	objectBody: Record<string, unknown>;
}

/**
 * Generates a pass and captures both request bodies, then runs the structural
 * checks every resource must satisfy. Individual tests add golden expectations
 * on top of the returned bodies.
 */
async function capture(
	pass: PassConfig,
	createConfig: CreateConfig,
	resource: { class: GoogleResource; object: GoogleResource },
	required: { class: readonly string[]; object: readonly string[] }
): Promise<Captured> {
	stubFetch();
	const { pass: jwt } = await generateGooglePass(
		pass,
		createConfig,
		credentials
	);
	if (!jwt) {
		throw new Error("expected a JWT");
	}

	const classBody = captureClassBody(resource.class);
	const objectBody = decodeObjectBody(jwt, `${resource.object}s`);

	assertGoogleSchema(
		resource.class,
		classBody,
		KNOWN_DEVIATIONS[resource.class]
	);
	assertGoogleSchema(
		resource.object,
		objectBody,
		KNOWN_DEVIATIONS[resource.object]
	);
	assertRequiredKeys(resource.class, classBody, required.class);
	assertRequiredKeys(resource.object, objectBody, required.object);

	return { classBody, objectBody };
}

/** Required on every class per the "Required" markers in the REST reference. */
const CLASS_BASE_REQUIRED = ["id", "issuerName", "reviewStatus"] as const;
/** Required on every object per the REST reference. */
const OBJECT_BASE_REQUIRED = ["id", "classId", "state"] as const;

const LOGO = "https://example.com/logo.png";

// ─── Per-type goldens ────────────────────────────────────────────────────────

describe("loyalty", () => {
	it("conforms to loyaltyClass / loyaltyObject", async () => {
		const { classBody, objectBody } = await capture(
			{
				type: "loyalty",
				id: "g-loyalty",
				name: "Rewards Card",
				color: "#1a1a2e",
				google: { logo: LOGO },
				fields: [
					{ slot: "primary", key: "points", label: "Points", value: "1250" },
					{ slot: "secondary", key: "tier", label: "Tier", value: "Gold" },
					{ slot: "back", key: "member", label: "Member", value: "Jane Doe" },
				],
			},
			{ serialNumber: "loyalty-001" },
			{ class: "loyaltyClass", object: "loyaltyObject" },
			{
				class: [...CLASS_BASE_REQUIRED, "programName", "programLogo"],
				object: OBJECT_BASE_REQUIRED,
			}
		);

		// loyaltyClass names its title "programName" and its logo "programLogo" —
		// there is no cardTitle or logo on this resource.
		expect(classBody.programName).toBe("Rewards Card");
		expect(classBody.programLogo).toEqual({ sourceUri: { uri: LOGO } });
		expect(classBody).not.toHaveProperty("cardTitle");
		expect(classBody).not.toHaveProperty("logo");

		// Structured object fields, not text modules.
		expect(objectBody.loyaltyPoints).toEqual({ balance: { string: "1250" } });
		expect(objectBody.accountName).toBe("Jane Doe");
		// infoModuleData is deprecated in favour of textModulesData.
		expect(objectBody).not.toHaveProperty("infoModuleData");
	});
});

describe("event", () => {
	it("conforms to eventTicketClass / eventTicketObject", async () => {
		const { classBody, objectBody } = await capture(
			{
				type: "event",
				id: "g-event",
				name: "Summer Festival",
				color: "#6a0572",
				startsAt: "2026-07-15T20:00:00Z",
				endsAt: "2026-07-15T23:00:00Z",
				venue: { name: "Arena", address: "1 Main St" },
				fields: [
					{ slot: "primary", key: "venue", label: "Venue", value: "Arena" },
					{ slot: "auxiliary", key: "seat", label: "Seat", value: "A12" },
					{ slot: "auxiliary", key: "row", label: "Row", value: "12" },
					{ slot: "auxiliary", key: "section", label: "Section", value: "A" },
					{ slot: "auxiliary", key: "gate", label: "Gate", value: "3" },
				],
			},
			{ serialNumber: "event-001" },
			{ class: "eventTicketClass", object: "eventTicketObject" },
			{
				class: [...CLASS_BASE_REQUIRED, "eventName"],
				object: OBJECT_BASE_REQUIRED,
			}
		);

		// eventName and venue are LocalizedString/EventVenue on the class.
		expect(classBody.eventName).toEqual({
			defaultValue: { language: "en-US", value: "Summer Festival" },
		});
		expect(classBody.dateTime).toEqual({
			start: "2026-07-15T20:00:00Z",
			end: "2026-07-15T23:00:00Z",
		});
		expect(classBody.venue).toEqual({
			name: { defaultValue: { language: "en-US", value: "Arena" } },
			address: { defaultValue: { language: "en-US", value: "1 Main St" } },
		});

		// seat/row/section/gate belong in seatInfo, never in textModulesData.
		expect(objectBody.seatInfo).toEqual({
			seat: { defaultValue: { language: "en-US", value: "A12" } },
			row: { defaultValue: { language: "en-US", value: "12" } },
			section: { defaultValue: { language: "en-US", value: "A" } },
			gate: { defaultValue: { language: "en-US", value: "3" } },
		});
		// The primary field has no home on eventTicketObject (header/subheader are
		// GenericObject-only), so it leads textModulesData.
		expect(objectBody.textModulesData).toEqual([
			{ header: "Venue", body: "Arena", id: "venue" },
		]);
	});
});

describe("flight", () => {
	it("conforms to flightClass / flightObject", async () => {
		const { classBody, objectBody } = await capture(
			{
				type: "flight",
				id: "g-flight",
				name: "AA 100",
				color: "#003087",
				transitType: "air",
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
			{ serialNumber: "flight-001", values: { passengerName: "Jane Doe" } },
			{ class: "flightClass", object: "flightObject" },
			{
				class: [
					...CLASS_BASE_REQUIRED,
					"flightHeader",
					"origin",
					"destination",
					"localScheduledDepartureDateTime",
				],
				object: [...OBJECT_BASE_REQUIRED, "passengerName", "reservationInfo"],
			}
		);

		// Arrival time is a top-level flightClass field — it is NOT nested inside
		// the destination AirportInfo, which only carries airport data.
		expect(classBody.localScheduledArrivalDateTime).toBe("2026-07-15T11:30:00");
		expect(classBody.destination).toEqual({ airportIataCode: "LAX" });
		expect(classBody.origin).toEqual({ airportIataCode: "JFK" });
		// flightClass local times carry no UTC offset — Google derives the zone.
		expect(classBody.localScheduledDepartureDateTime).toBe(
			"2026-07-15T08:00:00"
		);
		// flightClass defines no logo field at all.
		expect(classBody).not.toHaveProperty("logo");

		expect(objectBody.passengerName).toBe("Jane Doe");
		expect(objectBody.reservationInfo).toEqual({
			confirmationCode: "flight-001",
		});
	});
});

describe("transit", () => {
	it("conforms to transitClass / transitObject", async () => {
		const { classBody, objectBody } = await capture(
			{
				type: "flight",
				id: "g-transit",
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
			{ serialNumber: "transit-001", values: { passengerName: "Jane Doe" } },
			{ class: "transitClass", object: "transitObject" },
			{
				class: [...CLASS_BASE_REQUIRED, "logo", "transitType"],
				object: [...OBJECT_BASE_REQUIRED, "tripType"],
			}
		);

		// transitClass names its logo "logo" (unlike loyaltyClass's programLogo)
		// and requires transitType from a fixed enum.
		expect(classBody.logo).toEqual({
			sourceUri: { uri: "https://example.com/rail.png" },
		});
		expect(classBody.transitType).toBe("RAIL");
		expect(classBody).not.toHaveProperty("programLogo");

		// TicketLeg times accept a UTC offset, unlike flightClass local times.
		expect(objectBody.ticketLeg).toEqual({
			originName: { defaultValue: { language: "en-US", value: "PAD" } },
			destinationName: { defaultValue: { language: "en-US", value: "BRI" } },
			departureDateTime: "2026-07-15T08:00:00+01:00",
			arrivalDateTime: "2026-07-15T09:45:00+01:00",
		});
		expect(objectBody.tripType).toBe("ROUND_TRIP");
		expect(objectBody.ticketNumber).toBe("TK-9001");
		// transitObject pluralises the passenger field.
		expect(objectBody.passengerNames).toBe("Jane Doe");
		expect(objectBody).not.toHaveProperty("passengerName");
	});
});

describe("coupon", () => {
	it("conforms to offerClass / offerObject", async () => {
		const { classBody, objectBody } = await capture(
			{
				type: "coupon",
				id: "g-coupon",
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
				],
			},
			{ serialNumber: "coupon-001" },
			{ class: "offerClass", object: "offerObject" },
			{
				class: [
					...CLASS_BASE_REQUIRED,
					"title",
					"provider",
					"redemptionChannel",
				],
				object: OBJECT_BASE_REQUIRED,
			}
		);

		// offerClass uses title/provider — plain strings, not LocalizedString —
		// and redemptionChannel from a fixed enum.
		expect(classBody.title).toBe("20% Off");
		expect(classBody.provider).toBe("20% Off");
		expect(classBody.redemptionChannel).toBe("BOTH");
		expect(classBody).not.toHaveProperty("programName");

		// offerObject defines no structured display fields — everything lands in
		// textModulesData, primary field first.
		expect(objectBody.textModulesData).toEqual([
			{ header: "Offer", body: "20% off your next order", id: "offer" },
			{ header: "Code", body: "SUMMER20", id: "code" },
		]);
	});
});

describe("giftCard", () => {
	it("conforms to giftCardClass / giftCardObject", async () => {
		const { classBody, objectBody } = await capture(
			{
				type: "giftCard",
				id: "g-giftcard",
				name: "Store Gift Card",
				color: "#2a9d8f",
				currency: "USD",
				fields: [
					{ slot: "primary", key: "balance", label: "Balance", value: "50.00" },
					{ slot: "secondary", key: "pin", label: "PIN", value: "1234" },
				],
			},
			{ serialNumber: "gift-001" },
			{ class: "giftCardClass", object: "giftCardObject" },
			{
				class: CLASS_BASE_REQUIRED,
				object: [...OBJECT_BASE_REQUIRED, "cardNumber"],
			}
		);

		// giftCardClass has NO cardTitle — the merchant/title slot is merchantName,
		// and it is a LocalizedString.
		expect(classBody.merchantName).toEqual({
			defaultValue: { language: "en-US", value: "Store Gift Card" },
		});
		expect(classBody).not.toHaveProperty("cardTitle");
		expect(classBody).not.toHaveProperty("title");

		// cardNumber is required by giftCardObject; balance is a Money value in
		// micros alongside an ISO-4217 currency code.
		expect(objectBody.cardNumber).toBe("gift-001");
		expect(objectBody.balance).toEqual({
			micros: "50000000",
			currencyCode: "USD",
		});
	});
});

describe("generic", () => {
	it("conforms to genericClass / genericObject", async () => {
		const { classBody, objectBody } = await capture(
			{
				type: "generic",
				id: "g-generic",
				name: "Member Card",
				color: "#264653",
				google: { logo: LOGO },
				fields: [
					{ slot: "primary", key: "mid", label: "Member ID", value: "M-98765" },
					{ slot: "secondary", key: "name", label: "Name", value: "Jane Doe" },
				],
			},
			{ serialNumber: "generic-001" },
			{ class: "genericClass", object: "genericObject" },
			{
				class: ["id"],
				object: [...OBJECT_BASE_REQUIRED, "cardTitle", "header"],
			}
		);

		// genericClass defines no branding fields whatsoever — every one of these
		// belongs on genericObject instead, and sending them to the class is a 400.
		for (const key of [
			"hexBackgroundColor",
			"logo",
			"issuerName",
			"reviewStatus",
			"cardTitle",
			"heroImage",
			"programName",
			"wordMark",
		]) {
			expect(
				classBody,
				`genericClass must not carry ${key}`
			).not.toHaveProperty(key);
		}
		expect(Object.keys(classBody)).toEqual(["id"]);

		// genericObject carries all branding, and requires cardTitle + header.
		expect(objectBody.cardTitle).toEqual({
			defaultValue: { language: "en-US", value: "Member Card" },
		});
		expect(objectBody.header).toEqual({
			defaultValue: { language: "en-US", value: "M-98765" },
		});
		expect(objectBody.hexBackgroundColor).toBe("#264653");
		expect(objectBody.logo).toEqual({ sourceUri: { uri: LOGO } });
	});
});

// ─── The validator itself ────────────────────────────────────────────────────
//
// A golden test is only worth its failure mode, so these guard the guard.

const OFFENDING_KEY_AND_DOC_RE =
	/"hexBackgroundColor"[\s\S]*developers\.google\.com\/wallet\/reference\/rest\/v1\/genericclass/;
const STALE_DEVIATION_RE =
	/no longer emits the known-deviation key\(s\) "header"/;
const MISSING_REQUIRED_RE = /missing required key\(s\): "transitType"/;

describe("assertGoogleSchema", () => {
	it("names every offending key and the doc URL", () => {
		expect(() =>
			assertGoogleSchema("genericClass", {
				id: "x",
				hexBackgroundColor: "#fff",
			})
		).toThrow(OFFENDING_KEY_AND_DOC_RE);
	});

	it("fails when a known deviation has been fixed, so the list cannot rot", () => {
		expect(() =>
			assertGoogleSchema("loyaltyObject", { id: "x" }, ["header"])
		).toThrow(STALE_DEVIATION_RE);
	});

	it("ignores undefined placeholders, which JSON.stringify drops", () => {
		expect(() =>
			assertGoogleSchema("genericClass", { id: "x", issuerName: undefined })
		).not.toThrow();
	});

	it("reports missing required keys", () => {
		expect(() =>
			assertRequiredKeys("transitClass", { id: "x" }, ["id", "transitType"])
		).toThrow(MISSING_REQUIRED_RE);
	});
});

// ─── Cross-cutting vendor rules ──────────────────────────────────────────────

describe("cross-cutting", () => {
	it("emits merchantLocations, never the deprecated locations field", async () => {
		const { classBody } = await capture(
			{
				type: "loyalty",
				id: "g-loc",
				name: "Rewards",
				google: { logo: LOGO },
				locations: [
					{
						latitude: 37.4,
						longitude: -122.1,
						altitude: 30,
						relevantText: "Hi",
					},
				],
				fields: [
					{ slot: "primary", key: "points", label: "Points", value: "10" },
				],
			},
			{ serialNumber: "loc-001" },
			{ class: "loyaltyClass", object: "loyaltyObject" },
			{ class: CLASS_BASE_REQUIRED, object: OBJECT_BASE_REQUIRED }
		);

		expect(classBody).not.toHaveProperty("locations");
		// MerchantLocation carries latitude/longitude only.
		expect(classBody.merchantLocations).toEqual([
			{ latitude: 37.4, longitude: -122.1 },
		]);
	});

	it("keeps header/subheader off every non-generic object", async () => {
		// header and subheader are GenericObject-only fields; the primary field of
		// a non-generic pass goes to textModulesData instead.
		stubFetch();
		const { pass: jwt } = await generateGooglePass(
			{
				type: "loyalty",
				id: "g-dev",
				name: "Rewards",
				google: { logo: LOGO },
				fields: [
					{ slot: "primary", key: "points", label: "Points", value: "10" },
				],
			},
			{ serialNumber: "dev-001" },
			credentials
		);
		if (!jwt) {
			throw new Error("expected a JWT");
		}
		const objectBody = decodeObjectBody(jwt, "loyaltyObjects");

		// Documented at
		// https://developers.google.com/wallet/reference/rest/v1/loyaltyobject —
		// neither key appears in the LoyaltyObject resource representation.
		expect(
			Object.keys(objectBody).filter(
				(key) => key === "header" || key === "subheader"
			)
		).toEqual([]);
		// The primary field is not lost: "points" is a structured loyaltyObject
		// field, so it renders as loyaltyPoints rather than in textModulesData.
		expect(objectBody.loyaltyPoints).toEqual({ balance: { string: "10" } });
	});
});
