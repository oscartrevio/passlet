import {
	createHash,
	createPrivateKey,
	type KeyObject,
	sign,
	verify,
	X509Certificate,
} from "node:crypto";
import { WalletError } from "../errors";
import type { AppleCredentials, AppleExternalSigner } from "../schema/settings";
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

/**
 * Apple signing credentials, parsed and cross-checked once: the Pass Type ID
 * certificate, the WWDR intermediate that issued it, and either its private
 * key or an external signer holding that key.
 */
export type AppleSigningIdentity = {
	signerCert: X509Certificate;
	wwdr: X509Certificate;
} & (
	| { signer?: undefined; signerKey: KeyObject }
	| { signer: AppleExternalSigner; signerKey?: undefined }
);

export type SignManifestOptions = AppleSigningIdentity & {
	manifest: Uint8Array;
};

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

/**
 * PEM copied into an env var often keeps literal "\n" escapes. PEM never
 * contains a backslash, so unescaping leaves valid PEM untouched.
 */
export function unescapePem(pem: string): string {
	return pem.replace(/\\n/g, "\n");
}

function parseCertificate(
	pem: string,
	code: "APPLE_INVALID_SIGNER_CERT" | "APPLE_INVALID_WWDR"
): X509Certificate {
	try {
		return new X509Certificate(unescapePem(pem));
	} catch (cause) {
		throw new WalletError(code, undefined, { cause });
	}
}

/**
 * Parse Apple credentials and check they belong together, so a mismatched
 * certificate, key or WWDR fails at setup instead of in a pass Wallet rejects.
 * Wallet validates the signature against the signing certificate and the WWDR
 * intermediate that issued it.
 * https://developer.apple.com/documentation/walletpasses/building-a-pass
 *
 * @throws {WalletError} `APPLE_INVALID_SIGNER_CERT`, `APPLE_INVALID_WWDR` or
 * `APPLE_INVALID_SIGNER_KEY`.
 */
export function parseSigningIdentity(
	credentials: AppleCredentials
): AppleSigningIdentity {
	const signerCert = parseCertificate(
		credentials.signerCert,
		"APPLE_INVALID_SIGNER_CERT"
	);
	const wwdr = parseCertificate(credentials.wwdr, "APPLE_INVALID_WWDR");
	if (!(signerCert.checkIssued(wwdr) && signerCert.verify(wwdr.publicKey))) {
		throw new WalletError(
			"APPLE_INVALID_WWDR",
			"Invalid Apple WWDR certificate: wwdr did not issue signerCert"
		);
	}
	if (credentials.signer) {
		return { signerCert, wwdr, signer: credentials.signer };
	}
	return {
		signerCert,
		wwdr,
		signerKey: parseSignerKey(credentials, signerCert),
	};
}

function parseSignerKey(
	{ signerKey }: AppleCredentials,
	signerCert: X509Certificate
): KeyObject {
	if (!signerKey) {
		throw new WalletError(
			"APPLE_INVALID_SIGNER_KEY",
			"Invalid Apple signing key: signerKey is required when no external signer is provided"
		);
	}
	let key: KeyObject;
	try {
		key = createPrivateKey(unescapePem(signerKey));
	} catch (cause) {
		throw new WalletError("APPLE_INVALID_SIGNER_KEY", undefined, { cause });
	}
	// SignerInfo advertises rsaEncryption, so any other key type would emit a
	// signature no device can verify.
	if (key.asymmetricKeyType !== "rsa") {
		throw new WalletError(
			"APPLE_INVALID_SIGNER_KEY",
			`Invalid Apple signing key: signerKey must be an RSA key, got ${key.asymmetricKeyType}`
		);
	}
	if (!signerCert.checkPrivateKey(key)) {
		throw new WalletError(
			"APPLE_INVALID_SIGNER_KEY",
			"Invalid Apple signing key: signerKey does not match signerCert"
		);
	}
	return key;
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
	const { manifest, signer, signerCert: cert, signerKey, wwdr } = options;

	const digest: Digest = signer?.digestAlgorithm ?? "sha256";
	const digestAlgorithm = DIGEST_ALGORITHMS[digest];
	if (!digestAlgorithm) {
		throw new WalletError(
			"APPLE_SIGNING_FAILED",
			`Apple signing failed: unsupported signer.digestAlgorithm "${digest}" (expected "sha1" or "sha256")`
		);
	}

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
				context0(cert.raw, wwdr.raw),
				set(signerInfo)
			)
		)
	);
}

function keySigner(key: KeyObject, digest: Digest): SignAttributes {
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
