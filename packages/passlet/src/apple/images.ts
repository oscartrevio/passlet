import { WalletError } from "../errors";
import { discardBody } from "../http";
import type { ImageSet } from "../schema/parts";
import type { ParsedTemplate } from "../schema/template";

// An image server that hasn't sent the whole image in ten seconds is stalled;
// the pass, and any web service request waiting on it, shouldn't wait longer.
const IMAGE_FETCH_TIMEOUT_MS = 10_000;

async function fetchAsBytes(url: string): Promise<Uint8Array> {
	try {
		// The signal also covers reading the body.
		const response = await fetch(url, {
			signal: AbortSignal.timeout(IMAGE_FETCH_TIMEOUT_MS),
		});
		if (!response.ok) {
			discardBody(response);
			throw new WalletError("IMAGE_FETCH_FAILED", undefined, {
				status: response.status,
			});
		}
		return new Uint8Array(await response.arrayBuffer());
	} catch (cause) {
		if (cause instanceof WalletError) {
			throw cause;
		}
		throw new WalletError("IMAGE_FETCH_NETWORK_ERROR", undefined, { cause });
	}
}

/**
 * Load every resolution of one image into `<name>.png`, `<name>@2x.png` and
 * `<name>@3x.png`. A template that names an image needs it, so any failed
 * download rejects with the image error.
 */
export async function resolveImageSet(
	name: string,
	imageSet: ImageSet | undefined
): Promise<Record<string, Uint8Array>> {
	if (!imageSet) {
		return {};
	}
	const sources: [string, string | Uint8Array | undefined][] =
		typeof imageSet === "string" || imageSet instanceof Uint8Array
			? [[`${name}.png`, imageSet]]
			: [
					[`${name}.png`, imageSet.base],
					[`${name}@2x.png`, imageSet.retina],
					[`${name}@3x.png`, imageSet.superRetina],
				];
	const files: Record<string, Uint8Array> = {};
	for (const [filename, src] of sources) {
		if (src) {
			files[filename] =
				src instanceof Uint8Array ? src : await fetchAsBytes(src);
		}
	}
	return files;
}

/**
 * Every image file a template's Apple options name, keyed by archive path.
 * Loaded once per template into `cache`: every pass from it, including each
 * one the web service renders for a device, reuses the same bytes. A failed
 * download is dropped from `cache`, so the next pass retries it.
 */
export function collectImages(
	template: ParsedTemplate,
	cache: WeakMap<ParsedTemplate, Promise<Record<string, Uint8Array>>>
): Promise<Record<string, Uint8Array>> {
	let images = cache.get(template);
	if (!images) {
		images = loadImages(template);
		cache.set(template, images);
		images.catch(() => cache.delete(template));
	}
	return images;
}

async function loadImages(
	template: ParsedTemplate
): Promise<Record<string, Uint8Array>> {
	const apple = template.apple;
	if (!apple?.icon) {
		throw new WalletError("APPLE_MISSING_ICON");
	}
	const sets = await Promise.all([
		resolveImageSet("icon", apple.icon),
		resolveImageSet("logo", apple.logo),
		resolveImageSet("strip", apple.strip),
		resolveImageSet("background", apple.background),
		resolveImageSet("thumbnail", apple.thumbnail),
		resolveImageSet("footer", apple.footer),
	]);
	return Object.assign({}, ...sets);
}
