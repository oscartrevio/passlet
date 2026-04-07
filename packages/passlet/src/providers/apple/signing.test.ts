import { beforeAll, describe, expect, it } from "vitest";
import { WalletError } from "../../errors";
import { signManifest } from "./signer";
import { generateTestCerts, type TestCerts } from "./test-certs";

const ICON_RE = /icon/i;

let certs: TestCerts;

beforeAll(() => {
	certs = generateTestCerts();
}, 30_000);

describe("signManifest", () => {
	it("returns a non-empty Uint8Array for valid certs", () => {
		const manifest = new TextEncoder().encode('{"pass.json":"abc123"}');
		const signature = signManifest({
			manifest,
			signerCert: certs.signerCert,
			signerKey: certs.signerKey,
			wwdr: certs.wwdr,
		});
		expect(signature).toBeInstanceOf(Uint8Array);
		expect(signature.length).toBeGreaterThan(0);
	});

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

describe("WalletError", () => {
	it("carries the error code and default message", () => {
		const err = new WalletError("APPLE_MISSING_ICON");
		expect(err.code).toBe("APPLE_MISSING_ICON");
		expect(err.message).toMatch(ICON_RE);
		expect(err.name).toBe("WalletError");
	});

	it("accepts a custom message", () => {
		const err = new WalletError("APPLE_SIGNING_FAILED", "custom message");
		expect(err.message).toBe("custom message");
	});
});
