import { describe, expect, it } from "vitest";
import { buildClassBody } from "../../../src/google/class-body";
import type {
	GoogleTransitOptions,
	ParsedTemplate,
} from "../../../src/schema/template";
import { FIXTURES, type FixtureName } from "../../support/fixtures";
import { LOGO_URL } from "../../support/google";
import {
	assertGoogleSchema,
	assertRequiredKeys,
	type GoogleResource,
} from "../../support/google-schema";

type BoardingPassConfig = Extract<ParsedTemplate, { type: "boardingPass" }>;

const LOGO = { sourceUri: { uri: LOGO_URL } };

function en(value: string) {
	return { defaultValue: { language: "en-US", value } };
}

const EVENT = FIXTURES.eventTicket.pass;
const FLIGHT = FIXTURES.boardingPass.pass;
if (EVENT.type !== "eventTicket" || FLIGHT.type !== "boardingPass") {
	throw new Error("fixture types drifted");
}

// ensureClass stamps `id` onto the request, so it is absent from the built body.
const BASE_REQUIRED = ["issuerName", "reviewStatus"];

interface Golden {
	body: Record<string, unknown>;
	required: readonly string[];
	resource: GoogleResource;
}

const GOLDEN: Record<FixtureName, Golden> = {
	loyalty: {
		resource: "loyaltyClass",
		required: [...BASE_REQUIRED, "programName", "programLogo"],
		// loyaltyClass names its title programName and its logo programLogo; the
		// title is a plain string, so the fixture's name translation goes to
		// localizedProgramName, and to localizedIssuerName as the issuer name.
		body: {
			programName: "Acme Rewards",
			localizedProgramName: {
				...en("Acme Rewards"),
				translatedValues: [{ language: "es", value: "Recompensas Acme" }],
			},
			hexBackgroundColor: "#1a1a2e",
			issuerName: "Acme Rewards",
			localizedIssuerName: {
				...en("Acme Rewards"),
				translatedValues: [{ language: "es", value: "Recompensas Acme" }],
			},
			reviewStatus: "UNDER_REVIEW",
			programLogo: LOGO,
			enableSmartTap: false,
		},
	},
	eventTicket: {
		resource: "eventTicketClass",
		required: [...BASE_REQUIRED, "eventName"],
		body: {
			eventName: en("Summer Festival"),
			// EventDateTime resolves the instant from the offset: forwarded verbatim.
			dateTime: { start: "2026-07-15T20:00:00Z", end: "2026-07-15T23:00:00Z" },
			venue: { name: en("Central Park"), address: en("1 Main St") },
			hexBackgroundColor: "#6a0572",
			issuerName: "Summer Festival",
			reviewStatus: "UNDER_REVIEW",
			logo: LOGO,
			enableSmartTap: false,
		},
	},
	boardingPass: {
		resource: "flightClass",
		required: [
			...BASE_REQUIRED,
			"flightHeader",
			"origin",
			"destination",
			"localScheduledDepartureDateTime",
		],
		body: {
			flightHeader: {
				// flightClass is the one class that keeps its logo inside the carrier.
				carrier: { carrierIataCode: "AA", airlineLogo: LOGO },
				flightNumber: "100",
				operatingCarrier: { carrierIataCode: "AA" },
				operatingFlightNumber: "100",
			},
			// Airport-local times carry no offset: Google derives the zone.
			localScheduledDepartureDateTime: "2026-07-15T08:00:00",
			// Top-level: the destination AirportInfo carries airport data only.
			localScheduledArrivalDateTime: "2026-07-15T11:30:00",
			origin: { airportIataCode: "JFK" },
			destination: { airportIataCode: "LAX" },
			hexBackgroundColor: "#003087",
			issuerName: "AA 100",
			reviewStatus: "UNDER_REVIEW",
			enableSmartTap: false,
		},
	},
	transit: {
		resource: "transitClass",
		required: [...BASE_REQUIRED, "logo", "transitType"],
		body: {
			transitType: "RAIL",
			hexBackgroundColor: "#c60c30",
			issuerName: "Northern Line",
			reviewStatus: "UNDER_REVIEW",
			logo: LOGO,
			enableSmartTap: false,
		},
	},
	coupon: {
		resource: "offerClass",
		required: [...BASE_REQUIRED, "title", "provider", "redemptionChannel"],
		body: {
			title: "20% Off",
			provider: "20% Off",
			redemptionChannel: "BOTH",
			hexBackgroundColor: "#e63946",
			issuerName: "20% Off",
			reviewStatus: "UNDER_REVIEW",
			titleImage: LOGO,
			enableSmartTap: false,
		},
	},
	giftCard: {
		resource: "giftCardClass",
		required: BASE_REQUIRED,
		body: {
			// giftCardClass has no cardTitle; merchantName is a plain string and
			// the API rejects a LocalizedString there (localizedMerchantName).
			merchantName: "Store Gift Card",
			hexBackgroundColor: "#2a9d8f",
			issuerName: "Store Gift Card",
			reviewStatus: "UNDER_REVIEW",
			programLogo: LOGO,
			enableSmartTap: false,
		},
	},
	generic: {
		resource: "genericClass",
		required: [],
		// genericClass has no branding fields at all; they live on the object.
		body: { enableSmartTap: false },
	},
};

