import { createHash } from "node:crypto";
import JSZip from "jszip";
import { WalletError } from "../../errors";
import type { AppleCredentials } from "../../types/credentials";
import type {
	Barcode,
	CreateConfig,
	FieldDef,
	PassConfig,
	PassType,
} from "../../types/schemas";
import { signManifestAsync } from "./signer";
import {
	escapeStringsValue,
	hexToRgb,
	isLegacyBarcodeFormat,
	resolveImageSet,
	resolveRequiredImageSet,
	toAppleBarcodeFormat,
	toAppleDataDetectorTypes,
	toAppleDateStyle,
	toAppleMessageEncoding,
	toAppleNumberStyle,
	toAppleTextAlignment,
} from "./utils";

const PASS_TYPE_KEY: Record<PassType, string> = {
	loyalty: "storeCard",
	coupon: "coupon",
	event: "eventTicket",
	flight: "boardingPass",
	giftCard: "storeCard",
	generic: "generic",
};

const TRANSIT_TYPE: Record<
	NonNullable<Extract<PassConfig, { type: "flight" }>["transitType"]>,
	string
> = {
	air: "PKTransitTypeAir",
	train: "PKTransitTypeTrain",
	bus: "PKTransitTypeBus",
	boat: "PKTransitTypeBoat",
	generic: "PKTransitTypeGeneric",
};

const SLOT_KEY: Record<FieldDef["slot"], keyof AppleSlots> = {
	header: "headerFields",
	primary: "primaryFields",
	secondary: "secondaryFields",
	auxiliary: "auxiliaryFields",
	back: "backFields",
};

export function validateAppleRequirements(pass: PassConfig): void {
	if (!pass.apple?.icon) {
		throw new WalletError("APPLE_MISSING_ICON");
	}
	if (pass.type === "flight" && !pass.transitType) {
		throw new WalletError("APPLE_BOARDING_MISSING_TRANSIT_TYPE");
	}
	// Apple update requests require a token; the schema enforces its 16-char minimum.
	if (pass.apple?.webServiceURL && !pass.apple.authenticationToken) {
		throw new WalletError("APPLE_MISSING_AUTH_TOKEN");
	}
	// Apple ignores appLaunchURL without associated App Store IDs.
	if (
		pass.apple?.appLaunchURL &&
		!pass.apple.associatedStoreIdentifiers?.length
	) {
		throw new WalletError("APPLE_APP_LAUNCH_URL_REQUIRES_STORE_IDS");
	}
}

interface AppleField {
	attributedValue?: string;
	changeMessage?: string;
	currencyCode?: string;
	dataDetectorTypes?: string[];
	dateStyle?: string;
	ignoresTimeZone?: boolean;
	isRelative?: boolean;
	key: string;
	label?: string;
	numberStyle?: string;
	row?: 0 | 1;
	semantics?: Record<string, unknown>;
	textAlignment?: string;
	timeStyle?: string;
	value: string;
}

type AppleSlots = Record<
	| "headerFields"
	| "primaryFields"
	| "secondaryFields"
	| "auxiliaryFields"
	| "backFields",
	AppleField[]
>;

function buildField(f: FieldDef, value: string): AppleField {
	return {
		key: f.key,
		label: f.label,
		value,
		changeMessage: f.changeMessage || undefined,
		dateStyle: f.dateStyle ? toAppleDateStyle(f.dateStyle) : undefined,
		timeStyle: f.timeStyle ? toAppleDateStyle(f.timeStyle) : undefined,
		numberStyle: f.numberStyle ? toAppleNumberStyle(f.numberStyle) : undefined,
		currencyCode: f.currencyCode || undefined,
		// attributedValue overrides value on iOS and is ignored on watchOS.
		attributedValue: f.attributedValue,
		// Only back fields support detectors; [] explicitly disables them.
		dataDetectorTypes:
			f.dataDetectorTypes !== undefined && f.slot === "back"
				? toAppleDataDetectorTypes(f.dataDetectorTypes)
				: undefined,
		ignoresTimeZone: f.ignoresTimeZone,
		isRelative: f.isRelative,
		semantics: f.semantics,
		// Apple ignores textAlignment on primary and back fields.
		textAlignment:
			f.textAlignment && f.slot !== "primary" && f.slot !== "back"
				? toAppleTextAlignment(f.textAlignment)
				: undefined,
		// Apple only supports `row` on auxiliary fields (event tickets).
		row: f.slot === "auxiliary" ? f.row : undefined,
	};
}

