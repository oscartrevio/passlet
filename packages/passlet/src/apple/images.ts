import { WalletError } from "../errors";
import { discardBody } from "../http";
import type { ImageSet, ImageSource } from "../schema/parts";
import type { ParsedTemplate } from "../schema/template";
import { type PassFile, passFile } from "./package";

// An image server that hasn't sent the whole image in ten seconds is stalled;
// the pass, and any web service request waiting on it, shouldn't wait longer.
const IMAGE_FETCH_TIMEOUT_MS = 10_000;

// The image slots of Apple's pass, named as the archive files they become.
// https://developer.apple.com/documentation/walletpasses/creating-the-source-for-a-pass
const SLOTS = [
	"icon",
	"logo",
	"strip",
	"background",
	"thumbnail",
	"footer",
] as const;

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

/** `<slot>.png`, `<slot>@2x.png` and `<slot>@3x.png`, for each resolution given. */
function imageFiles(
	slot: string,
	imageSet: ImageSet | undefined
): [name: string, source: ImageSource][] {
	if (imageSet === undefined) {
		return [];
	}
	if (typeof imageSet === "string" || imageSet instanceof Uint8Array) {
		return [[`${slot}.png`, imageSet]];
	}
	const files: [string, ImageSource | undefined][] = [
		[`${slot}.png`, imageSet.base],
		[`${slot}@2x.png`, imageSet.retina],
		[`${slot}@3x.png`, imageSet.superRetina],
	];
	return files.filter((file): file is [string, ImageSource] => !!file[1]);
}

/**
 * Every image file a template's Apple options name, hashed for the archive.
 * Loaded once per template into `cache`: every pass from it, including each
 * one the web service renders for a device, reuses the same files. A failed
 * download is dropped from `cache`, so the next pass retries it.
 */
export function collectImages(
	template: ParsedTemplate,
	cache: WeakMap<ParsedTemplate, Promise<readonly PassFile[]>>
): Promise<readonly PassFile[]> {
	let images = cache.get(template);
	if (!images) {
		images = loadImages(template);
		cache.set(template, images);
		images.catch(() => cache.delete(template));
	}
	return images;
}

/**
 * Download every URL at once, each distinct source once (icon and logo often
 * share one), and hash each distinct source once. A template that names an
 * image needs it, so any failed download rejects with the image error.
 */
function loadImages(template: ParsedTemplate): Promise<PassFile[]> {
	const apple = template.apple;
	const sources = new Map<ImageSource, Promise<PassFile>>();
	return Promise.all(
		SLOTS.flatMap((slot) => imageFiles(slot, apple?.[slot])).map(
			async ([name, source]) => {
				let file = sources.get(source);
				if (!file) {
					// Copied, so a caller reusing its buffer can't change bytes
					// whose digests are already cached. `new Uint8Array(source)`
					// copies even a Buffer, whose slice() is only a view.
					file = (
						typeof source === "string"
							? fetchAsBytes(source)
							: Promise.resolve(new Uint8Array(source))
					).then((data) => passFile(name, data));
					sources.set(source, file);
				}
				return { ...(await file), name };
			}
		)
	);
}
