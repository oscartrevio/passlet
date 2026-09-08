import { createHash, createSign } from "node:crypto";
import forge from "node-forge";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { generateApplePass } from "../../../src/providers/apple/index";
import {
	type SignManifestOptions,
	signManifest,
	signManifestAsync,
} from "../../../src/providers/apple/signer";
import type { AppleExternalSigner } from "../../../src/types/credentials";
import {
	appleCredentials,
	PASS_TYPE_IDENTIFIER,
	parseSignature,
	readPkpass,
	TEAM_ID,
} from "../../support/apple";
import { generateTestCerts, type TestCerts } from "../../support/certs";
import { FIXTURES } from "../../support/fixtures";

const MANIFEST = new TextEncoder().encode('{"pass.json":"abc123"}');

// id-sha1 / id-sha256 as they appear in SignerInfo.digestAlgorithm.
const SHA1_OID = "1.3.14.3.2.26";
const SHA256_OID = "2.16.840.1.101.3.4.2.1";

type Digest = NonNullable<AppleExternalSigner["digestAlgorithm"]>;

let certs: TestCerts;
/** Private key of an unrelated certificate. */
let foreignKey: string;

beforeAll(() => {
	certs = appleCredentials();
	foreignKey = generateTestCerts().signerKey;
});

function material(): Pick<SignManifestOptions, "signerCert" | "wwdr"> {
	return { signerCert: certs.signerCert, wwdr: certs.wwdr };
}

// Stands in for a KMS: RSASSA-PKCS1-v1_5 over exactly the bytes handed over.
function kmsSigner(digestAlgorithm?: Digest, key = certs.signerKey) {
	return {
		digestAlgorithm,
		sign: vi.fn((signedAttributes: Uint8Array) =>
			Promise.resolve(
				createSign(digestAlgorithm ?? "sha256")
					.update(signedAttributes)
					.sign(key)
			)
		),
	};
}

// Each signed attribute is SEQUENCE { OID, SET OF value }.
function attributeOids(set: Uint8Array): string[] {
	const asn1 = forge.asn1.fromDer(forge.util.binary.raw.encode(set));
	return (asn1.value as forge.asn1.Asn1[]).map((attribute) =>
		forge.asn1.derToOid(
			(attribute.value as forge.asn1.Asn1[])[0]?.value as string
		)
	);
}

describe("signManifest", () => {
	it.each([
		{ code: "APPLE_INVALID_SIGNER_CERT", field: "signerCert" },
		{ code: "APPLE_INVALID_SIGNER_KEY", field: "signerKey" },
		{ code: "APPLE_INVALID_WWDR", field: "wwdr" },
	] as const)("throws $code when $field is not PEM", ({ code, field }) => {
		const options: SignManifestOptions = {
			manifest: MANIFEST,
			signerKey: certs.signerKey,
			...material(),
		};
		options[field] = "not-pem";

		expect(() => signManifest(options)).toThrow(
			expect.objectContaining({ code })
		);
	});

	it("refuses an external signer and requires a key without one", () => {
		expect(() =>
			signManifest({ manifest: MANIFEST, signer: kmsSigner(), ...material() })
		).toThrow(expect.objectContaining({ code: "APPLE_SIGNING_FAILED" }));
		expect(() => signManifest({ manifest: MANIFEST, ...material() })).toThrow(
			expect.objectContaining({ code: "APPLE_INVALID_SIGNER_KEY" })
		);
	});
});