function buildSlots(
	fields: FieldDef[],
	values: Record<string, string | null>
): AppleSlots {
	const slots: AppleSlots = {
		headerFields: [],
		primaryFields: [],
		secondaryFields: [],
		auxiliaryFields: [],
		backFields: [],
	};

	for (const f of fields) {
		const value = f.key in values ? values[f.key] : f.value;
		if (value === null || value === undefined) {
			continue;
		}

		slots[SLOT_KEY[f.slot]].push(buildField(f, value));
	}

	return slots;
}

type EventPass = Extract<PassConfig, { type: "event" }>;
type FlightPass = Extract<PassConfig, { type: "flight" }>;

function buildEventAppleFields(pass: EventPass): Record<string, unknown> {
	const a = pass.apple;
	return {
		eventLogoText: a?.eventLogoText,
		footerBackgroundColor: a?.footerBackgroundColor
			? hexToRgb(a.footerBackgroundColor)
			: undefined,
		suppressHeaderDarkening: a?.suppressHeaderDarkening,
		useAutomaticColors: a?.useAutomaticColors,
		preferredStyleSchemes: a?.preferredStyleSchemes,
		auxiliaryStoreIdentifiers: a?.auxiliaryStoreIdentifiers,
		accessibilityURL: a?.accessibilityURL,
		addOnURL: a?.addOnURL,
		bagPolicyURL: a?.bagPolicyURL,
		contactVenueEmail: a?.contactVenueEmail,
		contactVenuePhoneNumber: a?.contactVenuePhoneNumber,
		contactVenueWebsite: a?.contactVenueWebsite,
		directionsInformationURL: a?.directionsInformationURL,
		merchandiseURL: a?.merchandiseURL,
		orderFoodURL: a?.orderFoodURL,
		parkingInformationURL: a?.parkingInformationURL,
		purchaseParkingURL: a?.purchaseParkingURL,
		sellURL: a?.sellURL,
		transferURL: a?.transferURL,
		transitInformationURL: a?.transitInformationURL,
	};
}

function buildFlightAppleFields(pass: FlightPass): Record<string, unknown> {
	const a = pass.apple;
	return {
		changeSeatURL: a?.changeSeatURL,
		entertainmentURL: a?.entertainmentURL,
		managementURL: a?.managementURL,
		purchaseAdditionalBaggageURL: a?.purchaseAdditionalBaggageURL,
		purchaseLoungeAccessURL: a?.purchaseLoungeAccessURL,
		purchaseWifiURL: a?.purchaseWifiURL,
		registerServiceAnimalURL: a?.registerServiceAnimalURL,
		reportLostBagURL: a?.reportLostBagURL,
		requestWheelchairURL: a?.requestWheelchairURL,
		trackBagsURL: a?.trackBagsURL,
		transitProviderEmail: a?.transitProviderEmail,
		transitProviderPhoneNumber: a?.transitProviderPhoneNumber,
		transitProviderWebsiteURL: a?.transitProviderWebsiteURL,
		upgradeURL: a?.upgradeURL,
	};
}

function fieldValue(
	fields: FieldDef[],
	values: Record<string, string | null>,
	key: string
): string | undefined {
	const f = fields.find((field) => field.key === key);
	if (!f) {
		return;
	}
	const v = f.key in values ? values[f.key] : f.value;
	return v == null ? undefined : v;
}

// Omit seats with no populated seat/row/section fields.
function buildSeats(
	fields: FieldDef[],
	values: Record<string, string | null>
): Record<string, string>[] | undefined {
	const seat: Record<string, string> = {};
	const number = fieldValue(fields, values, "seat");
	const row = fieldValue(fields, values, "row");
	const section = fieldValue(fields, values, "section");
	if (number) {
		seat.seatNumber = number;
	}
	if (row) {
		seat.seatRow = row;
	}
	if (section) {
		seat.seatSection = section;
	}
	return number || row || section ? [seat] : undefined;
}

