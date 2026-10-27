import type {
	AppLinkData,
	GoogleModules,
	GoogleTransitOptions,
} from "../schema/google";
import type { BarcodeFormat, Locales } from "../schema/parts";
import type { ParsedTemplate, TemplateType } from "../schema/template";

/** Google's `Image`: an image Google downloads from `sourceUri.uri`. */
export interface GoogleImage {
	sourceUri: { uri: string };
}

/** The Wallet API resource family a template writes: `${vertical}Class`, `${vertical}Object`. */
export type GoogleVertical =
	| "loyalty"
	| "eventTicket"
	| "flight"
	| "offer"
	| "giftCard"
	| "generic"
	| "transit";

const VERTICAL = {
	loyalty: "loyalty",
	eventTicket: "eventTicket",
	boardingPass: "flight",
	coupon: "offer",
	giftCard: "giftCard",
	generic: "generic",
} as const satisfies Record<TemplateType, GoogleVertical>;

// google.transit selects transitClass/transitObject; flightClass is air-only
// and requires IATA carrier and airport codes.
export function vertical(template: ParsedTemplate): GoogleVertical {
	return transitOptions(template) ? "transit" : VERTICAL[template.type];
}

export function transitOptions(
	template: ParsedTemplate
): GoogleTransitOptions | undefined {
	return template.type === "boardingPass"
		? template.google?.transit
		: undefined;
}

// https://developers.google.com/wallet/reference/rest/v1/BarcodeType
export const GOOGLE_BARCODE_TYPE = {
	QR: "QR_CODE",
	PDF417: "PDF_417",
	Aztec: "AZTEC",
	Code128: "CODE_128",
	Code39: "CODE_39",
	Codabar: "CODABAR",
	EAN13: "EAN_13",
	ITF: "ITF_14",
} as const satisfies Record<BarcodeFormat, string>;

const UTC_OFFSET_RE = /(Z|[+-]\d{2}:\d{2})$/;

// Flight datetimes are airport-local; Google derives the zone from the airport.
// Strip Z or ±HH:MM without shifting the wall clock. EventDateTime accepts
// and uses offsets, so event datetimes must bypass this conversion.
export function toLocalDateTime(iso: string): string {
	return iso.replace(UTC_OFFSET_RE, "");
}

interface TranslatedValue {
	language: string;
	value: string;
}

interface LocalizedString {
	defaultValue: TranslatedValue;
	translatedValues: TranslatedValue[] | undefined;
}

export function localized(
	value: string,
	translatedValues?: TranslatedValue[]
): LocalizedString {
	return {
		defaultValue: { language: "en-US", value },
		translatedValues: translatedValues?.length ? translatedValues : undefined,
	};
}

// Locale field keys translate labels; "<key>_value" translates field values.
export function translationsFor(
	key: string,
	locales: Locales | undefined
): TranslatedValue[] | undefined {
	if (!locales) {
		return;
	}
	const result = Object.entries(locales).flatMap(([language, strings]) => {
		const value = strings[key];
		return value === undefined ? [] : [{ language, value }];
	});
	return result.length > 0 ? result : undefined;
}

export function imageUri(url: string | undefined): GoogleImage | undefined {
	return url ? { sourceUri: { uri: url } } : undefined;
}

/**
 * Class and object modules share Google's payload shapes. Every module key is
 * present, `undefined` when its list is empty, so a write clears it.
 */
export function buildModuleData(modules: GoogleModules | undefined) {
	return {
		linksModuleData: modules?.links?.length
			? {
					uris: modules.links.map((link) => ({
						uri: link.uri,
						description: link.description,
						id: link.id,
					})),
				}
			: undefined,
		imageModulesData: modules?.images?.length
			? modules.images.map((image) => ({
					mainImage: imageUri(image.url),
					id: image.id,
				}))
			: undefined,
		valueAddedModuleData: modules?.valueAdded?.length
			? modules.valueAdded.map((module) => ({
					header: localized(module.header),
					body: module.body ? localized(module.body) : undefined,
					uri: module.uri,
					image: imageUri(module.imageUrl),
					sortIndex: module.sortIndex,
				}))
			: undefined,
	};
}

// Android opens by package name; a web link carries the description Google
// requires on an app target URI.
// https://developers.google.com/wallet/reference/rest/v1/AppLinkData#AppTarget
export function buildAppLinkData(d: AppLinkData | undefined) {
	return d
		? {
				androidAppLinkInfo: d.android
					? { appTarget: { packageName: d.android.packageName } }
					: undefined,
				webAppLinkInfo: d.web
					? {
							appTarget: {
								targetUri: { uri: d.web.uri, description: d.web.description },
							},
						}
					: undefined,
				displayText: d.displayText ? localized(d.displayText) : undefined,
			}
		: undefined;
}

/**
 * The PATCH body for a write: every `undefined` field becomes `null`. Google
 * merges a PATCH into the stored resource, recursing into nested objects, so
 * an omitted field keeps its old value and only `null` clears it. Lists are
 * replaced whole, so their entries are sent as they are.
 * https://developers.google.com/wallet/retail/loyalty-cards/use-cases/updates
 */
export function patchBody(body: object): Record<string, unknown> {
	const patch: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(body)) {
		if (value === undefined) {
			patch[key] = null;
		} else if (
			typeof value === "object" &&
			value !== null &&
			!Array.isArray(value)
		) {
			patch[key] = patchBody(value);
		} else {
			patch[key] = value;
		}
	}
	return patch;
}
