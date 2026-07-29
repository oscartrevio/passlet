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

/** A stand-in for a KMS: the key stays behind a callback. */
function kmsSigner(
	digestAlgorithm: AppleExternalSigner["digestAlgorithm"] = "sha256"
): AppleExternalSigner {
	return {
		digestAlgorithm,
		sign(signedAttributes) {
			const sign = createSign(digestAlgorithm === "sha1" ? "sha1" : "sha256");
			sign.update(signedAttributes);
			return Promise.resolve(new Uint8Array(sign.sign(certs.signerKey)));
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

		expect(signature).toBeInstanceOf(Uint8Array);
		expect(signature.length).toBeGreaterThan(0);

		const p7 = parse(signature);
		expect(p7.certificates).toHaveLength(2);
		// detached: the content must not be embedded
		expect(p7.rawCapture.content).toBeUndefined();
	});

	it("embeds the signature bytes returned by the callback", async () => {
		let returned: Uint8Array | undefined;
		const signer = kmsSigner();
		const signature = await signManifestAsync({
			manifest: MANIFEST,
			signerCert: certs.signerCert,
			signer: {
				digestAlgorithm: signer.digestAlgorithm,
				async sign(signedAttributes) {
					returned = await signer.sign(signedAttributes);
					return returned;
				},
			},
			wwdr: certs.wwdr,
		});

		expect(returned).toBeDefined();
		const embedded = forge.util.binary.raw.encode(signature);
		expect(embedded).toContain(
			forge.util.binary.raw.encode(returned as Uint8Array)
		);
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
		// content-type, message-digest, signing-time
		expect((attrs.value as forge.asn1.Asn1[]).length).toBe(3);
	});

	it("supports sha1 as well as the sha256 default", async () => {
		const signature = await signManifestAsync({
			manifest: MANIFEST,
			signerCert: certs.signerCert,
			signer: kmsSigner("sha1"),
			wwdr: certs.wwdr,
		});
		expect(signature.length).toBeGreaterThan(0);
	});

	it("accepts a synchronously returned signature", async () => {
		const signature = await signManifestAsync({
			manifest: MANIFEST,
			signerCert: certs.signerCert,
			signer: {
				sign(signedAttributes) {
					const sign = createSign("sha256");
					sign.update(signedAttributes);
					return new Uint8Array(sign.sign(certs.signerKey));
				},
			},
			wwdr: certs.wwdr,
		});
		expect(signature.length).toBeGreaterThan(0);
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
				return new Uint8Array(sign.sign(certs.signerKey));
			},
		],
		[
			"a signature made with a different key",
			(signedAttributes) => {
				const other = forge.pki.rsa.generateKeyPair({ bits: 1024 });
				const sign = createSign("sha256");
				sign.update(signedAttributes);
				return new Uint8Array(
					sign.sign(forge.pki.privateKeyToPem(other.privateKey))
				);
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

describe("legacy key material path", () => {
	it("signManifestAsync delegates to signManifest when signerKey is given", async () => {
		const fromAsync = await signManifestAsync({
			manifest: MANIFEST,
			signerCert: certs.signerCert,
			signerKey: certs.signerKey,
			wwdr: certs.wwdr,
		});
		const fromSync = signManifest({
			manifest: MANIFEST,
			signerCert: certs.signerCert,
			signerKey: certs.signerKey,
			wwdr: certs.wwdr,
		});

		expect(fromAsync).toBeInstanceOf(Uint8Array);
		// same structure — only the signing time differs between the two calls
		expect(Math.abs(fromAsync.length - fromSync.length)).toBeLessThan(8);
		expect(parse(fromAsync).certificates).toHaveLength(2);
	});

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
