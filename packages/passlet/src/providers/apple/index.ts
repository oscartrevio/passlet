import { createHash } from "node:crypto";
import JSZip from "jszip";
import { WalletError } from "../../errors";
import type { AppleCredentials } from "../../types/credentials";
import type { CreateConfig, FieldDef, PassConfig } from "../../types/schemas";
import { signManifest } from "./signer";
import {
	hexToRgb,
	resolveImageSet,
	resolveRequiredImageSet,
	toAppleBarcodeFormat,
} from "./utils";

// Apple pass type → pass.json key
const PASS_TYPE_KEY: Record<string, string> = {
	loyalty: "storeCard",
	coupon: "coupon",
	event: "eventTicket",
	flight: "boardingPass",
	giftCard: "storeCard",
	generic: "generic",
};

const TRANSIT_TYPE: Record<string, string> = {
	air: "PKTransitTypeAir",
	train: "PKTransitTypeTrain",
	bus: "PKTransitTypeBus",
	boat: "PKTransitTypeBoat",
};

// Apple field slot → pass.json key
const SLOT_KEY: Record<FieldDef["slot"], string> = {
	header: "headerFields",
	primary: "primaryFields",
	secondary: "secondaryFields",
	auxiliary: "auxiliaryFields",
	back: "backFields",
};

function validateAppleRequirements(pass: PassConfig): void {
	if (!pass.apple?.icon) {
		throw new WalletError("APPLE_MISSING_ICON");
	}
	if (pass.type === "flight" && !pass.transitType) {
		throw new WalletError("APPLE_BOARDING_MISSING_TRANSIT_TYPE");
	}
}

function buildSlots(
	fields: FieldDef[],
	values: Record<string, string | null>
): Record<string, unknown[]> {
	const slots: Record<string, unknown[]> = {
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

		slots[SLOT_KEY[f.slot]]?.push({
			key: f.key,
			label: f.label,
			value,
			...(f.changeMessage && { changeMessage: f.changeMessage }),
			...(f.dateStyle && { dateStyle: f.dateStyle }),
			...(f.timeStyle && { timeStyle: f.timeStyle }),
			...(f.numberStyle && { numberStyle: f.numberStyle }),
			...(f.currencyCode && { currencyCode: f.currencyCode }),
			...(f.textAlignment && { textAlignment: f.textAlignment }),
			...(f.row !== undefined && { row: f.row }),
		});
	}

	return slots;
}

function buildPassTypeContent(
	pass: PassConfig,
	slots: Record<string, unknown[]>
): Record<string, unknown> {
	const content: Record<string, unknown> = { ...slots };
	if (pass.type === "flight") {
		content.transitType =
			TRANSIT_TYPE[pass.transitType ?? "air"] ?? "PKTransitTypeAir";
	}
	return content;
}

type EventPass = Extract<PassConfig, { type: "event" }>;
type FlightPass = Extract<PassConfig, { type: "flight" }>;

function buildEventAppleFields(pass: EventPass): Record<string, unknown> {
	const a = pass.apple;
	return {
		...(a?.eventLogoText && { eventLogoText: a.eventLogoText }),
		...(a?.footerBackgroundColor && {
			footerBackgroundColor: hexToRgb(a.footerBackgroundColor),
		}),
		...(a?.suppressHeaderDarkening !== undefined && {
			suppressHeaderDarkening: a.suppressHeaderDarkening,
		}),
		...(a?.useAutomaticColors !== undefined && {
			useAutomaticColors: a.useAutomaticColors,
		}),
		...(a?.preferredStyleSchemes && {
			preferredStyleSchemes: a.preferredStyleSchemes,
		}),
		...(a?.auxiliaryStoreIdentifiers && {
			auxiliaryStoreIdentifiers: a.auxiliaryStoreIdentifiers,
		}),
		...(a?.accessibilityURL && { accessibilityURL: a.accessibilityURL }),
		...(a?.addOnURL && { addOnURL: a.addOnURL }),
		...(a?.bagPolicyURL && { bagPolicyURL: a.bagPolicyURL }),
		...(a?.contactVenueEmail && { contactVenueEmail: a.contactVenueEmail }),
		...(a?.contactVenuePhoneNumber && {
			contactVenuePhoneNumber: a.contactVenuePhoneNumber,
		}),
		...(a?.contactVenueWebsite && {
			contactVenueWebsite: a.contactVenueWebsite,
		}),
		...(a?.directionsInformationURL && {
			directionsInformationURL: a.directionsInformationURL,
		}),
		...(a?.merchandiseURL && { merchandiseURL: a.merchandiseURL }),
		...(a?.orderFoodURL && { orderFoodURL: a.orderFoodURL }),
		...(a?.parkingInformationURL && {
			parkingInformationURL: a.parkingInformationURL,
		}),
		...(a?.purchaseParkingURL && { purchaseParkingURL: a.purchaseParkingURL }),
		...(a?.sellURL && { sellURL: a.sellURL }),
		...(a?.transferURL && { transferURL: a.transferURL }),
		...(a?.transitInformationURL && {
			transitInformationURL: a.transitInformationURL,
		}),
	};
}

