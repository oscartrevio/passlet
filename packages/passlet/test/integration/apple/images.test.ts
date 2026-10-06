import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { resolveImageSet } from "../../../src/apple/images";
import type { AppleCredentials } from "../../../src/schema/settings";
import type { LoyaltyTemplateConfig } from "../../../src/schema/template";
import { Wallet } from "../../../src/wallet";
import {
	appleCredentials,
	ICON,
	type Pkpass,
	readPkpass,
} from "../../support/apple";

const CDN = "https://cdn.example.com";
const ICON_URLS = {
	base: `${CDN}/icon.png`,
	retina: `${CDN}/icon-2x.png`,
	superRetina: `${CDN}/icon-3x.png`,
};
const LOGO_URL = `${CDN}/logo.png`;

let credentials: AppleCredentials;

beforeAll(() => {
	credentials = appleCredentials();
});

afterEach(() => {
	vi.unstubAllGlobals();
});

/** Replaces global fetch until afterEach unstubs it. */
function stubFetch(
	respond: (url: string) => Response | Promise<Response>
): void {
	vi.stubGlobal(
		"fetch",
		vi.fn((input: string | URL | Request) =>
			Promise.resolve(respond(String(input)))
		)
	);
}

/** Serves each URL's bytes; anything else is a 404. */
function served(
	images: Record<string, Uint8Array<ArrayBuffer>>
): (url: string) => Response {
	return (url) => {
		const bytes = images[url];
		return bytes ? new Response(bytes) : new Response(null, { status: 404 });
	};
}

/** Issue a loyalty pass with these Apple options and open its archive. */
async function generate(
	apple: LoyaltyTemplateConfig["apple"]
): Promise<Pkpass> {
	const { apple: bytes } = await new Wallet({ apple: credentials })
		.loyalty({ id: "img-loyalty", name: "Images", fields: [], apple })
		.create({ serialNumber: "img-001" });
	if (!bytes) {
		throw new Error("no .pkpass issued");
	}
	return await readPkpass(bytes);
}

const FAILURES = [
	{
		code: "IMAGE_FETCH_FAILED",
		failure: "a non-2xx response",
		respond: () => new Response(null, { status: 500 }),
	},
	{
		code: "IMAGE_FETCH_NETWORK_ERROR",
		failure: "a network error",
		respond: () => Promise.reject(new TypeError("fetch failed")),
	},
];

describe("icon", () => {
	it("names URL variants by scale", async () => {
		stubFetch(
			served({
				[ICON_URLS.base]: Uint8Array.of(1),
				[ICON_URLS.retina]: Uint8Array.of(2),
				[ICON_URLS.superRetina]: Uint8Array.of(3),
			})
		);

		const full = await generate({ icon: ICON_URLS });
		expect(full.entries).toEqual([
			"icon.png",
			"icon@2x.png",
			"icon@3x.png",
			"manifest.json",
			"pass.json",
			"signature",
		]);
		expect([
			full.files["icon.png"],
			full.files["icon@2x.png"],
			full.files["icon@3x.png"],
		]).toEqual([Uint8Array.of(1), Uint8Array.of(2), Uint8Array.of(3)]);

		const bare = await generate({ icon: ICON_URLS.base });
		expect(bare.entries).toEqual([
			"icon.png",
			"manifest.json",
			"pass.json",
			"signature",
		]);
	});

	it.each(
		FAILURES
	)("rejects with $code when the icon URL hits $failure", async ({
		code,
		respond,
	}) => {
		stubFetch(respond);

		await expect(generate({ icon: ICON_URLS.base })).rejects.toThrow(
			expect.objectContaining({ code })
		);
	});
});

describe("other images", () => {
	it("packs a logo URL under logo.png", async () => {
		stubFetch(served({ [LOGO_URL]: Uint8Array.of(4) }));

		const { entries, files } = await generate({ icon: ICON, logo: LOGO_URL });

		expect(entries).toEqual([
			"icon.png",
			"icon@2x.png",
			"logo.png",
			"manifest.json",
			"pass.json",
			"signature",
		]);
		expect(files["logo.png"]).toEqual(Uint8Array.of(4));
	});

	// The template asked for the image; a pass silently missing it is a bug.
	it.each(FAILURES)("rejects with $code when a logo URL hits $failure", async ({
		code,
		respond,
	}) => {
		stubFetch(respond);

		await expect(generate({ icon: ICON, logo: LOGO_URL })).rejects.toThrow(
			expect.objectContaining({ code })
		);
	});
});

describe("image failures", () => {
	const imageUrl = "https://images.example/icon.png?token=private-image-token";

	it("reports HTTP status without exposing signed image URLs", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(() =>
				Promise.resolve(new Response("private-response", { status: 403 }))
			)
		);
		await expect(resolveImageSet("icon", imageUrl)).rejects.toMatchObject({
			code: "IMAGE_FETCH_FAILED",
			status: 403,
			message: expect.not.stringContaining("private"),
		});
	});

	it("classifies interrupted image bodies as network failures", async () => {
		const cause = new Error("connection reset");
		vi.stubGlobal(
			"fetch",
			vi.fn(() =>
				Promise.resolve(
					new Response(
						new ReadableStream({
							start(controller) {
								controller.error(cause);
							},
						})
					)
				)
			)
		);
		await expect(resolveImageSet("icon", imageUrl)).rejects.toMatchObject({
			code: "IMAGE_FETCH_NETWORK_ERROR",
			status: 502,
			cause,
		});
	});
});
