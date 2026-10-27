import { describe, expect, it } from "vitest";
import { buildClassBody } from "../../../src/google/class-body";
import { patchBody } from "../../../src/google/utils";
import type { GoogleTransitOptions } from "../../../src/schema/google";
import type { ParsedTemplate } from "../../../src/schema/template";
import { FIXTURES, type FixtureName } from "../../support/fixtures";
import { applyGooglePatch, LOGO_URL } from "../../support/google";
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
		// genericClass has no title, images or branding; genericObject has them.
		body: { enableSmartTap: false },
	},
};

const EXAMPLE_IMAGE = "https://example.com/image.png";

// Everything passlet can put on a class, so a later publish that leaves it
// out shows whether the field is cleared or left stale.
function rich(pass: ParsedTemplate): ParsedTemplate {
	const google: NonNullable<ParsedTemplate["google"]> = {
		logo: LOGO_URL,
		wideLogo: EXAMPLE_IMAGE,
		hero: EXAMPLE_IMAGE,
		messages: [{ header: "Hi", body: "All holders", messageType: "TEXT" }],
		appLinkData: {
			android: { packageName: "com.example.app" },
			web: { uri: "https://example.com", description: "Your account" },
			displayText: "Open the app",
		},
		enableSmartTap: true,
		redemptionIssuers: ["3388000000022801234"],
		links: [{ uri: "https://example.com/terms", description: "Terms" }],
		images: [{ url: EXAMPLE_IMAGE, id: "banner" }],
		valueAdded: [
			{ header: "Perks", body: "See all", uri: "https://example.com/perks" },
		],
	};
	const common = {
		color: "#000000",
		locales: { es: { name: "Nombre" } },
		locations: [{ latitude: 1, longitude: 2 }],
	};
	if (pass.type !== "boardingPass") {
		return { ...pass, ...common, google };
	}
	const transit = pass.google?.transit;
	return {
		...pass,
		...common,
		google: {
			...google,
			transit: transit && { ...transit, operatorName: "City Transit" },
		},
	};
}

// Only what each class type requires.
function sparse(pass: ParsedTemplate): ParsedTemplate {
	const common = {
		color: undefined,
		locales: undefined,
		locations: undefined,
		google: { logo: LOGO_URL },
	};
	switch (pass.type) {
		case "eventTicket":
			return {
				...pass,
				...common,
				startsAt: undefined,
				endsAt: undefined,
				venue: undefined,
			};
		case "boardingPass":
			return {
				...pass,
				...common,
				arrival: undefined,
				google: { logo: LOGO_URL, transit: pass.google?.transit && {} },
			};
		default:
			return { ...pass, ...common };
	}
}

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

	// genericClass documents messages[] like every other class.
	// https://developers.google.com/wallet/reference/rest/v1/genericclass
	it("carries a generic template's class-level messages", () => {
		const messages = [
			{
				header: "Welcome",
				body: "Show this card",
				messageType: "TEXT" as const,
			},
		];
		const body = buildClassBody({
			...FIXTURES.generic.pass,
			google: { logo: LOGO_URL, messages },
		});
		assertGoogleSchema("genericClass", body);
		expect(body.messages).toEqual(messages);
	});

	// Google's own example: an Android package name, a web URI with its
	// description, and the button's display text.
	// https://developers.google.com/wallet/retail/loyalty-cards/use-cases/link-from-loyalty-card
	it("writes app links the way Google documents them", () => {
		const body = buildClassBody({
			...FIXTURES.loyalty.pass,
			google: {
				logo: LOGO_URL,
				appLinkData: {
					android: { packageName: "com.google.android.gm" },
					web: {
						uri: "https://mail.google.com/mail/",
						description: "Web link for Gmail",
					},
					displayText: "Our awesome app!",
				},
			},
		});
		assertGoogleSchema("loyaltyClass", body);
		expect(body.appLinkData).toEqual({
			androidAppLinkInfo: {
				appTarget: { packageName: "com.google.android.gm" },
			},
			webAppLinkInfo: {
				appTarget: {
					targetUri: {
						uri: "https://mail.google.com/mail/",
						description: "Web link for Gmail",
					},
				},
			},
			displayText: {
				defaultValue: { language: "en-US", value: "Our awesome app!" },
			},
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

	// publish() patches the class: nested objects merge and only null clears,
	// so every key passlet owns has to be stated to clear the value an earlier
	// template set, at every depth.
	// https://developers.google.com/wallet/reference/rest/v1/loyaltyclass/patch
	describe.each(
		Object.keys(FIXTURES) as FixtureName[]
	)("publishing %s over a richer class", (name) => {
		const { pass } = FIXTURES[name];
		const stored = JSON.parse(JSON.stringify(buildClassBody(rich(pass))));

		it("leaves exactly the sparser template's class", () => {
			const body = buildClassBody(sparse(pass));
			expect(applyGooglePatch(stored, patchBody(body))).toEqual(body);
		});
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
