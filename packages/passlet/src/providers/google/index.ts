import { WalletError } from "../../errors";
import type { GoogleCredentials } from "../../types/credentials";
import type { CreateConfig, FieldDef, PassConfig } from "../../types/schemas";
import { ensureClass, importGoogleKey, patchObject } from "./api";
import { imageUri, localized, toGoogleBarcodeType } from "./utils";

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

// Build textModulesData from fields that are not in excluded slots
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
function applyClassTypeName(
	pass: PassConfig,
	body: Record<string, unknown>
): void {
	if (pass.type === "loyalty") {
		body.programName = pass.name;
	} else if (pass.type === "event") {
		body.eventName = localized(pass.name);
		if (pass.startsAt) {
			body.localScheduledStartDateTime = pass.startsAt.replace("Z", "");
		}
		if (pass.endsAt) {
			body.localScheduledEndDateTime = pass.endsAt.replace("Z", "");
		}
	} else if (pass.type === "flight") {
		body.localAirportIataCode = pass.origin;
	} else if (pass.type === "coupon") {
		body.title = pass.name;
		if (pass.redemptionChannel) {
			body.redemptionChannel = pass.redemptionChannel.toUpperCase();
		}
	} else {
		// giftCard + generic
		body.cardTitle = localized(pass.name);
	}
}

// Build the class body — defines the pass template (shared across all recipients)
function buildClassBody(
	pass: PassConfig,
	classId: string
): Record<string, unknown> {
	const body: Record<string, unknown> = { id: classId };

	applyClassTypeName(pass, body);

	if (pass.color) {
		body.hexBackgroundColor = pass.color;
	}

	const logo = imageUri(pass.logo);
	if (logo) {
		body[pass.type === "loyalty" ? "programLogo" : "logo"] = logo;
	}

	const wideLogo = imageUri(pass.google?.wideLogo);
	if (wideLogo) {
		body.wideProgramBanner = wideLogo;
	}

	// banner → hero on Google (imageUri only accepts string URLs)
	const hero = imageUri(
		typeof pass.banner === "string" ? pass.banner : undefined
	);
	if (hero) {
		body.heroImage = hero;
	}

	if (pass.google?.issuerName) {
		body.issuerName = pass.google.issuerName;
	}

	// Google supports up to 20 locations. altitude and relevantText are Apple-only — ignored here.
	if (pass.locations && pass.locations.length > 0) {
		body.locations = pass.locations.map(({ latitude, longitude }) => ({
			latitude,
			longitude,
		}));
	}

	if (pass.google?.extend) {
		Object.assign(body, pass.google.extend);
	}

	return body;
}

// Loyalty: map well-known field keys to structured loyalty fields
function applyLoyaltyFields(
	body: Record<string, unknown>,
	fields: FieldDef[],
	values: Record<string, string | null>
): void {
	const resolve = (key: string) =>
		values[key] ?? fields.find((f) => f.key === key)?.value;
	const points = resolve("points");
	const member = resolve("member");
	const memberId = resolve("memberId");
	if (points != null) {
		body.loyaltyPoints = { balance: { string: points } };
	}
	if (member != null) {
		body.accountName = member;
	}
	if (memberId != null) {
		body.accountId = memberId;
	}
}

// Flight: structured boarding data required by Google flightObject
function applyFlightFields(
	body: Record<string, unknown>,
	pass: Extract<PassConfig, { type: "flight" }>,
	serialNumber: string,
	values: Record<string, string | null>,
	warnings: string[]
): void {
	const passengerName = values.passengerName;
	if (!passengerName) {
		warnings.push(
			"Google flight pass: passengerName not set in values — passenger name will be blank"
		);
	}
	body.passengerName = passengerName ?? "";
	body.flightHeader = {
		carrier: { carrierIataCode: pass.carrier },
		flightNumber: pass.flightNumber,
		operatingCarrier: { carrierIataCode: pass.carrier },
		operatingFlightNumber: pass.flightNumber,
	};
	body.reservationInfo = { confirmationCode: serialNumber };
	if (pass.origin) {
		body.origin = {
			airportIataCode: pass.origin,
			...(pass.departure
				? { localScheduledDepartureDateTime: pass.departure.replace("Z", "") }
				: {}),
		};
	}
	if (pass.destination) {
		body.destination = {
			airportIataCode: pass.destination,
			...(pass.arrival
				? { localScheduledArrivalDateTime: pass.arrival.replace("Z", "") }
				: {}),
		};
	}
}

// GiftCard: balance amount with currency
function applyGiftCardFields(
	body: Record<string, unknown>,
	pass: Extract<PassConfig, { type: "giftCard" }>,
	fields: FieldDef[],
	values: Record<string, string | null>
): void {
	const raw = values.balance ?? fields.find((f) => f.key === "balance")?.value;
	if (raw != null) {
		body.balance = {
			micros: String(Math.round(Number.parseFloat(raw) * 1_000_000)),
			currencyCode: pass.currency ?? "USD",
		};
	}
}

// Apply display fields: primary → subheader+header, others → textModulesData, back → infoModuleData
function applyDisplayFields(
	body: Record<string, unknown>,
	fields: FieldDef[],
	values: Record<string, string | null>
): void {
	const primaryField = fields.find((f) => f.slot === "primary");
	if (primaryField) {
		const primaryValue =
			primaryField.key in values
				? values[primaryField.key]
				: primaryField.value;
		if (primaryValue != null) {
			body.subheader = localized(primaryField.label);
			body.header = localized(primaryValue);
		}
	}

	const textModules = buildTextModules(fields, values, ["primary", "back"]);
	if (textModules.length > 0) {
		body.textModulesData = textModules;
	}

	const infoModule = buildInfoModuleData(fields, values);
	if (infoModule) {
		body.infoModuleData = infoModule;
	}
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

	const body: Record<string, unknown> = {
		id: objectId,
		classId,
		state: "ACTIVE",
	};

	if (createConfig.barcode) {
		body.barcode = {
			type: toGoogleBarcodeType(createConfig.barcode.format),
			value: createConfig.barcode.value,
			alternateText: createConfig.barcode.altText ?? createConfig.barcode.value,
		};
	}

	if (createConfig.expiresAt) {
		body.validTimeInterval = {
			end: { date: createConfig.expiresAt.toISOString() },
		};
	}

	if (pass.type === "loyalty") {
		applyLoyaltyFields(body, fields, values);
	} else if (pass.type === "flight") {
		applyFlightFields(body, pass, createConfig.serialNumber, values, warnings);
	} else if (pass.type === "giftCard") {
		applyGiftCardFields(body, pass, fields, values);
	}

	applyDisplayFields(body, fields, values);

	return body;
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

	const classBody = buildClassBody(pass, classId);
	await ensureClass(classType, classId, classBody, credentials, privateKey);

	const objectBody = buildObjectBody(
		pass,
		createConfig,
		classId,
		objectId,
		warnings
	);

	// Pluralise the object type key for the JWT payload (e.g. "loyaltyObject" → "loyaltyObjects")
	const objectsKey = `${objectType.replace("Object", "Objects")}`;

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
