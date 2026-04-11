import { WalletError } from "../../errors";
import type { GoogleCredentials } from "../../types/credentials";
import type { CreateConfig, FieldDef, PassConfig } from "../../types/schemas";
import { deleteObject, ensureClass, importGoogleKey, patchObject } from "./api";
import {
	imageUri,
	localized,
	toGoogleBarcodeType,
	translationsFor,
} from "./utils";

// Typed maps — pass.type is always one of these keys so access is always string (not string | undefined)
type PassType = PassConfig["type"];

// Google Wallet class type per pass type
const CLASS_TYPE: Record<PassType, string> = {
	loyalty: "loyaltyClass",
	event: "eventTicketClass",
	flight: "flightClass",
	coupon: "offerClass",
	giftCard: "giftCardClass",
	generic: "genericClass",
};

// Google Wallet object type per pass type
const OBJECT_TYPE: Record<PassType, string> = {
	loyalty: "loyaltyObject",
	event: "eventTicketObject",
	flight: "flightObject",
	coupon: "offerObject",
	giftCard: "giftCardObject",
	generic: "genericObject",
};

function validateGoogleRequirements(pass: PassConfig): void {
	// Google logo must be a URL (not bytes — Google can't accept binary uploads directly)
	if (pass.logo !== undefined && pass.logo instanceof Uint8Array) {
		throw new WalletError(
			"GOOGLE_MISSING_LOGO",
			"Google Wallet logo must be a URL string, not bytes"
		);
	}
	// Google loyalty classes require a programLogo URL — the API returns 400 without it
	if (pass.type === "loyalty" && !pass.logo) {
		throw new WalletError(
			"GOOGLE_MISSING_LOGO",
			"Google Wallet loyalty passes require a logo URL (programLogo)"
		);
	}
	if (pass.type === "flight") {
		const { carrier, flightNumber, origin, destination } = pass;
		if (!(carrier && flightNumber && origin && destination)) {
			throw new WalletError(
				"GOOGLE_FLIGHT_MISSING_CLASS_FIELDS",
				"Flight passes require carrier, flightNumber, origin, and destination"
			);
		}
	}
}

// Build textModulesData from fields not in excluded slots
function buildTextModules(
	fields: FieldDef[],
	values: Record<string, string | null>,
	excludeSlots: FieldDef["slot"][]
): Array<{ header: string; body: string; id: string }> {
	const modules: Array<{ header: string; body: string; id: string }> = [];
	for (const f of fields) {
		if (excludeSlots.includes(f.slot)) {
			continue;
		}
		const value = f.key in values ? values[f.key] : f.value;
		if (value === null || value === undefined) {
			continue;
		}
		modules.push({ header: f.label, body: value, id: f.key });
	}
	return modules;
}

// Build infoModuleData from back fields
function buildInfoModuleData(
	fields: FieldDef[],
	values: Record<string, string | null>
):
	| {
			labelValueRows: Array<{
				columns: Array<{ label: string; value: string }>;
			}>;
	  }
	| undefined {
	const rows: Array<{ label: string; value: string }> = [];
	for (const f of fields) {
		if (f.slot !== "back") {
			continue;
		}
		const value = f.key in values ? values[f.key] : f.value;
		if (value === null || value === undefined) {
			continue;
		}
		rows.push({ label: f.label, value });
	}
	if (rows.length === 0) {
		return undefined;
	}
	return { labelValueRows: rows.map((r) => ({ columns: [r] })) };
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
			localScheduledStartDateTime: pass.startsAt?.replace("Z", ""),
			localScheduledEndDateTime: pass.endsAt?.replace("Z", ""),
		};
	}
	if (pass.type === "flight") {
		return {
			// flightClass represents a single flight — departure time is class-level
			flightHeader: {
				carrier: { carrierIataCode: pass.carrier },
				flightNumber: pass.flightNumber,
				operatingCarrier: { carrierIataCode: pass.carrier },
				operatingFlightNumber: pass.flightNumber,
			},
			localScheduledDepartureDateTime: pass.departure?.replace("Z", ""),
			origin: pass.origin ? { airportIataCode: pass.origin } : undefined,
			destination: pass.destination
				? {
						airportIataCode: pass.destination,
						localScheduledArrivalDateTime: pass.arrival?.replace("Z", ""),
					}
				: undefined,
		};
	}
	if (pass.type === "coupon") {
		return {
			title: pass.name,
			// provider is required by Google offerClass — defaults to the pass name
			provider: pass.name,
			redemptionChannel: pass.redemptionChannel.toUpperCase(),
		};
	}
	// giftCard + generic
	return { cardTitle: localized(pass.name, "en-US", nameTranslations) };
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

