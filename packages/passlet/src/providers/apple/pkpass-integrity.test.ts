import { createHash } from "node:crypto";
import JSZip from "jszip";
import { beforeAll, describe, expect, it } from "vitest";
import type { AppleCredentials } from "../../types/credentials";
import type { PassConfig } from "../../types/schemas";
import { generateApplePass } from "./index";
import { generateTestCerts } from "./test-certs";

const STUB_ICON = new Uint8Array([1, 2, 3]);

let credentials: AppleCredentials;

beforeAll(() => {
	const certs = generateTestCerts();
	credentials = {
		passTypeIdentifier: "pass.com.test.example",
		teamId: "ABCD1234EF",
		signerCert: certs.signerCert,
		signerKey: certs.signerKey,
		wwdr: certs.wwdr,
	};
}, 30_000);

const PASS: PassConfig = {
	type: "loyalty",
	id: "p1",
	name: "Integrity Test",
	color: "#1a1a2e",
	fields: [],
	apple: { icon: { base: STUB_ICON, retina: STUB_ICON } },
};

describe(".pkpass manifest integrity", () => {
	it("lists every payload file with a matching SHA-1 hash", async () => {
		const { pass } = await generateApplePass(
			PASS,
			{ serialNumber: "s1", barcode: { value: "ABC", format: "QR" } },
			credentials
		);
		const zip = await JSZip.loadAsync(pass);
		const manifest = JSON.parse(
			(await zip.file("manifest.json")?.async("string")) ?? "{}"
		) as Record<string, string>;

		const payloadNames = Object.keys(zip.files).filter(
			(name) => name !== "manifest.json" && name !== "signature"
		);
		expect(payloadNames.length).toBeGreaterThan(0);

		for (const name of payloadNames) {
			const bytes = await zip.file(name)?.async("uint8array");
			if (!bytes) {
				throw new Error(`missing ${name}`);
			}
			const expected = createHash("sha1").update(bytes).digest("hex");
			expect(manifest[name], `manifest hash for ${name}`).toBe(expected);
		}

		for (const name of Object.keys(manifest)) {
			expect(payloadNames, `manifest references ${name}`).toContain(name);
		}
	});
});