describe("buildClassBody", () => {
	describe.each(Object.keys(GOLDEN) as FixtureName[])("%s", (name) => {
		const { resource, required, body: expected } = GOLDEN[name];

		it(`builds exactly the expected ${resource}`, () => {
			const { pass } = FIXTURES[name];
			const body = buildClassBody(pass);
			assertGoogleSchema(resource, body);
			assertRequiredKeys(resource, body, required);
			expect(body).toEqual(expected);
		});
	});

	it("emits merchantLocations with latitude and longitude only, never the deprecated locations", () => {
		const body = buildClassBody({
			...FIXTURES.loyalty.pass,
			locations: [
				{ latitude: 37.4, longitude: -122.1, altitude: 30, relevantText: "Hi" },
				{ latitude: 40.7, longitude: -74 },
			],
		});
		expect(body.merchantLocations).toEqual([
			{ latitude: 37.4, longitude: -122.1 },
			{ latitude: 40.7, longitude: -74 },
		]);
		expect(body).not.toHaveProperty("locations");
	});

	it("maps class-level links, images and value-added modules, omitting each key when its list is empty", () => {
		const body = buildClassBody({
			...FIXTURES.loyalty.pass,
			google: {
				logo: LOGO_URL,
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
		});
		assertGoogleSchema("loyaltyClass", body);
		expect(body.linksModuleData).toEqual({
			uris: [
				{ uri: "https://example.com", description: "Website", id: "web" },
				{ uri: "tel:+15551234567" },
			],
		});
		expect(body.imageModulesData).toEqual([
			{
				mainImage: { sourceUri: { uri: "https://example.com/banner.png" } },
				id: "banner",
			},
		]);
		expect(body.valueAddedModuleData).toEqual([
			{
				header: en("Parking"),
				body: en("Reserve a spot"),
				uri: "https://example.com/parking",
				image: { sourceUri: { uri: "https://example.com/parking.png" } },
				sortIndex: 1,
			},
		]);

		const empty = buildClassBody({
			...FIXTURES.loyalty.pass,
			google: { logo: LOGO_URL, links: [], images: [], valueAdded: [] },
		});
		expect(empty.linksModuleData).toBeUndefined();
		expect(empty.imageModulesData).toBeUndefined();
		expect(empty.valueAddedModuleData).toBeUndefined();
	});

	// publish() PUTs the existing class with this body spread over it, and
	// update replaces the whole class, so a key passlet owns has to be stated
	// to clear the value an earlier template set.
	// https://developers.google.com/wallet/reference/rest/v1/loyaltyclass/update
	it("states every key passlet owns, so a template that drops one clears it", () => {
		const body = buildClassBody({
			type: "loyalty",
			id: "bare",
			name: "Bare",
			google: { logo: LOGO_URL },
			fields: [],
		});
		expect(body).toEqual({
			programName: "Bare",
			issuerName: "Bare",
			reviewStatus: "UNDER_REVIEW",
			programLogo: LOGO,
			enableSmartTap: false,
		});
		expect(Object.keys(body).sort()).toEqual(
			[
				"appLinkData",
				"enableSmartTap",
				"heroImage",
				"hexBackgroundColor",
				"imageModulesData",
				"issuerName",
				"linksModuleData",
				"localizedIssuerName",
				"localizedProgramName",
				"merchantLocations",
				"messages",
				"programLogo",
				"programName",
				"redemptionIssuers",
				"reviewStatus",
				"valueAddedModuleData",
				"wideProgramLogo",
			].sort()
		);
	});

	it.each([
		["eventTicket", "eventName", "Festival de Verano"],
		["giftCard", "localizedMerchantName", "Tarjeta Regalo"],
		["loyalty", "localizedProgramName", "Recompensas"],
		["coupon", "localizedTitle", "20% de descuento"],
		["coupon", "localizedProvider", "20% de descuento"],
		["coupon", "localizedIssuerName", "20% de descuento"],
	] as const)("%s translates %s from locales.<lang>.name", (name, key, translation) => {
		const { pass } = FIXTURES[name];
		const body = buildClassBody({
			...pass,
			locales: { es: { name: translation }, fr: { seat: "Siège" } },
		});
		expect(body[key]).toEqual({
			defaultValue: { language: "en-US", value: pass.name },
			translatedValues: [{ language: "es", value: translation }],
		});
	});

	it("omits localizedMerchantName when no locale translates the gift card name", () => {
		const body = buildClassBody({
			...FIXTURES.giftCard.pass,
			locales: { es: { balance: "Saldo" } },
		});
		expect(body.localizedMerchantName).toBeUndefined();
	});

	it("translates the issuer name only when it is the pass name", () => {
		const body = buildClassBody({
			...FIXTURES.loyalty.pass,
			google: { logo: LOGO_URL, issuerName: "Acme Inc" },
		});
		expect(body.issuerName).toBe("Acme Inc");
		expect(body.localizedIssuerName).toBeUndefined();
	});

	it("forwards the offset on event datetimes but strips it from flight local times", () => {
		const event = buildClassBody({
			...EVENT,
			startsAt: "2026-07-15T20:00:00-04:00",
			endsAt: "2026-07-15T23:00:00-04:00",
		});
		expect(event.dateTime).toEqual({
			start: "2026-07-15T20:00:00-04:00",
			end: "2026-07-15T23:00:00-04:00",
		});

		const flight = buildClassBody({
			...FLIGHT,
			departure: "2026-07-15T08:00:00+04:00",
			arrival: "2026-07-15T11:30:00+04:00",
		});
		expect(flight).toMatchObject({
			localScheduledDepartureDateTime: "2026-07-15T08:00:00",
			localScheduledArrivalDateTime: "2026-07-15T11:30:00",
		});
	});

	describe("transitType", () => {
		function transitPass(
			transitType: BoardingPassConfig["transitType"],
			transit: GoogleTransitOptions = {}
		): ParsedTemplate {
			return {
				type: "boardingPass",
				id: "fx-transit",
				name: "Northern Line",
				transitType,
				google: { logo: LOGO_URL, transit },
				fields: [],
			};
		}

		// Google has no air TransitType, so an unset pass-level type ends up OTHER.
		it.each([
			["train", "RAIL"],
			["bus", "BUS"],
			["boat", "FERRY"],
			["generic", "OTHER"],
			[undefined, "OTHER"],
		] as const)("maps the pass transitType %s to %s", (transitType, expected) => {
			expect(buildClassBody(transitPass(transitType)).transitType).toBe(
				expected
			);
		});

		it("prefers google.transit.transitType and localizes the operator name", () => {
			const body = buildClassBody(
				transitPass("train", {
					transitType: "tram",
					operatorName: "City Transit",
				})
			);
			expect(body).toMatchObject({
				transitType: "TRAM",
				transitOperatorName: en("City Transit"),
			});
		});
	});
});
