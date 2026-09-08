import { beforeAll, describe, expect, it } from "vitest";
import { signManifest } from "./signer";
import { generateTestCerts, type TestCerts } from "./test-certs";

let certs: TestCerts;

beforeAll(() => {
	certs = generateTestCerts();
}, 30_000);

describe("signManifest", () => {
	it("throws APPLE_INVALID_SIGNER_CERT for a non-PEM signer cert", () => {
		expect(() =>
			signManifest({
				manifest: new Uint8Array([1]),
				signerCert: "not-a-cert",
				signerKey: certs.signerKey,
				wwdr: certs.wwdr,
			})
		).toThrow(expect.objectContaining({ code: "APPLE_INVALID_SIGNER_CERT" }));
	});

	it("throws APPLE_INVALID_SIGNER_KEY for a non-PEM key", () => {
		expect(() =>
			signManifest({
				manifest: new Uint8Array([1]),
				signerCert: certs.signerCert,
				signerKey: "not-a-key",
				wwdr: certs.wwdr,
			})
		).toThrow(expect.objectContaining({ code: "APPLE_INVALID_SIGNER_KEY" }));
	});

	it("throws APPLE_INVALID_WWDR for a non-PEM WWDR cert", () => {
		expect(() =>
			signManifest({
				manifest: new Uint8Array([1]),
				signerCert: certs.signerCert,
				signerKey: certs.signerKey,
				wwdr: "not-a-cert",
			})
		).toThrow(expect.objectContaining({ code: "APPLE_INVALID_WWDR" }));
	});

	it("produces a different signature for different manifests", () => {
		const opts = {
			signerCert: certs.signerCert,
			signerKey: certs.signerKey,
			wwdr: certs.wwdr,
		};
		const sig1 = signManifest({
			...opts,
			manifest: new TextEncoder().encode('{"pass.json":"aaa"}'),
		});
		const sig2 = signManifest({
			...opts,
			manifest: new TextEncoder().encode('{"pass.json":"bbb"}'),
		});
		expect(sig1).not.toEqual(sig2);
	});
});