// Top-level semantics enable Wallet flight tracking and event relevance.
function buildFlightSemantics(
	pass: FlightPass,
	values: Record<string, string | null>
): Record<string, unknown> | undefined {
	const { carrier, flightNumber, origin, destination, departure, arrival } =
		pass;
	const semantics: Record<string, unknown> = {};
	if (carrier) {
		semantics.airlineCode = carrier;
	}
	if (carrier && flightNumber) {
		semantics.flightCode = `${carrier}${flightNumber}`;
	}
	if (flightNumber) {
		// SemanticTagType.flightNumber is the numeric portion, as a JSON number
		const numeric = Number.parseInt(flightNumber, 10);
		if (!Number.isNaN(numeric)) {
			semantics.flightNumber = numeric;
		}
	}
	if (origin) {
		semantics.departureAirportCode = origin;
	}
	if (destination) {
		semantics.destinationAirportCode = destination;
	}
	if (departure) {
		semantics.originalDepartureDate = departure;
	}
	if (arrival) {
		semantics.originalArrivalDate = arrival;
	}
	const gate = fieldValue(pass.fields, values, "gate");
	const terminal = fieldValue(pass.fields, values, "terminal");
	const boardingGroup =
		fieldValue(pass.fields, values, "boardingZone") ??
		fieldValue(pass.fields, values, "boardingGroup");
	if (gate) {
		semantics.departureGate = gate;
	}
	if (terminal) {
		semantics.departureTerminal = terminal;
	}
	if (boardingGroup) {
		semantics.boardingGroup = boardingGroup;
	}
	const seats = buildSeats(pass.fields, values);
	if (seats) {
		semantics.seats = seats;
	}
	return Object.keys(semantics).length > 0 ? semantics : undefined;
}

function buildEventSemantics(
	pass: EventPass,
	values: Record<string, string | null>
): Record<string, unknown> {
	const semantics: Record<string, unknown> = { eventName: pass.name };
	if (pass.startsAt) {
		semantics.eventStartDate = pass.startsAt;
	}
	if (pass.endsAt) {
		semantics.eventEndDate = pass.endsAt;
	}
	const venue = fieldValue(pass.fields, values, "venue");
	if (venue) {
		semantics.venueName = venue;
	}
	const seats = buildSeats(pass.fields, values);
	if (seats) {
		semantics.seats = seats;
	}
	return semantics;
}

// Poster event tickets use eventLogoText instead of logoText.
function resolveLogoText(pass: PassConfig): string | undefined {
	if (
		pass.type === "event" &&
		(pass.apple?.eventLogoText ||
			pass.apple?.preferredStyleSchemes?.includes("posterEventTicket"))
	) {
		return;
	}
	return pass.apple?.logoText || undefined;
}

// Explicit semantic tags override derived values for every pass type.
function buildSemantics(
	pass: PassConfig,
	values: Record<string, string | null>
): Record<string, unknown> | undefined {
	let derived: Record<string, unknown> | undefined;
	if (pass.type === "flight") {
		derived = buildFlightSemantics(pass, values);
	} else if (pass.type === "event") {
		derived = buildEventSemantics(pass, values);
	}
	const user = pass.apple?.semantics;
	if (!user) {
		return derived;
	}
	const merged = { ...derived, ...user };
	return Object.keys(merged).length > 0 ? merged : undefined;
}

type RelevantDate = { date: string } | { startDate: string; endDate: string };

// Explicit relevance dates override event/flight times.
function deriveRelevantDates(pass: PassConfig): RelevantDate[] | undefined {
	if (pass.apple?.relevantDates) {
		return pass.apple.relevantDates;
	}
	if (pass.type === "event" && pass.startsAt) {
		return pass.endsAt
			? [{ startDate: pass.startsAt, endDate: pass.endsAt }]
			: [{ date: pass.startsAt }];
	}
	if (pass.type === "flight" && pass.departure) {
		return pass.arrival
			? [{ startDate: pass.departure, endDate: pass.arrival }]
			: [{ date: pass.departure }];
	}
	return;
}

