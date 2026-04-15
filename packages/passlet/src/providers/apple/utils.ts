import { WalletError } from "../../errors";
import type { BarcodeFormat, ImageSet } from "../../types/schemas";

// Convert a 6-digit hex color to Apple's rgb() format.
// Apple pass.json requires colors as "rgb(r, g, b)" strings.
export function hexToRgb(hex: string): string {
	const clean = hex.replace("#", "");
	const r = Number.parseInt(clean.slice(0, 2), 16);
	const g = Number.parseInt(clean.slice(2, 4), 16);
	const b = Number.parseInt(clean.slice(4, 6), 16);
	return `rgb(${r}, ${g}, ${b})`;
}

const APPLE_BARCODE_FORMAT: Record<BarcodeFormat, string> = {
	QR: "PKBarcodeFormatQR",
	PDF417: "PKBarcodeFormatPDF417",
	Aztec: "PKBarcodeFormatAztec",
	Code128: "PKBarcodeFormatCode128",
};

export function toAppleBarcodeFormat(format: BarcodeFormat): string {
	return APPLE_BARCODE_FORMAT[format];
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

async function resolveImageSetWithMode(
	name: string,
	imageSet: ImageSet,
	options: { warnings?: string[]; required: boolean }
): Promise<Record<string, Uint8Array>> {
	const files: Record<string, Uint8Array> = {};

	const load = async (filename: string, src: string | Uint8Array) => {
		if (options.required) {
			files[filename] = await resolveSource(src);
			return;
		}
		try {
			files[filename] = await resolveSource(src);
		} catch (error) {
			options.warnings?.push(
				`Could not load ${filename}: ${error instanceof Error ? error.message : String(error)}`
			);
		}
	};

	if (typeof imageSet === "string" || imageSet instanceof Uint8Array) {
		await load(`${name}.png`, imageSet);
		return files;
	}

	await load(`${name}.png`, imageSet.base);
	if (imageSet.retina) {
		await load(`${name}@2x.png`, imageSet.retina);
	}
	if (imageSet.superRetina) {
		await load(`${name}@3x.png`, imageSet.superRetina);
	}

	return files;
}

// Resolve an ImageSet into named Apple image files (base.png, @2x, @3x).
// Returns a record of filename → bytes. Optional images that fail to load
// are skipped and a warning is added.
export function resolveImageSet(
	name: string,
	imageSet: ImageSet | undefined,
	warnings: string[]
): Promise<Record<string, Uint8Array>> {
	if (!imageSet) {
		return Promise.resolve({});
	}
	return resolveImageSetWithMode(name, imageSet, { warnings, required: false });
}

// Same as resolveImageSet but throws instead of warning — for required images.
export function resolveRequiredImageSet(
	name: string,
	imageSet: ImageSet
): Promise<Record<string, Uint8Array>> {
	return resolveImageSetWithMode(name, imageSet, { required: true });
}
