import { createSign } from "node:crypto";
import forge from "node-forge";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { AppleExternalSigner } from "../../types/credentials";
import { signManifest, signManifestAsync } from "./signer";
import { generateTestCerts, type TestCerts } from "./test-certs";

let certs: TestCerts;

beforeAll(() => {
	certs = generateTestCerts();
}, 30_000);

const MANIFEST = new TextEncoder().encode('{"pass.json":"abc123"}');

function kmsSigner(): AppleExternalSigner {
	return {
		sign(signedAttributes) {
			const sign = createSign("sha256");
			sign.update(signedAttributes);
			return Promise.resolve(sign.sign(certs.signerKey));
		},
	};
}

function parse(signature: Uint8Array): forge.pkcs7.Captured<{
	certificates: forge.pki.Certificate[];
}> {
	const binary = forge.util.binary.raw.encode(signature);
	return forge.pkcs7.messageFromAsn1(
		forge.asn1.fromDer(binary)
	) as forge.pkcs7.Captured<{ certificates: forge.pki.Certificate[] }>;
}

describe("signManifestAsync with an external signer", () => {
	it("produces a detached PKCS#7 signature carrying both certificates", async () => {
		const signature = await signManifestAsync({
			manifest: MANIFEST,
			signerCert: certs.signerCert,
			signer: kmsSigner(),
			wwdr: certs.wwdr,
		});

		const p7 = parse(signature);
		expect(p7.certificates).toHaveLength(2);
		expect(p7.rawCapture.content).toBeUndefined();
	});

	it("hands the callback the DER-encoded signed attributes", async () => {
		const signer = kmsSigner();
		const sign = vi.fn(signer.sign);
		await signManifestAsync({
			manifest: MANIFEST,
			signerCert: certs.signerCert,
			signer: { digestAlgorithm: signer.digestAlgorithm, sign },
			wwdr: certs.wwdr,
		});

		expect(sign).toHaveBeenCalledTimes(1);
		const [signedAttributes] = sign.mock.calls[0] as [Uint8Array];
		expect(signedAttributes).toBeInstanceOf(Uint8Array);
		// DER SET OF Attribute
		expect(signedAttributes[0]).toBe(0x31);
		const attrs = forge.asn1.fromDer(
			forge.util.binary.raw.encode(signedAttributes)
		);
		expect((attrs.value as forge.asn1.Asn1[]).length).toBe(3);
	});

	it("validates the certificates before calling the signer", async () => {
		const sign = vi.fn();
		await expect(
			signManifestAsync({
				manifest: MANIFEST,
				signerCert: "not-a-cert",
				signer: { sign },
				wwdr: certs.wwdr,
			})
		).rejects.toThrow(
			expect.objectContaining({ code: "APPLE_INVALID_SIGNER_CERT" })
		);
		expect(sign).not.toHaveBeenCalled();
	});

	it("throws APPLE_INVALID_WWDR for a bad wwdr certificate", async () => {
		await expect(
			signManifestAsync({
				manifest: MANIFEST,
				signerCert: certs.signerCert,
				signer: kmsSigner(),
				wwdr: "not-a-cert",
			})
		).rejects.toThrow(expect.objectContaining({ code: "APPLE_INVALID_WWDR" }));
	});
});

describe("signManifestAsync external signer errors", () => {
	const cases: [string, AppleExternalSigner["sign"]][] = [
		["a non-Uint8Array", () => "signature" as unknown as Uint8Array],
		["an empty signature", () => new Uint8Array()],
		["garbage bytes", () => new Uint8Array(128).fill(7)],
		[
			"a signature over the wrong digest",
			(signedAttributes) => {
				const sign = createSign("sha512");
				sign.update(signedAttributes);
				return sign.sign(certs.signerKey);
			},
		],
		[
			"a signature made with a different key",
			(signedAttributes) => {
				const other = forge.pki.rsa.generateKeyPair({ bits: 1024 });
				const sign = createSign("sha256");
				sign.update(signedAttributes);
				return sign.sign(forge.pki.privateKeyToPem(other.privateKey));
			},
		],
	];

	for (const [label, sign] of cases) {
		it(`throws APPLE_SIGNING_FAILED when the callback returns ${label}`, async () => {
			await expect(
				signManifestAsync({
					manifest: MANIFEST,
					signerCert: certs.signerCert,
					signer: { sign },
					wwdr: certs.wwdr,
				})
			).rejects.toThrow(
				expect.objectContaining({ code: "APPLE_SIGNING_FAILED" })
			);
		});
	}

	it("wraps an error thrown by the callback", async () => {
		const cause = new Error("kms unavailable");
		await expect(
			signManifestAsync({
				manifest: MANIFEST,
				signerCert: certs.signerCert,
				signer: {
					sign() {
						throw cause;
					},
				},
				wwdr: certs.wwdr,
			})
		).rejects.toThrow(
			expect.objectContaining({ code: "APPLE_SIGNING_FAILED", cause })
		);
	});

	it("rejects an unsupported digest algorithm", async () => {
		await expect(
			signManifestAsync({
				manifest: MANIFEST,
				signerCert: certs.signerCert,
				signer: {
					digestAlgorithm: "md5" as unknown as "sha256",
					sign: () => new Uint8Array([1]),
				},
				wwdr: certs.wwdr,
			})
		).rejects.toThrow(
			expect.objectContaining({ code: "APPLE_SIGNING_FAILED" })
		);
	});
});

describe("in-memory key signing", () => {
	it("signManifest rejects an external signer", () => {
		expect(() =>
			signManifest({
				manifest: MANIFEST,
				signerCert: certs.signerCert,
				signer: { sign: () => new Uint8Array([1]) },
				wwdr: certs.wwdr,
			})
		).toThrow(expect.objectContaining({ code: "APPLE_SIGNING_FAILED" }));
	});

	it("signManifest requires a key when no signer is given", () => {
		expect(() =>
			signManifest({
				manifest: MANIFEST,
				signerCert: certs.signerCert,
				wwdr: certs.wwdr,
			})
		).toThrow(expect.objectContaining({ code: "APPLE_INVALID_SIGNER_KEY" }));
	});
});
