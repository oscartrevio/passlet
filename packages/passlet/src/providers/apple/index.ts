import { createHash } from "node:crypto";
import JSZip from "jszip";
import { WalletError } from "../../errors";
import type { AppleCredentials } from "../../types/credentials";
import type {
	Barcode,
	CreateConfig,
	FieldDef,
	PassConfig,
} from "../../types/schemas";
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

function buildPassJson(
	pass: PassConfig,
	createConfig: CreateConfig,
	credentials: AppleCredentials,
	barcode: Barcode | undefined
): Record<string, unknown> {
	const passTypeKey = PASS_TYPE_KEY[pass.type] ?? "generic";
	const values = createConfig.values ?? {};
	const slots = buildSlots(pass.fields, values);

	const json: Record<string, unknown> = {
		formatVersion: 1,
		passTypeIdentifier: credentials.passTypeIdentifier,
		serialNumber: createConfig.serialNumber,
		teamIdentifier: credentials.teamId,
		organizationName: pass.name,
		description: pass.apple?.description ?? pass.name,
		logoText: pass.apple?.logoText ?? pass.name,
	};

	if (pass.color) {
		json.backgroundColor = hexToRgb(pass.color);
	}
	if (pass.apple?.foregroundColor) {
		json.foregroundColor = hexToRgb(pass.apple.foregroundColor);
	}
	if (pass.apple?.labelColor) {
		json.labelColor = hexToRgb(pass.apple.labelColor);
	}
	if (createConfig.expiresAt) {
		json.expirationDate = createConfig.expiresAt.toISOString();
	}

	if (barcode) {
		json.barcodes = [
			{
				message: barcode.value,
				format: toAppleBarcodeFormat(barcode.format),
				messageEncoding: "iso-8859-1",
				altText: barcode.altText ?? barcode.value,
			},
		];
	}

	// Pass type content
	const passContent: Record<string, unknown> = { ...slots };
	if (pass.type === "flight") {
		passContent.transitType =
			TRANSIT_TYPE[pass.transitType ?? "air"] ?? "PKTransitTypeAir";
	}

	// Escape hatch — merge arbitrary pass.json fields
	if (pass.apple?.extend) {
		Object.assign(json, pass.apple.extend);
	}

	json[passTypeKey] = passContent;
	return json;
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
	const barcode = createConfig.barcode;
	const warnings: string[] = [];

	validateAppleRequirements(pass);

	const encoder = new TextEncoder();
	const zip = new JSZip();
	const files: Record<string, Uint8Array> = {};

	// pass.json
	const passJson = buildPassJson(pass, createConfig, credentials, barcode);
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
