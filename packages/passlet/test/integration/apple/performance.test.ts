// Deterministic guards for work passlet must not repeat or serialize: each
// counts calls into node:crypto and node:zlib instead of timing anything.
import type * as Crypto from "node:crypto";
import type * as Zlib from "node:zlib";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppleCredentials } from "../../../src/config";
import { Wallet } from "../../../src/wallet";
import { appleCredentials, readPkpass } from "../../support/apple";

const observed = vi.hoisted(() => ({
	crc32: [] as Uint8Array[],
	sha1: [] as Uint8Array[],
	signsInFlight: 0,
	mostSignsInFlight: 0,
}));

vi.mock("node:crypto", async (importOriginal) => {
	const crypto = await importOriginal<typeof Crypto>();
	return {
		...crypto,
		hash: (...args: Parameters<typeof crypto.hash>) => {
			const [algorithm, data] = args;
			if (algorithm === "sha1" && data instanceof Uint8Array) {
				observed.sha1.push(data);
			}
			return crypto.hash(...args);
		},
		// Only a call with a callback runs on the threadpool.
		sign: (
			...[algorithm, data, key, callback]: Parameters<typeof crypto.sign>
		) => {
			if (typeof callback !== "function") {
				return crypto.sign(algorithm, data, key, callback);
			}
			observed.signsInFlight += 1;
			observed.mostSignsInFlight = Math.max(
				observed.mostSignsInFlight,
				observed.signsInFlight
			);
			return crypto.sign(algorithm, data, key, (error, signature) => {
				observed.signsInFlight -= 1;
				callback(error, signature);
			});
		},
	};
});

vi.mock("node:zlib", async (importOriginal) => {
	const zlib = await importOriginal<typeof Zlib>();
	return {
		...zlib,
		crc32: (...args: Parameters<typeof zlib.crc32>) => {
			const [data] = args;
			if (data instanceof Uint8Array) {
				observed.crc32.push(data);
			}
			return zlib.crc32(...args);
		},
	};
});

let credentials: AppleCredentials;

beforeAll(() => {
	credentials = appleCredentials();
});

beforeEach(() => {
	observed.crc32 = [];
	observed.sha1 = [];
	observed.mostSignsInFlight = 0;
});

/** How many digests were computed over exactly these bytes. */
function digestsOf(digested: Uint8Array[], bytes: Uint8Array): number {
	return digested.filter((data) => Buffer.from(data).equals(bytes)).length;
}

describe("Apple pass work", () => {
	it("hashes a template's images once for all its passes", async () => {
		// Big and distinct from anything else hashed in a pass.
		const icon = Buffer.alloc(64 * 1024, 7);
		const template = new Wallet({ apple: credentials }).loyalty({
			id: "hash-once",
			name: "Images",
			fields: [],
			apple: { icon },
		});

		for (const serialNumber of ["p-1", "p-2", "p-3"]) {
			const { apple } = await template.create({ serialNumber });
			if (!apple) {
				throw new Error("no .pkpass issued");
			}
			const { files, manifest, sha1 } = await readPkpass(apple);
			// Buffer#equals, not toEqual: a deep compare of 64 KB walks every byte
			// through the matcher and takes most of a second.
			expect(Buffer.from(files["icon.png"] ?? []).equals(icon)).toBe(true);
			expect(manifest["icon.png"]).toBe(sha1["icon.png"]);
		}
		expect(digestsOf(observed.sha1, icon)).toBe(1);
		expect(digestsOf(observed.crc32, icon)).toBe(1);
	});

	it("signs a bundle's passes in parallel, off the event loop", async () => {
		const wallet = new Wallet({ apple: credentials });
		const template = wallet.loyalty({
			id: "bundle",
			name: "Bundle",
			fields: [],
			apple: { icon: Buffer.alloc(16, 1) },
		});
		const items = Array.from({ length: 10 }, (_, index) => ({
			template,
			content: { serialNumber: `b-${index}` },
		}));

		await wallet.createBundle(items);
		expect(observed.mostSignsInFlight).toBe(items.length);
	});
});