function buildFlightAppleFields(pass: FlightPass): Record<string, unknown> {
	const a = pass.apple;
	return {
		...(a?.changeSeatURL && { changeSeatURL: a.changeSeatURL }),
		...(a?.entertainmentURL && { entertainmentURL: a.entertainmentURL }),
		...(a?.managementURL && { managementURL: a.managementURL }),
		...(a?.purchaseAdditionalBaggageURL && {
			purchaseAdditionalBaggageURL: a.purchaseAdditionalBaggageURL,
		}),
		...(a?.purchaseLoungeAccessURL && {
			purchaseLoungeAccessURL: a.purchaseLoungeAccessURL,
		}),
		...(a?.purchaseWifiURL && { purchaseWifiURL: a.purchaseWifiURL }),
		...(a?.registerServiceAnimalURL && {
			registerServiceAnimalURL: a.registerServiceAnimalURL,
		}),
		...(a?.reportLostBagURL && { reportLostBagURL: a.reportLostBagURL }),
		...(a?.requestWheelchairURL && {
			requestWheelchairURL: a.requestWheelchairURL,
		}),
		...(a?.trackBagsURL && { trackBagsURL: a.trackBagsURL }),
		...(a?.transitProviderEmail && {
			transitProviderEmail: a.transitProviderEmail,
		}),
		...(a?.transitProviderPhoneNumber && {
			transitProviderPhoneNumber: a.transitProviderPhoneNumber,
		}),
		...(a?.transitProviderWebsiteURL && {
			transitProviderWebsiteURL: a.transitProviderWebsiteURL,
		}),
		...(a?.upgradeURL && { upgradeURL: a.upgradeURL }),
	};
}

function buildMediaFields(
	pass: PassConfig,
	createConfig: CreateConfig
): Record<string, unknown> {
	const { barcode } = createConfig;
	return {
		...(barcode && {
			barcodes: [
				{
					message: barcode.value,
					format: toAppleBarcodeFormat(barcode.format),
					messageEncoding: "iso-8859-1",
					altText: barcode.altText ?? barcode.value,
				},
			],
		}),
		// Apple supports up to 10 locations. altitude and relevantText are Apple-only.
		...(pass.locations && {
			locations: pass.locations.map(
				({ latitude, longitude, altitude, relevantText }) => ({
					latitude,
					longitude,
					...(altitude !== undefined && { altitude }),
					...(relevantText && { relevantText }),
				})
			),
		}),
	};
}

