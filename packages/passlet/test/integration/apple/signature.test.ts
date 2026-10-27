import { createHash, createSign } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { parseSigningIdentity } from "../../../src/apple/signature";
import type {
	AppleCredentials,
	AppleExternalSigner,
} from "../../../src/config";
import { Wallet } from "../../../src/wallet";
import {
	appleCredentials,
	expectSignedBy,
	parseSignature,
	readPkpass,
} from "../../support/apple";
import { generateTestCerts } from "../../support/certs";
import { FIXTURES, walletTemplate } from "../../support/fixtures";

const MANIFEST = new TextEncoder().encode('{"pass.json":"abc123"}');

// id-sha1 / id-sha256 as they appear in SignerInfo.digestAlgorithm.
const SHA1_OID = "1.3.14.3.2.26";
const SHA256_OID = "2.16.840.1.101.3.4.2.1";
// The signed attributes in DER SET OF order: their encodings are 24 bytes
// (contentType), 28 (a UTCTime signingTime) and 35 or 47 (messageDigest).
const SIGNED_ATTRIBUTES = [
	"1.2.840.113549.1.9.3", // contentType
	"1.2.840.113549.1.9.5", // signingTime
	"1.2.840.113549.1.9.4", // messageDigest
];

type Digest = NonNullable<AppleExternalSigner["digestAlgorithm"]>;

let certs: AppleCredentials & { signerKey: string };
/** Private key of an unrelated certificate. */
let foreignKey: string;

beforeAll(() => {
	certs = appleCredentials();
	foreignKey = generateTestCerts().signerKey;
});

/** Credentials signing through `signer` instead of the in-memory key. */
function withSigner(signer: AppleExternalSigner): AppleCredentials {
	const { signerKey: _, ...rest } = certs;
	return { ...rest, signer };
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

describe("signing with the in-memory key", () => {
	it("embeds a detached SHA-256 signature naming the signer, with its WWDR", async () => {
		const signed = parseSignature(
			await parseSigningIdentity(certs).sign(MANIFEST)
		);

		expect(signed).toMatchObject({
			detached: true,
			digestAlgorithmOid: SHA256_OID,
			messageDigestHex: createHash("sha256").update(MANIFEST).digest("hex"),
			signedAttributeOids: SIGNED_ATTRIBUTES,
		});
		expectSignedBy(signed, certs);
	});
});

describe("signing with an external signer", () => {
	it.each([
		{ digestAlgorithm: "sha256", oid: SHA256_OID },
		{ digestAlgorithm: "sha1", oid: SHA1_OID },
	] as const)("embeds a detached $digestAlgorithm signature naming the signer, with its WWDR", async ({
		digestAlgorithm,
		oid,
	}) => {
		const identity = parseSigningIdentity(
			withSigner(kmsSigner(digestAlgorithm))
		);
		const signed = parseSignature(await identity.sign(MANIFEST));

		expect(signed).toMatchObject({
			detached: true,
			digestAlgorithmOid: oid,
			messageDigestHex: createHash(digestAlgorithm)
				.update(MANIFEST)
				.digest("hex"),
			signedAttributeOids: SIGNED_ATTRIBUTES,
		});
		expectSignedBy(signed, certs);
	});

	it("hands the callback the signed attributes as the DER SET it signs", async () => {
		const signer = kmsSigner();
		const signature = await parseSigningIdentity(withSigner(signer)).sign(
			MANIFEST
		);

		expect(signer.sign).toHaveBeenCalledTimes(1);
		const signedAttributes = signer.sign.mock.calls[0]?.[0];
		// The embedded [0] IMPLICIT attributes are the same bytes under a SET tag.
		const embedded = Uint8Array.from(signedAttributes ?? []);
		embedded[0] = 0xa0;
		expect(signedAttributes?.[0]).toBe(0x31);
		expect(Buffer.from(signature).includes(Buffer.from(embedded))).toBe(true);
	});

	it("rejects an unsupported digest algorithm when the Wallet is built", () => {
		const signer = kmsSigner();
		const unsupported = Object.assign(signer, { digestAlgorithm: "md5" });

		expect(() => new Wallet({ apple: withSigner(unsupported) })).toThrow(
			expect.objectContaining({ code: "APPLE_INVALID_SIGNER_KEY" })
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
		// Replaces the typed callback with what a JavaScript signer can return.
		const signer = Object.assign(kmsSigner(), { sign });
		await expect(
			parseSigningIdentity(withSigner(signer)).sign(MANIFEST)
		).rejects.toThrow(
			expect.objectContaining({ code: "APPLE_SIGNING_FAILED" })
		);
	});

	it("wraps an error thrown by the callback as its cause", async () => {
		const cause = new Error("kms unavailable");
		const identity = parseSigningIdentity(
			withSigner({
				sign() {
					throw cause;
				},
			})
		);

		await expect(identity.sign(MANIFEST)).rejects.toThrow(
			expect.objectContaining({ code: "APPLE_SIGNING_FAILED", cause })
		);
	});

	it("signs a Wallet's passes, defaulting to SHA-256 as the in-memory key does", async () => {
		const signer = kmsSigner();
		const { pass, create } = FIXTURES.generic;
		const { apple } = await walletTemplate(
			new Wallet({ apple: withSigner(signer) }),
			pass
		).create(create);
		if (!apple) {
			throw new Error("no .pkpass issued");
		}
		const signed = parseSignature((await readPkpass(apple)).signature);

		expect(signer.sign).toHaveBeenCalledTimes(1);
		expect(signed.digestAlgorithmOid).toBe(SHA256_OID);
		expectSignedBy(signed, certs);
	});
});
