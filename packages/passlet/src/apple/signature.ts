import {
	createHash,
	createPrivateKey,
	type KeyObject,
	sign,
	verify,
	X509Certificate,
} from "node:crypto";
import { promisify } from "node:util";
import type { AppleCredentials, AppleExternalSigner } from "../config";
import { WalletError } from "../errors";
import {
	CONTEXT_0,
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
 * Apple signing credentials, parsed, cross-checked and ready to sign: the Pass
 * Type ID certificate, plus its private key unless an external signer holds it.
 */
export interface AppleSigningIdentity {
	/** The detached PKCS#7 signature over a `.pkpass`'s manifest.json. */
	sign(manifest: Uint8Array): Promise<Uint8Array>;
	readonly signerCert: X509Certificate;
	/** The in-memory key, which APNs can reuse; absent with an external signer. */
	readonly signerKey: KeyObject | undefined;
}

type Digest = NonNullable<AppleExternalSigner["digestAlgorithm"]>;

/** Produces the raw RSASSA-PKCS1-v1_5 signature over the DER signed attributes. */
type SignAttributes = (signedAttributes: Uint8Array) => Promise<Uint8Array>;

const DIGEST_ALGORITHMS: Record<Digest, Uint8Array> = {
	sha1: sequence(oid("1.3.14.3.2.26"), NULL),
	sha256: sequence(oid("2.16.840.1.101.3.4.2.1"), NULL),
};
const RSA_ENCRYPTION = sequence(oid("1.2.840.113549.1.1.1"), NULL);
const DATA = oid("1.2.840.113549.1.7.1");
// Detached: the manifest itself lives next to the signature.
const DETACHED_DATA = sequence(DATA);
const SIGNED_DATA = oid("1.2.840.113549.1.7.2");
const CONTENT_TYPE_DATA = sequence(oid("1.2.840.113549.1.9.3"), set(DATA));
const MESSAGE_DIGEST = oid("1.2.840.113549.1.9.4");
const SIGNING_TIME = oid("1.2.840.113549.1.9.5");
const VERSION_1 = tlv(0x02, Uint8Array.of(1));

// With a callback, crypto.sign and crypto.verify run on libuv's threadpool
// instead of blocking the event loop, so the passes of a bundle sign in
// parallel. https://nodejs.org/api/crypto.html#cryptosignalgorithm-data-key-callback
const signAsync = promisify(sign);
const verifyAsync = promisify(verify);

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
 * certificate, key, WWDR or signer digest fails at setup instead of in a pass
 * Wallet rejects. Wallet validates the signature against the signing
 * certificate and the WWDR intermediate that issued it.
 * https://developer.apple.com/documentation/walletpasses/building-a-pass
 *
 * Apple asks for "a PKCS #7 detached signature for the manifest" and names no
 * digest for it (only the manifest's file hashes are SHA-1), so both the
 * in-memory PEM `signerKey` and an {@link AppleExternalSigner} default to
 * SHA-256; an external signer may opt into SHA-1.
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
	const { signer } = credentials;
	if (!signer) {
		const signerKey = parseSignerKey(credentials, signerCert);
		return prepareIdentity(
			signerCert,
			wwdr,
			signerKey,
			"sha256",
			(attributes) =>
				signAsync("sha256", attributes, signerKey).catch((cause: unknown) => {
					throw new WalletError("APPLE_SIGNING_FAILED", undefined, { cause });
				})
		);
	}
	const digest = signer.digestAlgorithm ?? "sha256";
	// Typed, but JavaScript callers can pass anything.
	if (!Object.hasOwn(DIGEST_ALGORITHMS, digest)) {
		throw new WalletError(
			"APPLE_INVALID_SIGNER_KEY",
			`Invalid Apple signing key: unsupported signer.digestAlgorithm "${digest}" (expected "sha1" or "sha256")`
		);
	}
	return prepareIdentity(signerCert, wwdr, undefined, digest, (attributes) =>
		signExternally(signer, signerCert, digest, attributes)
	);
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
 * The identity's signer: every SignedData part the identity fixes is encoded
 * here once, so each signature only adds its signed attributes.
 */
function prepareIdentity(
	signerCert: X509Certificate,
	wwdr: X509Certificate,
	signerKey: KeyObject | undefined,
	digest: Digest,
	signAttributes: SignAttributes
): AppleSigningIdentity {
	const digestAlgorithm = DIGEST_ALGORITHMS[digest];
	const digestAlgorithms = set(digestAlgorithm);
	const signerId = issuerAndSerialNumber(signerCert.raw);
	const certificates = context0(signerCert.raw, wwdr.raw);
	return {
		signerCert,
		signerKey,
		async sign(manifest) {
			// RFC 5652 §5.4 signs the DER encoding of the attributes, and DER
			// orders a SET OF by its elements' encodings (X.690 §11.6).
			const attributes = set(
				...[
					CONTENT_TYPE_DATA,
					sequence(
						MESSAGE_DIGEST,
						set(tlv(OCTET_STRING, createHash(digest).update(manifest).digest()))
					),
					sequence(SIGNING_TIME, set(time(new Date()))),
				].sort(Buffer.compare)
			);
			const signature = await signAttributes(attributes);
			// Signed as a SET but embedded as `[0] IMPLICIT`: the same bytes
			// under the other tag.
			const embedded = Uint8Array.from(attributes);
			embedded[0] = CONTEXT_0;
			return sequence(
				SIGNED_DATA,
				context0(
					sequence(
						VERSION_1,
						digestAlgorithms,
						DETACHED_DATA,
						certificates,
						set(
							sequence(
								VERSION_1,
								signerId,
								digestAlgorithm,
								embedded,
								RSA_ENCRYPTION,
								tlv(OCTET_STRING, signature)
							)
						)
					)
				)
			);
		},
	};
}

async function signExternally(
	signer: AppleExternalSigner,
	cert: X509Certificate,
	digest: Digest,
	signedAttributes: Uint8Array
): Promise<Uint8Array> {
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
	// Certificates are public, so we can catch a malformed external signature
	// (wrong key, wrong digest, PSS padding, truncated bytes) before it ends up
	// in a `.pkpass` that only fails on the user's device.
	const valid = await verifyAsync(
		digest,
		signedAttributes,
		cert.publicKey,
		signature
	).catch(() => false);
	if (!valid) {
		throw new WalletError(
			"APPLE_SIGNING_FAILED",
			`Apple signing failed: the signature returned by signer.sign() does not verify against signerCert — expected RSASSA-PKCS1-v1_5 over ${digest}`
		);
	}
	return signature;
}
