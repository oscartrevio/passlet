import type { ParsedTemplate } from "../schema/template";
import {
	buildAppLinkData,
	buildModuleData,
	type GoogleImage,
	imageUri,
	localized,
	toLocalDateTime,
	translationsFor,
} from "./utils";

// google.transit selects transitClass; its transitType is required.
// https://developers.google.com/wallet/reference/rest/v1/transitclass
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

// The localized twin of a plain-string name field, carrying the template
// name's translations; absent when no locale translates the name.
function localizedName(template: ParsedTemplate) {
	const translations = translationsFor("name", template.locales);
	return translations && localized(template.name, translations);
}

// flightClass represents a single flight, so it carries its schedule, and
// keeps its images inside the carrier.
// https://developers.google.com/wallet/reference/rest/v1/flightclass
function flightClassFields(
	template: Extract<ParsedTemplate, { type: "boardingPass" }>,
	logo: GoogleImage | undefined,
	wideLogo: GoogleImage | undefined
) {
	return {
		flightHeader: {
			carrier: {
				carrierIataCode: template.carrier,
				airlineLogo: logo,
				wideAirlineLogo: wideLogo,
			},
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

/**
 * The fields only this template's class type has, images included: every
 * class type names its logo and wide logo differently, and Google silently
 * drops an image under the wrong name.
 */
function verticalClassFields(template: ParsedTemplate) {
	const logo = imageUri(template.google?.logo);
	const wideLogo = imageUri(template.google?.wideLogo);
	switch (template.type) {
		case "loyalty":
			// https://developers.google.com/wallet/reference/rest/v1/loyaltyclass
			return {
				programName: template.name,
				localizedProgramName: localizedName(template),
				programLogo: logo,
				wideProgramLogo: wideLogo,
			};
		case "giftCard":
			// giftCardClass has no cardTitle — merchantName is a plain string, and
			// the API rejects a LocalizedString there; translations belong in
			// localizedMerchantName.
			return {
				merchantName: template.name,
				localizedMerchantName: localizedName(template),
				programLogo: logo,
				wideProgramLogo: wideLogo,
			};
		case "eventTicket":
			return {
				eventName: localized(
					template.name,
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
				logo,
				wideLogo,
			};
		case "coupon":
			// https://developers.google.com/wallet/reference/rest/v1/offerclass
			return {
				title: template.name,
				localizedTitle: localizedName(template),
				// provider is required by Google offerClass — defaults to the pass name
				provider: template.name,
				localizedProvider: localizedName(template),
				redemptionChannel: template.redemptionChannel.toUpperCase(),
				titleImage: logo,
				wideTitleImage: wideLogo,
			};
		case "boardingPass": {
			const transit = template.google?.transit;
			if (transit) {
				return {
					transitType: transit.transitType
						? GOOGLE_TRANSIT_TYPE[transit.transitType]
						: TRANSIT_TYPE_FROM_PASS[template.transitType ?? "air"],
					transitOperatorName: transit.operatorName
						? localized(transit.operatorName)
						: undefined,
					logo,
					wideLogo,
				};
			}
			return flightClassFields(template, logo, wideLogo);
		}
		case "generic":
			// genericClass has no title or images; they live on genericObject.
			// https://developers.google.com/wallet/reference/rest/v1/genericclass
			return {};
		default:
			return template satisfies never;
	}
}

/**
 * The class as passlet owns it. Every key passlet can set for the class type
 * is present, `undefined` when the template leaves it unset, so publish()
 * clears what the template no longer has; keys passlet never sets are absent
 * and keep their remote values.
 */
export function buildClassBody(
	template: ParsedTemplate
): Record<string, unknown> {
	const google = template.google;
	return {
		...verticalClassFields(template),
		// genericClass has no branding fields; genericObject carries them.
		...(template.type !== "generic" && {
			hexBackgroundColor: template.color,
			issuerName: google?.issuerName ?? template.name,
			// Name translations apply only when the issuer name is the pass name.
			localizedIssuerName: google?.issuerName
				? undefined
				: localizedName(template),
			heroImage: imageUri(google?.hero),
			reviewStatus: google?.reviewStatus ?? "UNDER_REVIEW",
			// "If AppLinkData is provided for the corresponding object that will be
			// used instead", and generic writes it on the object.
			// https://developers.google.com/wallet/reference/rest/v1/genericclass
			appLinkData: buildAppLinkData(google?.appLinkData),
		}),
		messages: google?.messages,
		// Stated even when false, so publish() turns Smart Tap off again.
		enableSmartTap: google?.enableSmartTap ?? false,
		redemptionIssuers: google?.redemptionIssuers,
		// Deprecated locations[] cannot trigger geo notifications.
		// merchantLocations supports up to ten locations per class.
		merchantLocations: template.locations?.length
			? template.locations.map(({ latitude, longitude }) => ({
					latitude,
					longitude,
				}))
			: undefined,
		...buildModuleData(google),
	};
}
