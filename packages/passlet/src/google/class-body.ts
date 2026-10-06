import type { TemplateConfig } from "../schema/template";
import {
	buildAppLinkData,
	buildModuleData,
	imageUri,
	localized,
	toLocalDateTime,
	transitOptions,
	translationsFor,
} from "./utils";

// google.transit selects transitClass/transitObject; flightClass is air-only
// and requires IATA carrier and airport codes.
const GOOGLE_TRANSIT_TYPE = {
	bus: "BUS",
	rail: "RAIL",
	tram: "TRAM",
	ferry: "FERRY",
	other: "OTHER",
} as const;

// Fallback mapping from the cross-platform transitType when google.transit does
// not name one. Google has no air TransitType — flightClass covers that vertical.
const TRANSIT_TYPE_FROM_PASS = {
	train: "RAIL",
	bus: "BUS",
	boat: "FERRY",
	air: "OTHER",
	// Apple's PKTransitTypeGeneric has no Google counterpart.
	generic: "OTHER",
} as const;

// Flight vertical: transitClass (train, bus, tram, ferry) or the air-only
// flightClass, which represents a single flight and so carries its schedule.
function buildBoardingPassClassFields(
	template: Extract<TemplateConfig, { type: "boardingPass" }>
): Record<string, unknown> {
	const transit = template.google?.transit;
	if (transit) {
		return {
			// transitType is required by transitClass
			transitType: transit.transitType
				? GOOGLE_TRANSIT_TYPE[transit.transitType]
				: TRANSIT_TYPE_FROM_PASS[template.transitType ?? "air"],
			transitOperatorName: transit.operatorName
				? localized(transit.operatorName)
				: undefined,
		};
	}
	return {
		flightHeader: {
			carrier: { carrierIataCode: template.carrier },
			flightNumber: template.flightNumber,
			operatingCarrier: { carrierIataCode: template.carrier },
			operatingFlightNumber: template.flightNumber,
		},
		localScheduledDepartureDateTime: template.departure
			? toLocalDateTime(template.departure)
			: undefined,
		// localScheduledArrivalDateTime is a top-level flightClass field, not
		// part of the destination AirportInfo (which only carries airport data).
		localScheduledArrivalDateTime: template.arrival
			? toLocalDateTime(template.arrival)
			: undefined,
		origin: template.origin ? { airportIataCode: template.origin } : undefined,
		destination: template.destination
			? { airportIataCode: template.destination }
			: undefined,
	};
}

function buildClassTypeFields(
	template: TemplateConfig
): Record<string, unknown> {
	if (template.type === "loyalty") {
		return { programName: template.name };
	}
	if (template.type === "eventTicket") {
		return {
			eventName: localized(
				template.name,
				"en-US",
				translationsFor("name", template.locales)
			),
			// EventDateTime uses the UTC offset to resolve the instant.
			dateTime: template.startsAt
				? { start: template.startsAt, end: template.endsAt }
				: undefined,
			// Google requires both name and address when venue is present
			venue: template.venue
				? {
						name: localized(template.venue.name),
						address: localized(template.venue.address),
					}
				: undefined,
		};
	}
	if (template.type === "boardingPass") {
		return buildBoardingPassClassFields(template);
	}
	if (template.type === "coupon") {
		return {
			title: template.name,
			// provider is required by Google offerClass — defaults to the pass name
			provider: template.name,
			redemptionChannel: template.redemptionChannel.toUpperCase(),
		};
	}
	if (template.type === "giftCard") {
		// giftCardClass has no cardTitle — merchantName is a plain string, and
		// the API rejects a LocalizedString there; translations belong in
		// localizedMerchantName.
		const translations = translationsFor("name", template.locales);
		return {
			merchantName: template.name,
			localizedMerchantName:
				translations && localized(template.name, "en-US", translations),
		};
	}
	// Generic branding belongs on genericObject.
	return {};
}

function assignImages(
	target: Record<string, unknown>,
	logoKey: string,
	wideLogoKey: string,
	logo: unknown,
	wideLogo: unknown
): void {
	if (logo) {
		target[logoKey] = logo;
	}
	if (wideLogo) {
		target[wideLogoKey] = wideLogo;
	}
}

// flightClass is the one class that hides its images inside flightHeader.carrier
function applyFlightCarrierImages(
	body: Record<string, unknown>,
	logo: unknown,
	wideLogo: unknown
): void {
	const header = (body.flightHeader ?? {}) as Record<string, unknown>;
	const carrier = (header.carrier ?? {}) as Record<string, unknown>;
	assignImages(carrier, "airlineLogo", "wideAirlineLogo", logo, wideLogo);
	header.carrier = carrier;
	body.flightHeader = header;
}

// Place the logo/wide-logo images on the field names each class type defines.
// Every class type names its images differently; a wrong name is silently
// dropped by the API, so the image never renders.
function applyClassImages(
	body: Record<string, unknown>,
	template: TemplateConfig,
	logo: unknown,
	wideLogo: unknown
): void {
	switch (template.type) {
		case "loyalty":
		case "giftCard":
			assignImages(body, "programLogo", "wideProgramLogo", logo, wideLogo);
			return;
		case "eventTicket":
			assignImages(body, "logo", "wideLogo", logo, wideLogo);
			return;
		case "coupon":
			assignImages(body, "titleImage", "wideTitleImage", logo, wideLogo);
			return;
		case "boardingPass":
			// transitClass names its images logo/wideLogo like most other classes;
			// only flightClass hides them inside flightHeader.carrier.
			if (transitOptions(template)) {
				assignImages(body, "logo", "wideLogo", logo, wideLogo);
			} else {
				applyFlightCarrierImages(body, logo, wideLogo);
			}
			return;
		default:
			// generic: genericClass has no image fields — images go on the object
			return;
	}
}

export function buildClassBody(
	template: TemplateConfig
): Record<string, unknown> {
	const logo = imageUri(template.google?.logo);
	const wideLogo = imageUri(template.google?.wideLogo);
	const hero = imageUri(template.google?.hero);

	const body = buildClassTypeFields(template);

	// genericClass rejects or ignores branding; it belongs on genericObject.
	if (template.type !== "generic") {
		body.hexBackgroundColor = template.color;
		body.issuerName = template.google?.issuerName ?? template.name;
		if (hero) {
			body.heroImage = hero;
		}
		body.reviewStatus = template.google?.reviewStatus ?? "UNDER_REVIEW";
		if (template.google?.messages) {
			body.messages = template.google.messages;
		}
		if (template.google?.appLinkData) {
			body.appLinkData = buildAppLinkData(template.google.appLinkData);
		}
	}
	applyClassImages(body, template, logo, wideLogo);
	if (template.google?.enableSmartTap) {
		body.enableSmartTap = template.google.enableSmartTap;
	}
	if (template.google?.redemptionIssuers) {
		body.redemptionIssuers = template.google.redemptionIssuers;
	}
	// Deprecated locations[] cannot trigger geo notifications.
	// merchantLocations supports up to ten locations per class.
	if (template.locations?.length) {
		body.merchantLocations = template.locations.map(
			({ latitude, longitude }) => ({
				latitude,
				longitude,
			})
		);
	}

	Object.assign(body, buildModuleData(template.google));

	return body;
}