function buildAppleCommonFields(
	pass: PassConfig,
	createConfig: CreateConfig
): Record<string, unknown> {
	const a = pass.apple;
	return {
		...(pass.color && { backgroundColor: hexToRgb(pass.color) }),
		...(a?.foregroundColor && { foregroundColor: hexToRgb(a.foregroundColor) }),
		...(a?.labelColor && { labelColor: hexToRgb(a.labelColor) }),
		...(createConfig.expiresAt && { expirationDate: createConfig.expiresAt }),
		...(createConfig.apple?.voided && { voided: true }),
		...(a?.beacons && { beacons: a.beacons }),
		...(a?.relevantDate && { relevantDate: a.relevantDate }),
		...(a?.relevantDates && { relevantDates: a.relevantDates }),
		...(a?.groupingIdentifier && { groupingIdentifier: a.groupingIdentifier }),
		...(a?.suppressStripShine !== undefined && {
			suppressStripShine: a.suppressStripShine,
		}),
		...(a?.sharingProhibited !== undefined && {
			sharingProhibited: a.sharingProhibited,
		}),
		...(a?.maxDistance !== undefined && { maxDistance: a.maxDistance }),
		...(a?.nfc && {
			nfc: {
				message: a.nfc.message,
				...(a.nfc.encryptionPublicKey && {
					encryptionPublicKey: a.nfc.encryptionPublicKey,
				}),
			},
		}),
		...(a?.appLaunchURL && { appLaunchURL: a.appLaunchURL }),
		...(a?.associatedStoreIdentifiers && {
			associatedStoreIdentifiers: a.associatedStoreIdentifiers,
		}),
		...(a?.webServiceURL && {
			webServiceURL: a.webServiceURL,
			authenticationToken: a.authenticationToken,
		}),
		...(a?.userInfo && { userInfo: a.userInfo }),
	};
}

function buildPassJson(
	pass: PassConfig,
	createConfig: CreateConfig,
	credentials: AppleCredentials
): Record<string, unknown> {
	const passTypeKey = PASS_TYPE_KEY[pass.type] ?? "generic";
	const slots = buildSlots(pass.fields, createConfig.values ?? {});
	const a = pass.apple;

	return {
		formatVersion: 1,
		passTypeIdentifier: credentials.passTypeIdentifier,
		serialNumber: createConfig.serialNumber,
		teamIdentifier: credentials.teamId,
		organizationName: pass.name,
		description: a?.description ?? pass.name,
		logoText: a?.logoText ?? pass.name,
		...buildAppleCommonFields(pass, createConfig),
		...buildMediaFields(pass, createConfig),
		...(pass.type === "event" && buildEventAppleFields(pass)),
		...(pass.type === "flight" && buildFlightAppleFields(pass)),
		[passTypeKey]: buildPassTypeContent(pass, slots),
	};
}

async function collectImages(
	pass: PassConfig,
	warnings: string[]
): Promise<Record<string, Uint8Array>> {
	const images: Record<string, Uint8Array> = {};

	// icon is required — validateAppleRequirements() throws before we reach here if missing
	const icon = pass.apple?.icon;
	if (!icon) {
		throw new WalletError("APPLE_MISSING_ICON");
	}
	const iconFiles = await resolveRequiredImageSet("icon", icon);
	Object.assign(images, iconFiles);

	// All other images are optional — adds warnings on failure
	const optional = await Promise.all([
		resolveImageSet("logo", pass.logo, warnings),
		resolveImageSet("strip", pass.banner, warnings), // banner → strip on Apple
		resolveImageSet("background", pass.apple?.background, warnings),
		resolveImageSet("thumbnail", pass.apple?.thumbnail, warnings),
		resolveImageSet("footer", pass.apple?.footer, warnings),
	]);
	for (const set of optional) {
		Object.assign(images, set);
	}

	return images;
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

	// pass.json
	const passJson = buildPassJson(pass, createConfig, credentials);
	files["pass.json"] = encoder.encode(JSON.stringify(passJson));

	// Images
	const images = await collectImages(pass, warnings);
	for (const [name, bytes] of Object.entries(images)) {
		files[name] = bytes;
	}

	// manifest.json — SHA1 hash of every file
	const manifest: Record<string, string> = {};
	for (const [name, content] of Object.entries(files)) {
		manifest[name] = createHash("sha1").update(content).digest("hex");
	}
	const manifestBytes = encoder.encode(JSON.stringify(manifest));

	// signature — PKCS#7 detached signature of manifest.json
	const signature = signManifest({
		manifest: manifestBytes,
		signerCert: credentials.signerCert,
		signerKey: credentials.signerKey,
		wwdr: credentials.wwdr,
	});

	for (const [name, content] of Object.entries(files)) {
		zip.file(name, content);
	}
	zip.file("manifest.json", manifestBytes);
	zip.file("signature", signature);

	return { pass: await zip.generateAsync({ type: "uint8array" }), warnings };
}