function buildAppLinkData(d: {
	android?: {
		uri: string;
		title?: string;
		description?: string;
		logoUrl?: string;
	};
	ios?: { uri: string; title?: string; description?: string; logoUrl?: string };
	web?: { uri: string; title?: string; description?: string; logoUrl?: string };
}): Record<string, unknown> {
	return {
		androidAppLinkInfo: d.android ? buildAppLinkInfo(d.android) : undefined,
		iosAppLinkInfo: d.ios ? buildAppLinkInfo(d.ios) : undefined,
		webAppLinkInfo: d.web ? buildAppLinkInfo(d.web) : undefined,
	};
}

// Build the class body — defines the pass template (shared across all recipients)
function buildClassBody(pass: PassConfig): Record<string, unknown> {
	const logo = imageUri(pass.logo);
	const wideLogo = imageUri(pass.google?.wideLogo);
	const hero = imageUri(
		typeof pass.banner === "string" ? pass.banner : undefined
	);

	const body: Record<string, unknown> = {
		...buildClassTypeFields(pass, pass.locales),
		hexBackgroundColor: pass.color,
		issuerName: pass.google?.issuerName ?? pass.name,
	};

	// loyalty uses programLogo; all other types use logo
	if (pass.type === "loyalty") {
		if (logo) {
			body.programLogo = logo;
		}
	} else if (logo) {
		body.logo = logo;
	}
	if (wideLogo) {
		body.wideProgramBanner = wideLogo;
	}
	if (hero) {
		body.heroImage = hero;
	}
	// Required for loyalty, event, flight, coupon, giftCard classes. Ignored by genericClass.
	if (pass.type !== "generic") {
		body.reviewStatus = pass.google?.reviewStatus ?? "UNDER_REVIEW";
	}
	if (pass.google?.enableSmartTap) {
		body.enableSmartTap = pass.google.enableSmartTap;
	}
	if (pass.google?.redemptionIssuers) {
		body.redemptionIssuers = pass.google.redemptionIssuers;
	}
	if (pass.google?.messages) {
		body.messages = pass.google.messages;
	}
	if (pass.google?.appLinkData) {
		body.appLinkData = buildAppLinkData(pass.google.appLinkData);
	}
	if (pass.locations?.length) {
		body.locations = pass.locations.map(({ latitude, longitude }) => ({
			latitude,
			longitude,
		}));
	}

	return body;
}

// Loyalty: map well-known field keys to structured loyalty fields
function buildLoyaltyObjectFields(
	fields: FieldDef[],
	values: Record<string, string | null>
): Record<string, unknown> {
	const resolve = (key: string) =>
		values[key] ?? fields.find((f) => f.key === key)?.value;
	const points = resolve("points");
	const member = resolve("member");
	const memberId = resolve("memberId");
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
	values: Record<string, string | null>,
	warnings: string[]
): Record<string, unknown> {
	const passengerName = values.passengerName;
	if (!passengerName) {
		warnings.push(
			"Google flight pass: passengerName not set in values — passenger name will be blank"
		);
	}
	return {
		passengerName: passengerName ?? "",
		reservationInfo: { confirmationCode: serialNumber },
	};
}

// GiftCard: balance amount with currency
function buildGiftCardObjectFields(
	pass: Extract<PassConfig, { type: "giftCard" }>,
	fields: FieldDef[],
	values: Record<string, string | null>
): Record<string, unknown> {
	const raw = values.balance ?? fields.find((f) => f.key === "balance")?.value;
	return {
		balance:
			raw == null
				? undefined
				: {
						micros: String(Math.round(Number.parseFloat(raw) * 1_000_000)),
						currencyCode: pass.currency ?? "USD",
					},
	};
}

