import { WalletError } from "../../errors";
import type { GoogleCredentials } from "../../types/credentials";
import type {
	AppLinkData,
	CreateConfig,
	FieldDef,
	GoogleModules,
	GoogleTransitOptions,
	PassConfig,
	PassType,
	UpdateOptions,
} from "../../types/schemas";
import type { GoogleClassType, GoogleObjectType } from "./api";
import { deleteObject, ensureClass, importGoogleKey, patchObject } from "./api";
import {
	imageUri,
	localized,
	toGoogleBarcodeType,
	toLocalDateTime,
	translationsFor,
} from "./utils";

// Google Wallet class type per pass type
const CLASS_TYPE = {
	loyalty: "loyaltyClass",
	event: "eventTicketClass",
	flight: "flightClass",
	coupon: "offerClass",
	giftCard: "giftCardClass",
	generic: "genericClass",
} as const satisfies Record<PassType, string>;

// Google Wallet object type per pass type
const OBJECT_TYPE = {
	loyalty: "loyaltyObject",
	event: "eventTicketObject",
	flight: "flightObject",
	coupon: "offerObject",
	giftCard: "giftCardObject",
	generic: "genericObject",
} as const satisfies Record<PassType, string>;

// Transit vertical. A flight pass carrying google.transit is issued as
// transitClass/transitObject instead of flightClass/flightObject, which is
// air-only (it requires IATA carrier and airport codes).
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
	// Apple's PKTransitTypeGeneric has no Google counterpart — OTHER is the
	// catch-all transitType
	generic: "OTHER",
} as const;

function transitOptions(pass: PassConfig): GoogleTransitOptions | undefined {
	return pass.type === "flight" ? pass.google?.transit : undefined;
}

function googleClassType(pass: PassConfig): GoogleClassType {
	return transitOptions(pass) ? "transitClass" : CLASS_TYPE[pass.type];
}

function googleObjectType(pass: PassConfig): GoogleObjectType {
	return transitOptions(pass) ? "transitObject" : OBJECT_TYPE[pass.type];
}

function resolveFieldValue(
	field: FieldDef,
	values: Record<string, string | null>
): string | undefined {
	const value = field.key in values ? values[field.key] : field.value;
	return value === null || value === undefined ? undefined : value;
}

function resolveValueByKey(
	fields: FieldDef[],
	values: Record<string, string | null>,
	key: string
): string | undefined {
	const match = fields.find((field) => field.key === key);
	if (!match) {
		return;
	}
	return resolveFieldValue(match, values);
}

function googleObjectRef(
	credentials: GoogleCredentials,
	pass: PassConfig,
	serialNumber: string
) {
	return {
		objectType: googleObjectType(pass),
		objectId: `${credentials.issuerId}.${serialNumber}`,
	};
}

function validateGoogleRequirements(pass: PassConfig): void {
	// Google loyalty classes require a programLogo URL — the API returns 400 without it
	if (pass.type === "loyalty" && !pass.google?.logo) {
		throw new WalletError(
			"GOOGLE_MISSING_LOGO",
			"Google Wallet loyalty passes require a logo URL (programLogo) in google.logo"
		);
	}
	if (pass.type === "flight") {
		if (pass.google?.transit) {
			// transitClass requires logo, transitType, issuerName, and reviewStatus.
			// transitType is always derived, the other two are always emitted — only
			// the logo can be missing. The IATA flightClass fields do not apply.
			if (!pass.google.logo) {
				throw new WalletError(
					"GOOGLE_MISSING_LOGO",
					"Google Wallet transit passes require a logo URL in google.logo"
				);
			}
			return;
		}
		const { carrier, flightNumber, origin, destination, departure } = pass;
		// Google flightClass requires all of these — localScheduledDepartureDateTime
		// (departure) is a required scalar the API rejects the class without.
		if (!(carrier && flightNumber && origin && destination && departure)) {
			throw new WalletError(
				"GOOGLE_FLIGHT_MISSING_CLASS_FIELDS",
				"Flight passes require carrier, flightNumber, origin, destination, and departure"
			);
		}
	}
}

