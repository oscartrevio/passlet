import { describe, expect, it } from "vitest";
import type { WalletErrorCode } from "../../../src/errors";
import {
	buildClassBody,
	validateGoogleRequirements,
} from "../../../src/providers/google/index";
import type {
	GoogleTransitOptions,
	PassConfig,
} from "../../../src/types/schemas";
import { FIXTURES, type FixtureName } from "../../support/fixtures";
import { LOGO_URL } from "../../support/google";
import {
	assertGoogleSchema,
	assertRequiredKeys,
	type GoogleResource,
} from "../../support/google-schema";

type FlightPass = Extract<PassConfig, { type: "flight" }>;

const LOGO = { sourceUri: { uri: LOGO_URL } };

function en(value: string) {
	return { defaultValue: { language: "en-US", value } };
}

function walletError(code: WalletErrorCode) {
	return expect.objectContaining({ code });
}

const EVENT = FIXTURES.event.pass;
const FLIGHT = FIXTURES.flight.pass;
if (EVENT.type !== "event" || FLIGHT.type !== "flight") {
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
		// title is a plain string, so the fixture's locales do not reach it.
		body: {
			programName: "Acme Rewards",
			hexBackgroundColor: "#1a1a2e",
			issuerName: "Acme Rewards",
			reviewStatus: "UNDER_REVIEW",
			programLogo: LOGO,
		},
	},
	event: {
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
		},
	},
	flight: {
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
		},
	},
	generic: {
		resource: "genericClass",
		required: [],
		// genericClass has no branding fields at all; they live on the object.
		body: {},
	},
};

describe("buildClassBody", () => {
	describe.each(Object.keys(GOLDEN) as FixtureName[])("%s", (name) => {
		const { resource, required, body: expected } = GOLDEN[name];

		it(`builds exactly the expected ${resource}`, () => {
			const { pass } = FIXTURES[name];
			expect(() => validateGoogleRequirements(pass)).not.toThrow();
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
		expect(empty).not.toHaveProperty("linksModuleData");
		expect(empty).not.toHaveProperty("imageModulesData");
		expect(empty).not.toHaveProperty("valueAddedModuleData");
	});

	it.each([
		["event", "eventName", "Festival de Verano"],
		["giftCard", "localizedMerchantName", "Tarjeta Regalo"],
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
			transitType: FlightPass["transitType"],
			transit: GoogleTransitOptions = {}
		): PassConfig {
			return {
				type: "flight",
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

describe("validateGoogleRequirements", () => {
	it("requires google.logo on loyalty and transit passes but not on an air flight", () => {
		expect(() =>
			validateGoogleRequirements({
				type: "loyalty",
				id: "l",
				name: "Rewards",
				fields: [],
			})
		).toThrow(walletError("GOOGLE_MISSING_LOGO"));
		expect(() =>
			validateGoogleRequirements({
				type: "flight",
				id: "t",
				name: "Bus",
				google: { transit: {} },
				fields: [],
			})
		).toThrow(walletError("GOOGLE_MISSING_LOGO"));
		expect(() =>
			validateGoogleRequirements({ ...FLIGHT, google: undefined })
		).not.toThrow();
	});

	it("requires the IATA class fields on an air flight but not on a transit pass", () => {
		expect(() =>
			validateGoogleRequirements({ ...FLIGHT, departure: undefined })
		).toThrow(walletError("GOOGLE_FLIGHT_MISSING_CLASS_FIELDS"));
		expect(() =>
			validateGoogleRequirements({
				...FLIGHT,
				departure: undefined,
				google: { logo: LOGO_URL, transit: {} },
			})
		).not.toThrow();
	});
});