// `barcodes` (plural) wins when both are given; a lone `barcode` becomes a
// single-entry array so the modern key is always populated.
function resolveBarcodes(createConfig: CreateConfig): Barcode[] | undefined {
	if (createConfig.barcodes?.length) {
		return createConfig.barcodes;
	}
	return createConfig.barcode ? [createConfig.barcode] : undefined;
}

function toAppleBarcode(barcode: Barcode): Record<string, unknown> {
	return {
		message: barcode.value,
		format: toAppleBarcodeFormat(barcode.format),
		messageEncoding: toAppleMessageEncoding(barcode.format),
		altText: barcode.altText,
	};
}

function buildAppleCommonFields(
	pass: PassConfig,
	createConfig: CreateConfig
): Record<string, unknown> {
	const a = pass.apple;
	const barcodes = resolveBarcodes(createConfig);
	// The deprecated singular key accepts only QR, PDF417 and Aztec.
	const legacy = barcodes?.find((b) => isLegacyBarcodeFormat(b.format));
	return {
		backgroundColor: pass.color ? hexToRgb(pass.color) : undefined,
		foregroundColor: a?.foregroundColor
			? hexToRgb(a.foregroundColor)
			: undefined,
		labelColor: a?.labelColor ? hexToRgb(a.labelColor) : undefined,
		expirationDate: createConfig.expiresAt,
		voided: createConfig.apple?.voided,
		barcodes: barcodes?.map(toAppleBarcode),
		barcode: legacy ? toAppleBarcode(legacy) : undefined,
		locations: pass.locations?.map(
			({ latitude, longitude, altitude, relevantText }) => ({
				latitude,
				longitude,
				altitude,
				relevantText,
			})
		),
		beacons: a?.beacons,
		relevantDates: deriveRelevantDates(pass),
		groupingIdentifier: a?.groupingIdentifier,
		suppressStripShine: a?.suppressStripShine,
		sharingProhibited: a?.sharingProhibited,
		maxDistance: a?.maxDistance,
		nfc: a?.nfc
			? {
					message: a.nfc.message,
					encryptionPublicKey: a.nfc.encryptionPublicKey,
					requiresAuthentication: a.nfc.requiresAuthentication,
				}
			: undefined,
		appLaunchURL: a?.appLaunchURL,
		associatedStoreIdentifiers: a?.associatedStoreIdentifiers,
		webServiceURL: a?.webServiceURL,
		authenticationToken: a?.webServiceURL ? a.authenticationToken : undefined,
		userInfo: a?.userInfo,
	};
}

export function buildPassJson(
	pass: PassConfig,
	createConfig: CreateConfig,
	credentials: AppleCredentials
): Record<string, unknown> {
	const values = createConfig.values ?? {};
	const content: Record<string, unknown> = buildSlots(pass.fields, values);
	if (pass.type === "flight" && pass.transitType) {
		content.transitType = TRANSIT_TYPE[pass.transitType];
	}
	const a = pass.apple;
	const semantics = buildSemantics(pass, values);

	return {
		formatVersion: 1,
		passTypeIdentifier: credentials.passTypeIdentifier,
		serialNumber: createConfig.serialNumber,
		teamIdentifier: credentials.teamId,
		organizationName: pass.name,
		description: a?.description ?? pass.name,
		logoText: resolveLogoText(pass),
		...buildAppleCommonFields(pass, createConfig),
		...(pass.type === "event" && buildEventAppleFields(pass)),
		...(pass.type === "flight" && buildFlightAppleFields(pass)),
		...(semantics && { semantics }),
		[PASS_TYPE_KEY[pass.type]]: content,
	};
}