// Build textModulesData from fields not in excluded slots
function buildTextModules(
	fields: FieldDef[],
	values: Record<string, string | null>,
	excludeSlots: FieldDef["slot"][],
	excludeKeys: string[] = []
): Array<{ header: string; body: string; id: string }> {
	const modules: Array<{ header: string; body: string; id: string }> = [];
	for (const f of fields) {
		if (excludeSlots.includes(f.slot)) {
			continue;
		}
		if (excludeKeys.includes(f.key)) {
			continue;
		}
		const value = resolveFieldValue(f, values);
		if (value === undefined) {
			continue;
		}
		// label is optional on Apple; Google's textModulesData needs a header, so
		// fall back to the field key.
		modules.push({ header: f.label ?? f.key, body: value, id: f.key });
	}
	return modules;
}

// Build the linksModuleData / imageModulesData / valueAddedModuleData block.
// These modules exist on every Google class and object with identical shapes,
// so the same builder serves both levels.
function buildModuleData(modules: GoogleModules): Record<string, unknown> {
	const body: Record<string, unknown> = {};
	if (modules.links?.length) {
		body.linksModuleData = {
			uris: modules.links.map((link) => ({
				uri: link.uri,
				description: link.description,
				id: link.id,
			})),
		};
	}
	if (modules.images?.length) {
		body.imageModulesData = modules.images.map((image) => ({
			mainImage: imageUri(image.url),
			id: image.id,
		}));
	}
	if (modules.valueAdded?.length) {
		body.valueAddedModuleData = modules.valueAdded.map((module) => ({
			header: localized(module.header),
			body: module.body ? localized(module.body) : undefined,
			uri: module.uri,
			image: imageUri(module.imageUrl),
			sortIndex: module.sortIndex,
		}));
	}
	return body;
}

// Flight vertical: transitClass (train, bus, tram, ferry) or the air-only
// flightClass, which represents a single flight and so carries its schedule.
function buildFlightClassFields(
	pass: Extract<PassConfig, { type: "flight" }>
): Record<string, unknown> {
	const transit = pass.google?.transit;
	if (transit) {
		return {
			// transitType is required by transitClass
			transitType: transit.transitType
				? GOOGLE_TRANSIT_TYPE[transit.transitType]
				: TRANSIT_TYPE_FROM_PASS[pass.transitType ?? "air"],
			transitOperatorName: transit.operatorName
				? localized(transit.operatorName)
				: undefined,
		};
	}
	return {
		flightHeader: {
			carrier: { carrierIataCode: pass.carrier },
			flightNumber: pass.flightNumber,
			operatingCarrier: { carrierIataCode: pass.carrier },
			operatingFlightNumber: pass.flightNumber,
		},
		localScheduledDepartureDateTime: pass.departure
			? toLocalDateTime(pass.departure)
			: undefined,
		// localScheduledArrivalDateTime is a top-level flightClass field, not
		// part of the destination AirportInfo (which only carries airport data).
		localScheduledArrivalDateTime: pass.arrival
			? toLocalDateTime(pass.arrival)
			: undefined,
		origin: pass.origin ? { airportIataCode: pass.origin } : undefined,
		destination: pass.destination
			? { airportIataCode: pass.destination }
			: undefined,
	};
}

// Per-type class name fields
function buildClassTypeFields(
	pass: PassConfig,
	locales: PassConfig["locales"]
): Record<string, unknown> {
	const nameTranslations = translationsFor("name", locales);
	if (pass.type === "loyalty") {
		return { programName: pass.name };
	}
	if (pass.type === "event") {
		return {
			eventName: localized(pass.name, "en-US", nameTranslations),
			// EventDateTime accepts an ISO 8601 datetime "with or without an
			// offset" and uses the offset to resolve the instant, so the original
			// string is forwarded verbatim rather than stripped to local time.
			dateTime: pass.startsAt
				? { start: pass.startsAt, end: pass.endsAt }
				: undefined,
			// Google requires both name and address when venue is present
			venue: pass.venue
				? {
						name: localized(pass.venue.name),
						address: localized(pass.venue.address),
					}
				: undefined,
		};
	}
	if (pass.type === "flight") {
		return buildFlightClassFields(pass);
	}
	if (pass.type === "coupon") {
		return {
			title: pass.name,
			// provider is required by Google offerClass — defaults to the pass name
			provider: pass.name,
			redemptionChannel: pass.redemptionChannel.toUpperCase(),
		};
	}
	if (pass.type === "giftCard") {
		// giftCardClass has no cardTitle — the merchant/title slot is merchantName
		return { merchantName: localized(pass.name, "en-US", nameTranslations) };
	}
	// generic: genericClass has no title/branding fields at all — cardTitle,
	// colors, and images all live on genericObject (see buildObjectBody).
	return {};
}

