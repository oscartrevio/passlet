import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { AppleCredentials } from "../../../src/config";
import type { LoyaltyTemplateConfig } from "../../../src/schema/template";
import type { PassTemplate } from "../../../src/template";
import { Wallet } from "../../../src/wallet";
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
	vi.restoreAllMocks();
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

function expectBytes(
	actual: Uint8Array | undefined,
	expected: Uint8Array
): void {
	expect(actual && Buffer.from(actual).equals(expected)).toBe(true);
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
		expectBytes(full.files["icon.png"], Uint8Array.of(1));
		expectBytes(full.files["icon@2x.png"], Uint8Array.of(2));
		expectBytes(full.files["icon@3x.png"], Uint8Array.of(3));

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
		expectBytes(files["logo.png"], Uint8Array.of(4));
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

describe("downloads", () => {
	function template(): PassTemplate {
		return new Wallet({ apple: credentials }).loyalty({
			id: "img-cache",
			name: "Images",
			fields: [],
			apple: { icon: ICON, logo: LOGO_URL },
		});
	}

	async function logoOf(
		pass: PassTemplate,
		serialNumber: string
	): Promise<Uint8Array | undefined> {
		const { apple } = await pass.create({ serialNumber });
		if (!apple) {
			throw new Error("no .pkpass issued");
		}
		return (await readPkpass(apple)).files["logo.png"];
	}

	it("downloads a template's URL images once for all its passes", async () => {
		const respond = vi.fn(served({ [LOGO_URL]: Uint8Array.of(4) }));
		stubFetch(respond);
		const pass = template();

		expectBytes(await logoOf(pass, "img-001"), Uint8Array.of(4));
		expectBytes(await logoOf(pass, "img-002"), Uint8Array.of(4));
		expect(respond).toHaveBeenCalledTimes(1);
	});

	it("downloads again after a failed download", async () => {
		const respond = vi
			.fn<(url: string) => Response>()
			.mockReturnValueOnce(new Response(null, { status: 503 }))
			.mockImplementation(served({ [LOGO_URL]: Uint8Array.of(4) }));
		stubFetch(respond);
		const pass = template();

		await expect(logoOf(pass, "img-001")).rejects.toMatchObject({
			code: "IMAGE_FETCH_FAILED",
		});
		expectBytes(await logoOf(pass, "img-001"), Uint8Array.of(4));
		expect(respond).toHaveBeenCalledTimes(2);
	});

	it("gives up on a stalled image server with IMAGE_FETCH_NETWORK_ERROR", async () => {
		// Fire the download timeout at once instead of after its full wait.
		vi.spyOn(AbortSignal, "timeout").mockImplementation(() =>
			AbortSignal.abort(new DOMException("timed out", "TimeoutError"))
		);
		// A server that never answers: only the request's signal ends it.
		vi.stubGlobal(
			"fetch",
			vi.fn(
				(_: string, init?: RequestInit) =>
					new Promise<Response>((_resolve, reject) => {
						const signal = init?.signal;
						if (signal?.aborted) {
							reject(signal.reason);
						}
						signal?.addEventListener("abort", () => reject(signal.reason));
					})
			)
		);

		await expect(
			generate({ icon: ICON, logo: LOGO_URL })
		).rejects.toMatchObject({
			code: "IMAGE_FETCH_NETWORK_ERROR",
			cause: expect.objectContaining({ name: "TimeoutError" }),
		});
	});

	it("downloads every resolution of an image at once", async () => {
		let inFlight = 0;
		let mostInFlight = 0;
		stubFetch(async (url) => {
			inFlight += 1;
			mostInFlight = Math.max(mostInFlight, inFlight);
			await new Promise((resolve) => setTimeout(resolve, 5));
			inFlight -= 1;
			return new Response(Uint8Array.of(url.length));
		});

		await generate({ icon: ICON_URLS });
		expect(mostInFlight).toBe(3);
	});

	it("downloads a URL a template names twice once", async () => {
		const respond = vi.fn(served({ [LOGO_URL]: Uint8Array.of(4) }));
		stubFetch(respond);

		const { files } = await generate({
			icon: { base: LOGO_URL, retina: LOGO_URL },
			logo: LOGO_URL,
		});
		expect(respond).toHaveBeenCalledOnce();
		expectBytes(files["icon.png"], Uint8Array.of(4));
		expectBytes(files["icon@2x.png"], Uint8Array.of(4));
		expectBytes(files["logo.png"], Uint8Array.of(4));
	});
});

describe("image bytes", () => {
	// Images are hashed once per template; the archive must still match them.
	// `fs.readFile` hands out Buffers, whose slice() shares memory.
	it.each([
		["Uint8Array", () => PNG.slice()],
		["Buffer", () => Buffer.from(PNG)],
	])("keeps the bytes a template was given, even if the caller reuses its %s", async (_, copy) => {
		const icon = copy();
		const pass = new Wallet({ apple: credentials }).loyalty({
			id: "img-bytes",
			name: "Images",
			fields: [],
			apple: { icon },
		});
		await pass.create({ serialNumber: "img-001" });
		icon.fill(0);

		const { apple } = await pass.create({ serialNumber: "img-002" });
		if (!apple) {
			throw new Error("no .pkpass issued");
		}
		const { files, manifest, sha1 } = await readPkpass(apple);
		expectBytes(files["icon.png"], PNG);
		expect(manifest["icon.png"]).toBe(sha1["icon.png"]);
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
		await expect(generate({ icon: imageUrl })).rejects.toMatchObject({
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
		await expect(generate({ icon: imageUrl })).rejects.toMatchObject({
			code: "IMAGE_FETCH_NETWORK_ERROR",
			status: 502,
			cause,
		});
	});
});
