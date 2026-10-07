import { createHash, createSign } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
	parseSigningIdentity,
	type SignManifestOptions,
	signManifest,
} from "../../../src/apple/signature";
import type {
	AppleCredentials,
	AppleExternalSigner,
} from "../../../src/schema/settings";
import {
	appleCredentials,
	issueApplePass,
	PASS_TYPE_IDENTIFIER,
	parseSignature,
	readPkpass,
	TEAM_ID,
} from "../../support/apple";
import { generateTestCerts } from "../../support/certs";
import { child, children, decodeOid, parse } from "../../support/der-reader";
import { FIXTURES } from "../../support/fixtures";

const MANIFEST = new TextEncoder().encode('{"pass.json":"abc123"}');

// id-sha1 / id-sha256 as they appear in SignerInfo.digestAlgorithm.
const SHA1_OID = "1.3.14.3.2.26";
const SHA256_OID = "2.16.840.1.101.3.4.2.1";

type Digest = NonNullable<AppleExternalSigner["digestAlgorithm"]>;

let certs: AppleCredentials & { signerKey: string };
/** Private key of an unrelated certificate. */
let foreignKey: string;

beforeAll(() => {
	certs = appleCredentials();
	foreignKey = generateTestCerts().signerKey;
});

// Credentials parsed as AppleProvider parses them, with the in-memory key or
// an external signer.
function options(signer?: AppleExternalSigner): SignManifestOptions {
	const identity = signer
		? parseSigningIdentity({ ...certs, signerKey: undefined, signer })
		: parseSigningIdentity(certs);
	return { ...identity, manifest: MANIFEST };
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
	return children(parse(set)).map((attribute) =>
		decodeOid(child(attribute, 0))
	);
}

describe("signManifest", () => {
	it("embeds a detached SHA-256 signature made with the PEM key", async () => {
		const signed = parseSignature(await signManifest(options()));

		expect(signed).toMatchObject({
			certificateCount: 2,
			detached: true,
			digestAlgorithmOid: SHA256_OID,
			messageDigestHex: createHash("sha256").update(MANIFEST).digest("hex"),
		});
		expect(signed.verifies(certs.signerCert)).toBe(true);
	});
});

describe("signManifest with an external signer", () => {
	it.each([
		{ digestAlgorithm: "sha256", oid: SHA256_OID },
		{ digestAlgorithm: "sha1", oid: SHA1_OID },
	] as const)("embeds a detached $digestAlgorithm signature that verifies against the signer cert", async ({
		digestAlgorithm,
		oid,
	}) => {
		const signed = parseSignature(
			await signManifest(options(kmsSigner(digestAlgorithm)))
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
		await signManifest(options(signer));

		expect(signer.sign).toHaveBeenCalledTimes(1);
		const signedAttributes = signer.sign.mock.calls[0]?.[0];
		if (!signedAttributes) {
			throw new Error("signer.sign was not called");
		}
		expect(signedAttributes[0]).toBe(0x31);
		expect(attributeOids(signedAttributes).sort()).toEqual(
			[
				"1.2.840.113549.1.9.3", // contentType
				"1.2.840.113549.1.9.4", // messageDigest
				"1.2.840.113549.1.9.5", // signingTime
			].sort()
		);
	});

	it("rejects an unsupported digest algorithm before calling the signer", async () => {
		const signer = {
			...kmsSigner(),
			digestAlgorithm: "md5" as unknown as Digest,
		};

		await expect(signManifest(options(signer))).rejects.toThrow(
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
			signManifest(options({ sign } as AppleExternalSigner))
		).rejects.toThrow(
			expect.objectContaining({ code: "APPLE_SIGNING_FAILED" })
		);
	});

	it("wraps an error thrown by the callback as its cause", async () => {
		const cause = new Error("kms unavailable");

		await expect(
			signManifest(
				options({
					sign() {
						throw cause;
					},
				})
			)
		).rejects.toThrow(
			expect.objectContaining({ code: "APPLE_SIGNING_FAILED", cause })
		);
	});
});

describe("AppleProvider with credentials.signer", () => {
	it("signs the archive through the external signer", async () => {
		const signer = kmsSigner();
		const { pass, create } = FIXTURES.generic;
		const bytes = await issueApplePass(pass, create, {
			passTypeIdentifier: PASS_TYPE_IDENTIFIER,
			teamId: TEAM_ID,
			signer,
			signerCert: certs.signerCert,
			wwdr: certs.wwdr,
		});
		const signed = parseSignature((await readPkpass(bytes)).signature);

		expect(signer.sign).toHaveBeenCalledTimes(1);
		// SHA-256 is the default for external signers, as for the in-memory key.
		expect(signed.digestAlgorithmOid).toBe(SHA256_OID);
		expect(signed.verifies(certs.signerCert)).toBe(true);
	});
});