// Build a Google Wallet AppLinkInfo sub-object from our simplified schema shape.
function buildAppLinkInfo(info: {
	uri: string;
	title?: string;
	description?: string;
	logoUrl?: string;
}): Record<string, unknown> {
	return {
		appLogoImage: imageUri(info.logoUrl),
		title: info.title ? localized(info.title) : undefined,
		description: info.description ? localized(info.description) : undefined,
		appTarget: { targetUri: { uri: info.uri } },
	};
}

function buildAppLinkData(d: AppLinkData): Record<string, unknown> {
	return {
		androidAppLinkInfo: d.android ? buildAppLinkInfo(d.android) : undefined,
		iosAppLinkInfo: d.ios ? buildAppLinkInfo(d.ios) : undefined,
		webAppLinkInfo: d.web ? buildAppLinkInfo(d.web) : undefined,
	};
}

// Assign a logo/wide-logo pair onto the two field names a class type uses.
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
	pass: PassConfig,
	logo: unknown,
	wideLogo: unknown
): void {
	switch (pass.type) {
		case "loyalty":
		case "giftCard":
			assignImages(body, "programLogo", "wideProgramLogo", logo, wideLogo);
			return;
		case "event":
			assignImages(body, "logo", "wideLogo", logo, wideLogo);
			return;
		case "coupon":
			assignImages(body, "titleImage", "wideTitleImage", logo, wideLogo);
			return;
		case "flight":
			// transitClass names its images logo/wideLogo like most other classes;
			// only flightClass hides them inside flightHeader.carrier.
			if (transitOptions(pass)) {
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

// Build the class body — defines the pass template (shared across all recipients)
function buildClassBody(pass: PassConfig): Record<string, unknown> {
	const logo = imageUri(pass.google?.logo);
	const wideLogo = imageUri(pass.google?.wideLogo);
	const hero = imageUri(pass.google?.hero);

	const body: Record<string, unknown> = {
		...buildClassTypeFields(pass, pass.locales),
	};

	// genericClass defines none of the branding fields — colors, issuer name,
	// hero image, review status, and messages are rejected or ignored there.
	// For generic passes those all live on genericObject (see buildObjectBody).
	if (pass.type !== "generic") {
		body.hexBackgroundColor = pass.color;
		body.issuerName = pass.google?.issuerName ?? pass.name;
		if (hero) {
			body.heroImage = hero;
		}
		body.reviewStatus = pass.google?.reviewStatus ?? "UNDER_REVIEW";
		if (pass.google?.messages) {
			body.messages = pass.google.messages;
		}
		if (pass.google?.appLinkData) {
			body.appLinkData = buildAppLinkData(pass.google.appLinkData);
		}
	}
	applyClassImages(body, pass, logo, wideLogo);
	if (pass.google?.enableSmartTap) {
		body.enableSmartTap = pass.google.enableSmartTap;
	}
	if (pass.google?.redemptionIssuers) {
		body.redemptionIssuers = pass.google.redemptionIssuers;
	}
	// merchantLocations replaces the deprecated locations[]: Google documents the
	// old field as "currently not supported to trigger geo notifications", so
	// sending it is a silent no-op. Max ten per class.
	if (pass.locations?.length) {
		body.merchantLocations = pass.locations.map(({ latitude, longitude }) => ({
			latitude,
			longitude,
		}));
	}

	// Class-level links, images, and value-added modules
	Object.assign(
		body,
		buildModuleData({
			links: pass.google?.links,
			images: pass.google?.images,
			valueAdded: pass.google?.valueAdded,
		})
	);

	return body;
}

// Loyalty: map well-known field keys to structured loyalty fields
function buildLoyaltyObjectFields(
	fields: FieldDef[],
	values: Record<string, string | null>
): Record<string, unknown> {
	const points = resolveValueByKey(fields, values, "points");
	const member = resolveValueByKey(fields, values, "member");
	const memberId = resolveValueByKey(fields, values, "memberId");
	return {
		loyaltyPoints: points == null ? undefined : { balance: { string: points } },
		accountName: member ?? undefined,
		accountId: memberId ?? undefined,
	};
}

// Flight: structured boarding data required by Google flightObject
function buildFlightObjectFields(
	_pass: Extract<PassConfig, { type: "flight" }>,
	serialNumber: string,
	values: Record<string, string | null>
): Record<string, unknown> {
	const passengerName = values.passengerName;
	// passengerName is required by flightObject — Google rejects an empty value,
	// so fail fast rather than sending a blank string.
	if (!passengerName) {
		throw new WalletError("GOOGLE_FLIGHT_MISSING_PASSENGER_NAME");
	}
	return {
		passengerName,
		reservationInfo: { confirmationCode: serialNumber },
	};
}

// Transit: transitObject requires tripType. Origin/destination and times are
// carried by ticketLeg rather than the class, unlike the flight vertical.
function buildTransitObjectFields(
	pass: Extract<PassConfig, { type: "flight" }>,
	transit: GoogleTransitOptions,
	createConfig: CreateConfig,
	values: Record<string, string | null>
): Record<string, unknown> {
	const originName = transit.originName ?? pass.origin;
	const destinationName = transit.destinationName ?? pass.destination;
	// TicketLeg times are documented as ISO 8601 "with or without an offset" —
	// unlike flightClass local times, so they are forwarded verbatim.
	const ticketLeg: Record<string, unknown> = {
		originName: originName ? localized(originName) : undefined,
		destinationName: destinationName ? localized(destinationName) : undefined,
		departureDateTime: pass.departure,
		arrivalDateTime: pass.arrival,
	};
	const hasLeg = Object.values(ticketLeg).some((v) => v !== undefined);
	// A per-recipient tripType wins over the class-level default.
	const tripType =
		createConfig.google?.tripType ?? transit.tripType ?? "oneWay";
	return {
		tripType: tripType === "roundTrip" ? "ROUND_TRIP" : "ONE_WAY",
		ticketNumber: transit.ticketNumber,
		passengerNames: values.passengerName ?? undefined,
		ticketLeg: hasLeg ? ticketLeg : undefined,
	};
}

// GiftCard: card number (required by Google) plus balance amount with currency
function buildGiftCardObjectFields(
	pass: Extract<PassConfig, { type: "giftCard" }>,
	fields: FieldDef[],
	values: Record<string, string | null>,
	serialNumber: string
): Record<string, unknown> {
	const raw = resolveValueByKey(fields, values, "balance");
	// cardNumber is required by giftCardObject — source it from a "cardNumber"
	// field, otherwise fall back to the serial number so it is always present.
	const cardNumber =
		resolveValueByKey(fields, values, "cardNumber") ?? serialNumber;
	return {
		cardNumber,
		balance:
			raw == null
				? undefined
				: {
						micros: String(Math.round(Number.parseFloat(raw) * 1_000_000)),
						currencyCode: pass.currency ?? "USD",
					},
	};
}

// Event: structured seatInfo from well-known seat/row/section/gate field keys.
// Google renders these in dedicated ticket slots rather than as text modules.
function buildEventObjectFields(
	fields: FieldDef[],
	values: Record<string, string | null>
): Record<string, unknown> {
	const seatInfo: Record<string, unknown> = {};
	const seat = resolveValueByKey(fields, values, "seat");
	const row = resolveValueByKey(fields, values, "row");
	const section = resolveValueByKey(fields, values, "section");
	const gate = resolveValueByKey(fields, values, "gate");
	if (seat != null) {
		seatInfo.seat = localized(seat);
	}
	if (row != null) {
		seatInfo.row = localized(row);
	}
	if (section != null) {
		seatInfo.section = localized(section);
	}
	if (gate != null) {
		seatInfo.gate = localized(gate);
	}
	return Object.keys(seatInfo).length > 0 ? { seatInfo } : {};
}

// Well-known field keys that map to structured object fields and so must be
// excluded from the generic textModulesData for that pass type.
const STRUCTURED_FIELD_KEYS: Partial<Record<PassType, string[]>> = {
	loyalty: ["member", "memberId", "points"],
	event: ["seat", "row", "section", "gate"],
};

// The primary field is the most prominent one, so it leads textModulesData on
// the verticals that have no header/subheader to put it in.
function orderPrimaryFirst(
	fields: FieldDef[],
	primaryField: FieldDef | undefined
): FieldDef[] {
	if (!primaryField) {
		return fields;
	}
	return [primaryField, ...fields.filter((f) => f !== primaryField)];
}

// Display fields. `header` and `subheader` exist ONLY on GenericObject
// (https://developers.google.com/wallet/reference/rest/v1/genericobject), so
// generic passes render the primary field there and every other vertical keeps
// it in textModulesData — first entry, ahead of the remaining fields. Google
// deprecated infoModuleData in favour of textModulesData, which holds up to ten
// entries on the object.
function buildDisplayFields(
	fields: FieldDef[],
	values: Record<string, string | null>,
	locales: PassConfig["locales"],
	excludeKeys: string[] = [],
	{ generic = false }: { generic?: boolean } = {}
): Record<string, unknown> {
	const primaryField = fields.find((f) => f.slot === "primary");
	const primaryValue = primaryField
		? resolveFieldValue(primaryField, values)
		: undefined;

	const textModules = buildTextModules(
		generic ? fields : orderPrimaryFirst(fields, primaryField),
		values,
		generic ? ["primary"] : [],
		excludeKeys
	);

	if (!generic) {
		return {
			textModulesData: textModules.length > 0 ? textModules : undefined,
		};
	}

	return {
		subheader:
			primaryField && primaryValue != null
				? localized(
						primaryField.label ?? primaryField.key,
						"en-US",
						translationsFor(primaryField.key, locales)
					)
				: undefined,
		header:
			primaryField && primaryValue != null
				? localized(
						primaryValue,
						"en-US",
						translationsFor(`${primaryField.key}_value`, locales)
					)
				: undefined,
		textModulesData: textModules.length > 0 ? textModules : undefined,
	};
}

// Build the object body — per-recipient data
function buildObjectBody(
	pass: PassConfig,
	createConfig: CreateConfig,
	classId: string,
	objectId: string
): Record<string, unknown> {
	const values = createConfig.values ?? {};
	const fields = pass.fields;
	const transit = transitOptions(pass);
	const googleBarcode = createConfig.barcodes?.[0] ?? createConfig.barcode;

	// Keys rendered as structured object fields are excluded from text modules
	// (loyalty points/account, event seat/row/section/gate).
	const display = buildDisplayFields(
		fields,
		values,
		pass.locales,
		STRUCTURED_FIELD_KEYS[pass.type] ?? [],
		{ generic: pass.type === "generic" }
	);

	return {
		id: objectId,
		classId,
		state: "ACTIVE",
		// A Google object holds a single barcode — when several are supplied it
		// takes the first entry.
		barcode: googleBarcode
			? {
					type: toGoogleBarcodeType(googleBarcode.format),
					value: googleBarcode.value,
					alternateText: googleBarcode.altText,
				}
			: undefined,
		validTimeInterval:
			createConfig.validFrom || createConfig.expiresAt
				? {
						start: createConfig.validFrom
							? { date: createConfig.validFrom }
							: undefined,
						end: createConfig.expiresAt
							? { date: createConfig.expiresAt }
							: undefined,
					}
				: undefined,
		// Smart Tap: per-recipient redemption value sent to NFC terminals
		smartTapRedemptionValue: createConfig.google?.smartTapRedemptionValue,
		// Rotating barcode replaces the static barcode when set
		rotatingBarcode: createConfig.google?.rotatingBarcode,
		// Per-recipient messages
		messages: createConfig.google?.messages,
		// Per-recipient links, images, and value-added modules. Google merges
		// these with the class-level modules of the same name.
		...buildModuleData({
			links: createConfig.google?.links,
			images: createConfig.google?.images,
			valueAdded: createConfig.google?.valueAdded,
		}),
		...(pass.type === "loyalty" && buildLoyaltyObjectFields(fields, values)),
		...(pass.type === "event" && buildEventObjectFields(fields, values)),
		...(pass.type === "flight" &&
			(transit
				? buildTransitObjectFields(pass, transit, createConfig, values)
				: buildFlightObjectFields(pass, createConfig.serialNumber, values))),
		...(pass.type === "giftCard" &&
			buildGiftCardObjectFields(
				pass,
				fields,
				values,
				createConfig.serialNumber
			)),
		// genericObject carries all branding: genericClass has no cardTitle, color,
		// logo, or hero fields, so they must be set here or the pass renders bare.
		...(pass.type === "generic" && {
			cardTitle: localized(
				pass.name,
				"en-US",
				translationsFor("name", pass.locales)
			),
			hexBackgroundColor: pass.color,
			logo: imageUri(pass.google?.logo),
			wideLogo: imageUri(pass.google?.wideLogo),
			heroImage: imageUri(pass.google?.hero),
			...(pass.google?.appLinkData && {
				appLinkData: buildAppLinkData(pass.google.appLinkData),
			}),
		}),
		...display,
		// genericObject also requires header. It is normally derived from the
		// primary field; fall back to the pass name when there is no primary
		// field so the object is never rejected for a missing header.
		...(pass.type === "generic" &&
			display.header == null && {
				header: localized(
					pass.name,
					"en-US",
					translationsFor("name", pass.locales)
				),
			}),
	};
}

export async function generateGooglePass(
	pass: PassConfig,
	createConfig: CreateConfig,
	credentials: GoogleCredentials
): Promise<{ pass: string | null; warnings: string[] }> {
	const warnings: string[] = [];

	validateGoogleRequirements(pass);

	const privateKey = await importGoogleKey(credentials);

	const classType = googleClassType(pass);
	const objectType = googleObjectType(pass);
	const classId = `${credentials.issuerId}.${pass.id}`;
	const objectId = `${credentials.issuerId}.${createConfig.serialNumber}`;

	const classBody = buildClassBody(pass);
	await ensureClass(classType, classId, classBody, credentials, privateKey);

	const objectBody = buildObjectBody(pass, createConfig, classId, objectId);

	// Pluralise the object type key for the JWT payload (e.g. "loyaltyObject" → "loyaltyObjects")
	const objectsKey = objectType.replace("Object", "Objects");

	const payload = {
		iss: credentials.clientEmail,
		aud: "google",
		typ: "savetowallet",
		iat: Math.floor(Date.now() / 1000),
		// Approved domains for the embeddable "Add to Google Wallet" button.
		// The web button does not render unless origins is present.
		...(credentials.origins?.length && { origins: credentials.origins }),
		payload: {
			[objectsKey]: [objectBody],
		},
	};

	// Sign the "Add to Google Wallet" JWT with the service account key
	const { SignJWT } = await import("jose");
	const jwt = await new SignJWT(payload)
		.setProtectedHeader({ alg: "RS256" })
		.sign(privateKey);

	return { pass: jwt, warnings };
}

export async function updateGooglePass(
	pass: PassConfig,
	createConfig: CreateConfig,
	credentials: GoogleCredentials,
	options?: UpdateOptions
): Promise<void> {
	const privateKey = await importGoogleKey(credentials);
	const { objectType, objectId } = googleObjectRef(
		credentials,
		pass,
		createConfig.serialNumber
	);
	const classId = `${credentials.issuerId}.${pass.id}`;

	const patch = buildObjectBody(pass, createConfig, classId, objectId);

	await patchObject(objectType, objectId, patch, credentials, privateKey, {
		notify: options?.notify,
	});
}

export async function deleteGooglePass(
	pass: PassConfig,
	serialNumber: string,
	credentials: GoogleCredentials
): Promise<void> {
	const privateKey = await importGoogleKey(credentials);
	const { objectType, objectId } = googleObjectRef(
		credentials,
		pass,
		serialNumber
	);

	await deleteObject(objectType, objectId, credentials, privateKey);
}

export async function expireGooglePass(
	pass: PassConfig,
	serialNumber: string,
	credentials: GoogleCredentials
): Promise<void> {
	const privateKey = await importGoogleKey(credentials);
	const { objectType, objectId } = googleObjectRef(
		credentials,
		pass,
		serialNumber
	);

	await patchObject(
		objectType,
		objectId,
		{ state: "EXPIRED" },
		credentials,
		privateKey
	);
}
