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

function buildPassJson(
	pass: PassConfig,
	createConfig: CreateConfig,
	credentials: AppleCredentials
): Record<string, unknown> {
	const passTypeKey = PASS_TYPE_KEY[pass.type] ?? "generic";
	const slots = buildSlots(pass.fields, createConfig.values ?? {});
	const { barcode } = createConfig;

	return {
		formatVersion: 1,
		passTypeIdentifier: credentials.passTypeIdentifier,
		serialNumber: createConfig.serialNumber,
		teamIdentifier: credentials.teamId,
		organizationName: pass.name,
		description: pass.apple?.description ?? pass.name,
		logoText: pass.apple?.logoText ?? pass.name,
		...(pass.color && { backgroundColor: hexToRgb(pass.color) }),
		...(pass.apple?.foregroundColor && {
			foregroundColor: hexToRgb(pass.apple.foregroundColor),
		}),
		...(pass.apple?.labelColor && {
			labelColor: hexToRgb(pass.apple.labelColor),
		}),
		...(createConfig.expiresAt && {
			expirationDate: createConfig.expiresAt,
		}),
		...(createConfig.apple?.voided && { voided: true }),
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