describe("signManifestAsync with an external signer", () => {
	it.each([
		{ digestAlgorithm: "sha256", oid: SHA256_OID },
		{ digestAlgorithm: "sha1", oid: SHA1_OID },
	] as const)("embeds a detached $digestAlgorithm signature that verifies against the signer cert", async ({
		digestAlgorithm,
		oid,
	}) => {
		const signed = parseSignature(
			await signManifestAsync({
				manifest: MANIFEST,
				signer: kmsSigner(digestAlgorithm),
				...material(),
			})
		);

		expect(signed).toMatchObject({
			certificateCount: 2,
			detached: true,
			digestAlgorithmOid: oid,
			messageDigestHex: createHash(digestAlgorithm)
				.update(MANIFEST)
				.digest("hex"),
		});
		expect(signed.verifies(certs.signerCert)).toBe(true);
	});

	it("hands the callback the DER SET of the three signed attributes", async () => {
		const signer = kmsSigner();
		await signManifestAsync({ manifest: MANIFEST, signer, ...material() });

		expect(signer.sign).toHaveBeenCalledTimes(1);
		const signedAttributes = signer.sign.mock.calls[0]?.[0];
		if (!signedAttributes) {
			throw new Error("signer.sign was not called");
		}
		expect(signedAttributes[0]).toBe(0x31);
		expect(attributeOids(signedAttributes).sort()).toEqual(
			[
				forge.pki.oids.contentType,
				forge.pki.oids.messageDigest,
				forge.pki.oids.signingTime,
			].sort()
		);
	});

	it("validates the certificates before calling the signer", async () => {
		const signer = kmsSigner();

		await expect(
			signManifestAsync({
				manifest: MANIFEST,
				signer,
				signerCert: "not-a-cert",
				wwdr: certs.wwdr,
			})
		).rejects.toThrow(
			expect.objectContaining({ code: "APPLE_INVALID_SIGNER_CERT" })
		);
		expect(signer.sign).not.toHaveBeenCalled();
	});

	it("rejects an unsupported digest algorithm before calling the signer", async () => {
		const signer = {
			...kmsSigner(),
			digestAlgorithm: "md5" as unknown as Digest,
		};

		await expect(
			signManifestAsync({ manifest: MANIFEST, signer, ...material() })
		).rejects.toThrow(
			expect.objectContaining({ code: "APPLE_SIGNING_FAILED" })
		);
		expect(signer.sign).not.toHaveBeenCalled();
	});

	const badResults: {
		result: string;
		sign: (signedAttributes: Uint8Array) => unknown;
	}[] = [
		{ result: "a non-Uint8Array", sign: () => "signature" },
		{ result: "an empty signature", sign: () => Uint8Array.of() },
		{
			result: "a signature over the wrong digest",
			sign: (signedAttributes) =>
				createSign("sha512").update(signedAttributes).sign(certs.signerKey),
		},
		{
			result: "a signature made with a different key",
			sign: (signedAttributes) =>
				createSign("sha256").update(signedAttributes).sign(foreignKey),
		},
	];

	it.each(
		badResults
	)("rejects with APPLE_SIGNING_FAILED when the callback returns $result", async ({
		sign,
	}) => {
		await expect(
			signManifestAsync({
				manifest: MANIFEST,
				signer: { sign } as AppleExternalSigner,
				...material(),
			})
		).rejects.toThrow(
			expect.objectContaining({ code: "APPLE_SIGNING_FAILED" })
		);
	});

	it("wraps an error thrown by the callback as its cause", async () => {
		const cause = new Error("kms unavailable");

		await expect(
			signManifestAsync({
				manifest: MANIFEST,
				signer: {
					sign() {
						throw cause;
					},
				},
				...material(),
			})
		).rejects.toThrow(
			expect.objectContaining({ code: "APPLE_SIGNING_FAILED", cause })
		);
	});
});

describe("generateApplePass with credentials.signer", () => {
	it("signs the archive through the external signer", async () => {
		const signer = kmsSigner();
		const { pass, create } = FIXTURES.generic;
		const { pass: bytes } = await generateApplePass(pass, create, {
			passTypeIdentifier: PASS_TYPE_IDENTIFIER,
			teamId: TEAM_ID,
			signer,
			...material(),
		});
		const signed = parseSignature((await readPkpass(bytes)).signature);

		expect(signer.sign).toHaveBeenCalledTimes(1);
		// SHA-256 is the external default; the in-memory path would use SHA-1.
		expect(signed.digestAlgorithmOid).toBe(SHA256_OID);
		expect(signed.verifies(certs.signerCert)).toBe(true);
	});
});
