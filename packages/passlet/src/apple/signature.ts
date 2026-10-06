import {
	createHash,
	createPrivateKey,
	type KeyObject,
	sign,
	verify,
	X509Certificate,
} from "node:crypto";
import { WalletError } from "../errors";
import type { AppleExternalSigner } from "../schema/settings";
import {
	context0,
	issuerAndSerialNumber,
	NULL,
	OCTET_STRING,
	oid,
	sequence,
	set,
	time,
	tlv,
} from "./der";

export interface SignManifestOptions {
	manifest: Uint8Array;
	/** External signer (KMS/HSM) that replaces `signerKey`. */
	signer?: AppleExternalSigner;
	signerCert: string; // PEM
	/** PEM-encoded private key. Omit when `signer` is provided. */
	signerKey?: string;
	wwdr: string; // PEM
}

type Digest = NonNullable<AppleExternalSigner["digestAlgorithm"]>;

/** Produces the raw RSASSA-PKCS1-v1_5 signature over the DER signed attributes. */
type SignAttributes = (
	signedAttributes: Uint8Array
) => Uint8Array | Promise<Uint8Array>;

const DIGEST_ALGORITHMS: Record<Digest, Uint8Array> = {
	sha1: sequence(oid("1.3.14.3.2.26"), NULL),
	sha256: sequence(oid("2.16.840.1.101.3.4.2.1"), NULL),
};
const RSA_ENCRYPTION = sequence(oid("1.2.840.113549.1.1.1"), NULL);
const DATA = oid("1.2.840.113549.1.7.1");
const SIGNED_DATA = oid("1.2.840.113549.1.7.2");
const CONTENT_TYPE = oid("1.2.840.113549.1.9.3");
const MESSAGE_DIGEST = oid("1.2.840.113549.1.9.4");
const SIGNING_TIME = oid("1.2.840.113549.1.9.5");
const VERSION_1 = tlv(0x02, Uint8Array.of(1));

function parseCertificate(
	pem: string,
	code: "APPLE_INVALID_SIGNER_CERT" | "APPLE_INVALID_WWDR"
): X509Certificate {
	try {
		return new X509Certificate(pem);
	} catch (cause) {
		throw new WalletError(code, undefined, { cause });
	}
}

/**
 * Signs manifest.json with a PKCS#7 detached signature — required by Apple to
 * validate the integrity of a `.pkpass` file.
 *
 * Apple asks for "a PKCS #7 detached signature for the manifest" and names no
 * digest for it (only the manifest's file hashes are SHA-1), so both the
 * in-memory PEM `signerKey` and an {@link AppleExternalSigner} default to
 * SHA-256; an external signer may opt into SHA-1.
 * https://developer.apple.com/documentation/walletpasses/building-a-pass
 */
export async function signManifest(
	options: SignManifestOptions
): Promise<Uint8Array> {
	const { manifest, signer, signerCert, signerKey, wwdr } = options;

	const digest: Digest = signer?.digestAlgorithm ?? "sha256";
	const digestAlgorithm = DIGEST_ALGORITHMS[digest];
	if (!digestAlgorithm) {
		throw new WalletError(
			"APPLE_SIGNING_FAILED",
			`Apple signing failed: unsupported signer.digestAlgorithm "${digest}" (expected "sha1" or "sha256")`
		);
	}

	const cert = parseCertificate(signerCert, "APPLE_INVALID_SIGNER_CERT");
	const wwdrCert = parseCertificate(wwdr, "APPLE_INVALID_WWDR");
	const signAttributes = signer
		? externalSigner(signer, cert, digest)
		: keySigner(signerKey, digest);

	// Attribute order matches what Apple has always accepted from us.
	const attributes = [
		sequence(CONTENT_TYPE, set(DATA)),
		sequence(
			MESSAGE_DIGEST,
			set(tlv(OCTET_STRING, createHash(digest).update(manifest).digest()))
		),
		sequence(SIGNING_TIME, set(time(new Date()))),
	];
	// Signed as a SET (RFC 2315 §9.3) but embedded as `[0] IMPLICIT`.
	const signature = await signAttributes(set(...attributes));

	const signerInfo = sequence(
		VERSION_1,
		issuerAndSerialNumber(cert.raw),
		digestAlgorithm,
		context0(...attributes),
		RSA_ENCRYPTION,
		tlv(OCTET_STRING, signature)
	);
	return sequence(
		SIGNED_DATA,
		context0(
			sequence(
				VERSION_1,
				set(digestAlgorithm),
				// Detached: the manifest itself lives next to the signature.
				sequence(DATA),
				context0(cert.raw, wwdrCert.raw),
				set(signerInfo)
			)
		)
	);
}

function keySigner(pem: string | undefined, digest: Digest): SignAttributes {
	if (!pem) {
		throw new WalletError(
			"APPLE_INVALID_SIGNER_KEY",
			"Apple signing failed: signerKey is required when no external signer is provided"
		);
	}
	let key: KeyObject;
	try {
		key = createPrivateKey(pem);
	} catch (cause) {
		throw new WalletError("APPLE_INVALID_SIGNER_KEY", undefined, { cause });
	}
	// SignerInfo advertises rsaEncryption, so any other key type would emit a
	// signature no device can verify.
	if (key.asymmetricKeyType !== "rsa") {
		throw new WalletError(
			"APPLE_INVALID_SIGNER_KEY",
			`Apple signing failed: signerKey must be an RSA key, got ${key.asymmetricKeyType}`
		);
	}
	return (signedAttributes) => {
		try {
			return sign(digest, signedAttributes, key);
		} catch (cause) {
			throw new WalletError("APPLE_SIGNING_FAILED", undefined, { cause });
		}
	};
}

function externalSigner(
	signer: AppleExternalSigner,
	cert: X509Certificate,
	digest: Digest
): SignAttributes {
	return async (signedAttributes) => {
		let signature: unknown;
		try {
			signature = await signer.sign(signedAttributes);
		} catch (cause) {
			throw new WalletError(
				"APPLE_SIGNING_FAILED",
				"Apple signing failed: signer.sign() threw",
				{ cause }
			);
		}
		const raw = assertSignatureBytes(signature);
		verifySignature({ cert, digest, raw, signedAttributes });
		return raw;
	};
}

function assertSignatureBytes(signature: unknown): Uint8Array {
	if (!(signature instanceof Uint8Array)) {
		throw new WalletError(
			"APPLE_SIGNING_FAILED",
			`Apple signing failed: signer.sign() must return a Uint8Array, got ${typeof signature}`
		);
	}
	if (signature.length === 0) {
		throw new WalletError(
			"APPLE_SIGNING_FAILED",
			"Apple signing failed: signer.sign() returned an empty signature"
		);
	}
	return signature;
}

// Certificates are public, so we can catch a malformed external signature
// (wrong key, wrong digest, PSS padding, truncated bytes) before it ends up in
// a `.pkpass` that only fails on the user's device.
function verifySignature(options: {
	cert: X509Certificate;
	digest: Digest;
	raw: Uint8Array;
	signedAttributes: Uint8Array;
}): void {
	const { cert, digest, raw, signedAttributes } = options;

	let valid = false;
	try {
		valid = verify(digest, signedAttributes, cert.publicKey, raw);
	} catch {
		valid = false;
	}

	if (!valid) {
		throw new WalletError(
			"APPLE_SIGNING_FAILED",
			`Apple signing failed: the signature returned by signer.sign() does not verify against signerCert — expected RSASSA-PKCS1-v1_5 over ${digest}`
		);
	}
}
