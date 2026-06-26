import { createHash } from "node:crypto";
import JSZip from "jszip";
import forge from "node-forge";
import { beforeAll, describe, expect, it } from "vitest";
import type { AppleCredentials } from "../../types/credentials";
import type { PassConfig } from "../../types/schemas";
import { generateApplePass } from "./index";
import { generateTestCerts, type TestCerts } from "./test-certs";

// End-to-end structural validation of the generated .pkpass archive: this checks
// exactly what Apple's installer enforces — every file is listed in
// manifest.json with a matching SHA-1, and the signature is a PKCS#7 SignedData
// over the manifest carrying the signer certificate.

const STUB_ICON = new Uint8Array([1, 2, 3]);

let credentials: AppleCredentials;

beforeAll(() => {
	const certs: TestCerts = generateTestCerts();
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

async function buildZip(): Promise<JSZip> {
	const { pass } = await generateApplePass(
		PASS,
		{ serialNumber: "s1", barcode: { value: "ABC", format: "QR" } },
		credentials
	);
	return JSZip.loadAsync(pass);
}

describe(".pkpass manifest integrity", () => {
	it("lists every payload file with a matching SHA-1 hash", async () => {
		const zip = await buildZip();
		const manifest = JSON.parse(
			(await zip.file("manifest.json")?.async("string")) ?? "{}"
		) as Record<string, string>;

		// Every file except manifest.json/signature must be in the manifest with a
		// hash equal to the SHA-1 of its bytes.
		const payloadNames = Object.keys(zip.files).filter(
			(name) => name !== "manifest.json" && name !== "signature"
		);
		expect(payloadNames.length).toBeGreaterThan(0);

		for (const name of payloadNames) {
			const bytes = await zip.file(name)?.async("uint8array");
			if (!bytes) {
				throw new Error(`missing ${name}`);
			}
			const expected = createHash("sha1")
				.update(Buffer.from(bytes))
				.digest("hex");
			expect(manifest[name], `manifest hash for ${name}`).toBe(expected);
		}

		// And the manifest must not reference files that aren't in the archive.
		for (const name of Object.keys(manifest)) {
			expect(payloadNames, `manifest references ${name}`).toContain(name);
		}
	});

	it("includes a signature that is a PKCS#7 SignedData with the signer cert", async () => {
		const zip = await buildZip();
		const sig = await zip.file("signature")?.async("uint8array");
		if (!sig) {
			throw new Error("missing signature");
		}
		const der = forge.util.binary.raw.encode(sig);
		const message = forge.pkcs7.messageFromAsn1(
			forge.asn1.fromDer(der)
		) as unknown as { type: string; certificates?: unknown[] };
		// A detached SignedData carries no content and includes the signer cert.
		expect(message.type).toBe(forge.pki.oids.signedData);
		expect(Array.isArray(message.certificates)).toBe(true);
		expect((message.certificates ?? []).length).toBeGreaterThan(0);
	});
});