// Display fields: primary → subheader+header, others → textModulesData, back → infoModuleData
function buildDisplayFields(
	fields: FieldDef[],
	values: Record<string, string | null>,
	locales: PassConfig["locales"]
): Record<string, unknown> {
	const primaryField = fields.find((f) => f.slot === "primary");
	const primaryValue =
		primaryField &&
		(primaryField.key in values
			? values[primaryField.key]
			: primaryField.value);

	const textModules = buildTextModules(fields, values, ["primary", "back"]);

	return {
		subheader:
			primaryField && primaryValue != null
				? localized(
						primaryField.label,
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
		infoModuleData: buildInfoModuleData(fields, values),
	};
}

// Build the object body — per-recipient data
function buildObjectBody(
	pass: PassConfig,
	createConfig: CreateConfig,
	classId: string,
	objectId: string,
	warnings: string[]
): Record<string, unknown> {
	const values = createConfig.values ?? {};
	const fields = pass.fields;

	return {
		id: objectId,
		classId,
		state: "ACTIVE",
		barcode: createConfig.barcode
			? {
					type: toGoogleBarcodeType(createConfig.barcode.format),
					value: createConfig.barcode.value,
					alternateText:
						createConfig.barcode.altText ?? createConfig.barcode.value,
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
		...(pass.type === "loyalty" && buildLoyaltyObjectFields(fields, values)),
		...(pass.type === "flight" &&
			buildFlightObjectFields(
				pass,
				createConfig.serialNumber,
				values,
				warnings
			)),
		...(pass.type === "giftCard" &&
			buildGiftCardObjectFields(pass, fields, values)),
		// genericObject requires cardTitle in the object body (in addition to the class)
		...(pass.type === "generic" && {
			cardTitle: localized(
				pass.name,
				"en-US",
				translationsFor("name", pass.locales)
			),
		}),
		...buildDisplayFields(fields, values, pass.locales),
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

	const classType = CLASS_TYPE[pass.type];
	const objectType = OBJECT_TYPE[pass.type];
	const classId = `${credentials.issuerId}.${pass.id}`;
	const objectId = `${credentials.issuerId}.${createConfig.serialNumber}`;

	const classBody = buildClassBody(pass);
	await ensureClass(classType, classId, classBody, credentials, privateKey);

	const objectBody = buildObjectBody(
		pass,
		createConfig,
		classId,
		objectId,
		warnings
	);

	// Pluralise the object type key for the JWT payload (e.g. "loyaltyObject" → "loyaltyObjects")
	const objectsKey = objectType.replace("Object", "Objects");

	const payload = {
		iss: credentials.clientEmail,
		aud: "google",
		typ: "savetowallet",
		iat: Math.floor(Date.now() / 1000),
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
	credentials: GoogleCredentials
): Promise<void> {
	const privateKey = await importGoogleKey(credentials);
	const objectType = OBJECT_TYPE[pass.type];
	const classId = `${credentials.issuerId}.${pass.id}`;
	const objectId = `${credentials.issuerId}.${createConfig.serialNumber}`;

	const patch = buildObjectBody(pass, createConfig, classId, objectId, []);

	await patchObject(objectType, objectId, patch, credentials, privateKey);
}

export async function deleteGooglePass(
	pass: PassConfig,
	serialNumber: string,
	credentials: GoogleCredentials
): Promise<void> {
	const privateKey = await importGoogleKey(credentials);
	const objectType = OBJECT_TYPE[pass.type];
	const objectId = `${credentials.issuerId}.${serialNumber}`;

	await deleteObject(objectType, objectId, credentials, privateKey);
}

export async function expireGooglePass(
	pass: PassConfig,
	serialNumber: string,
	credentials: GoogleCredentials
): Promise<void> {
	const privateKey = await importGoogleKey(credentials);
	const objectType = OBJECT_TYPE[pass.type];
	const objectId = `${credentials.issuerId}.${serialNumber}`;

	await patchObject(
		objectType,
		objectId,
		{ state: "EXPIRED" },
		credentials,
		privateKey
	);
}
