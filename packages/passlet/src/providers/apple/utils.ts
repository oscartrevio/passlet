import { WalletError } from "../../errors";
import type { ImageSet } from "../../types/schemas";

// Convert a 6-digit hex color to Apple's rgb() format.
// Apple pass.json requires colors as "rgb(r, g, b)" strings.
export function hexToRgb(hex: string): string {
	const clean = hex.replace("#", "");
	const r = Number.parseInt(clean.slice(0, 2), 16);
	const g = Number.parseInt(clean.slice(2, 4), 16);
	const b = Number.parseInt(clean.slice(4, 6), 16);
	return `rgb(${r}, ${g}, ${b})`;
}

const APPLE_BARCODE_FORMAT: Record<string, string> = {
	QR: "PKBarcodeFormatQR",
	PDF417: "PKBarcodeFormatPDF417",
	Aztec: "PKBarcodeFormatAztec",
	Code128: "PKBarcodeFormatCode128",
};

export function toAppleBarcodeFormat(format: string): string {
	return APPLE_BARCODE_FORMAT[format] ?? "PKBarcodeFormatQR";
}

async function fetchAsBytes(url: string): Promise<Uint8Array> {
	let response: Response;
	try {
		response = await fetch(url);
	} catch (cause) {
		throw new WalletError(
			"IMAGE_FETCH_NETWORK_ERROR",
			`Failed to fetch image: ${url} (network error)`,
			{ cause }
		);
	}
	if (!response.ok) {
		throw new WalletError(
			"IMAGE_FETCH_FAILED",
			`Failed to fetch image: ${url} (${response.status})`
		);
	}
	return new Uint8Array(await response.arrayBuffer());
}

function resolveSource(src: string | Uint8Array): Promise<Uint8Array> {
	return src instanceof Uint8Array ? Promise.resolve(src) : fetchAsBytes(src);
}

// Resolve an ImageSet into named Apple image files (base.png, @2x, @3x).
// Returns a record of filename → bytes. Optional images that fail to load
// are skipped and a warning is added.
export async function resolveImageSet(
	name: string,
	imageSet: ImageSet | undefined,
	warnings: string[]
): Promise<Record<string, Uint8Array>> {
	if (!imageSet) {
		return {};
	}

	const files: Record<string, Uint8Array> = {};

	const tryLoad = async (filename: string, src: string | Uint8Array) => {
		try {
			files[filename] = await resolveSource(src);
		} catch (e) {
			warnings.push(
				`Could not load ${filename}: ${e instanceof Error ? e.message : String(e)}`
			);
		}
	};

	if (typeof imageSet === "string" || imageSet instanceof Uint8Array) {
		await tryLoad(`${name}.png`, imageSet);
	} else {
		await tryLoad(`${name}.png`, imageSet.base);
		if (imageSet.retina) {
			await tryLoad(`${name}@2x.png`, imageSet.retina);
		}
		if (imageSet.superRetina) {
			await tryLoad(`${name}@3x.png`, imageSet.superRetina);
		}
	}

	return files;
}

// Same as resolveImageSet but throws instead of warning — for required images.
export async function resolveRequiredImageSet(
	name: string,
	imageSet: ImageSet
): Promise<Record<string, Uint8Array>> {
	const files: Record<string, Uint8Array> = {};

	if (typeof imageSet === "string" || imageSet instanceof Uint8Array) {
		files[`${name}.png`] = await resolveSource(imageSet);
	} else {
		files[`${name}.png`] = await resolveSource(imageSet.base);
		if (imageSet.retina) {
			files[`${name}@2x.png`] = await resolveSource(imageSet.retina);
		}
		if (imageSet.superRetina) {
			files[`${name}@3x.png`] = await resolveSource(imageSet.superRetina);
		}
	}

	return files;
}
