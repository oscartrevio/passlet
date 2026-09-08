import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { generateApplePass } from "../../../src/providers/apple/index";
import type { AppleCredentials } from "../../../src/types/credentials";
import type {
	EventPassConfig,
	LoyaltyPassConfig,
	PassConfig,
} from "../../../src/types/schemas";
import {
	appleCredentials,
	ICON,
	type Pkpass,
	PNG,
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

function loyalty(apple: LoyaltyPassConfig["apple"]): PassConfig {
	return {
		type: "loyalty",
		id: "img-loyalty",
		name: "Images",
		fields: [],
		apple,
	};
}

function event(apple: EventPassConfig["apple"]): PassConfig {
	return { type: "event", id: "img-event", name: "Images", fields: [], apple };
}

async function generate(
	pass: PassConfig
): Promise<Pkpass & { warnings: string[] }> {
	const { pass: bytes, warnings } = await generateApplePass(
		pass,
		{ serialNumber: "img-001" },
		credentials
	);
	return { ...(await readPkpass(bytes)), warnings };
}

describe("icon", () => {
	it("names URL variants by scale and warns only when @2x is missing", async () => {
		stubFetch(
			served({
				[ICON_URLS.base]: Uint8Array.of(1),
				[ICON_URLS.retina]: Uint8Array.of(2),
				[ICON_URLS.superRetina]: Uint8Array.of(3),
			})
		);

		const full = await generate(loyalty({ icon: ICON_URLS }));
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
		expect(full.warnings).toEqual([]);

		const bare = await generate(loyalty({ icon: ICON_URLS.base }));
		expect(bare.entries).toEqual([
			"icon.png",
			"manifest.json",
			"pass.json",
			"signature",
		]);
		expect(bare.warnings).toEqual([expect.stringContaining("icon@2x")]);
	});

	it.each([
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
	])("rejects with $code when the required icon URL hits $failure", async ({
		code,
		respond,
	}) => {
		stubFetch(respond);

		await expect(generate(loyalty({ icon: ICON_URLS.base }))).rejects.toThrow(
			expect.objectContaining({ code })
		);
	});
});

describe("optional images", () => {
	it("still generates the pass when a logo URL fails, with a warning", async () => {
		stubFetch(served({}));

		const { entries, warnings } = await generate(
			loyalty({ icon: ICON, logo: LOGO_URL })
		);

		expect(entries).toEqual([
			"icon.png",
			"icon@2x.png",
			"manifest.json",
			"pass.json",
			"signature",
		]);
		expect(warnings).toEqual([expect.stringContaining("logo.png")]);
	});

	// Apple renders the strip and ignores background/thumbnail on event tickets.
	it("warns when an event ticket sets both strip and background", async () => {
		const both = await generate(
			event({ icon: ICON, strip: PNG, background: PNG })
		);
		expect(both.warnings).toEqual([expect.stringContaining("strip")]);

		const stripOnly = await generate(event({ icon: ICON, strip: PNG }));
		expect(stripOnly.warnings).toEqual([]);
	});
});