async function collectImages(
	pass: PassConfig,
	warnings: string[]
): Promise<Record<string, Uint8Array>> {
	const icon = pass.apple?.icon;
	if (!icon) {
		throw new WalletError("APPLE_MISSING_ICON");
	}
	const images = await resolveRequiredImageSet("icon", icon);

	const hasRetinaIcon =
		typeof icon === "object" && !(icon instanceof Uint8Array) && !!icon.retina;
	if (!hasRetinaIcon) {
		warnings.push(
			"icon@2x is recommended for Retina displays — provide icon as { base, retina }"
		);
	}

	const optional = await Promise.all([
		resolveImageSet("logo", pass.apple?.logo, warnings),
		resolveImageSet("strip", pass.apple?.strip, warnings),
		resolveImageSet("background", pass.apple?.background, warnings),
		resolveImageSet("thumbnail", pass.apple?.thumbnail, warnings),
		resolveImageSet("footer", pass.apple?.footer, warnings),
	]);
	for (const set of optional) {
		Object.assign(images, set);
	}

	// Event tickets render either a strip OR a background/thumbnail, not both.
	if (
		pass.type === "event" &&
		pass.apple?.strip &&
		(pass.apple.background || pass.apple.thumbnail)
	) {
		warnings.push(
			"Apple event tickets ignore background/thumbnail when a strip image is set"
		);
	}

	return images;
}

// Apple matches literal pass.json strings, not field keys. Locale keys resolve
// to labels, "<key>_value" to rendered values, and "name" to the pass name.
// Unmatched keys pass through for literals such as logoText.
const VALUE_SUFFIX = "_value";

function stringsLiteral(
	pass: PassConfig,
	values: Record<string, string | null>,
	key: string
): string | undefined {
	if (key === "name") {
		return pass.name;
	}
	const isValue = key.endsWith(VALUE_SUFFIX);
	const fieldKey = isValue ? key.slice(0, -VALUE_SUFFIX.length) : key;
	const field = pass.fields.find((f) => f.key === fieldKey);
	if (!field) {
		return key;
	}
	if (!isValue) {
		// An unlabelled field has no literal in pass.json to key an entry on.
		return field.label;
	}
	return (field.key in values ? values[field.key] : field.value) ?? undefined;
}

export function buildStringsLines(
	pass: PassConfig,
	values: Record<string, string | null>,
	translations: Record<string, string>
): string[] {
	// Two field keys can share a label — keep the first translation for a given
	// literal so the file has no duplicate entries.
	const entries = new Map<string, string>();
	for (const [key, translation] of Object.entries(translations)) {
		const literal = stringsLiteral(pass, values, key);
		if (literal === undefined || entries.has(literal)) {
			continue;
		}
		entries.set(
			literal,
			`"${escapeStringsValue(literal)}" = "${escapeStringsValue(translation)}";`
		);
	}
	return [...entries.values()];
}

export async function generateApplePass(
	pass: PassConfig,
	createConfig: CreateConfig,
	credentials: AppleCredentials
): Promise<{ pass: Uint8Array; warnings: string[] }> {
	const warnings: string[] = [];

	validateAppleRequirements(pass);

	const encoder = new TextEncoder();
	const zip = new JSZip();
	const files: Record<string, Uint8Array> = {};

	const passJson = buildPassJson(pass, createConfig, credentials);
	files["pass.json"] = encoder.encode(JSON.stringify(passJson));

	if (pass.locales) {
		const values = createConfig.values ?? {};
		for (const [language, translations] of Object.entries(pass.locales)) {
			const lines = buildStringsLines(pass, values, translations);
			files[`${language}.lproj/pass.strings`] = encoder.encode(
				lines.join("\n")
			);
		}
	}

	Object.assign(files, await collectImages(pass, warnings));

	// manifest.json — SHA1 hash of every file
	const manifest: Record<string, string> = {};
	for (const [name, content] of Object.entries(files)) {
		manifest[name] = createHash("sha1").update(content).digest("hex");
	}
	const manifestBytes = encoder.encode(JSON.stringify(manifest));

	const signature = await signManifestAsync({
		manifest: manifestBytes,
		signerCert: credentials.signerCert,
		signerKey: credentials.signerKey,
		signer: credentials.signer,
		wwdr: credentials.wwdr,
	});

	for (const [name, content] of Object.entries(files)) {
		zip.file(name, content);
	}
	zip.file("manifest.json", manifestBytes);
	zip.file("signature", signature);

	return { pass: await zip.generateAsync({ type: "uint8array" }), warnings };
}
