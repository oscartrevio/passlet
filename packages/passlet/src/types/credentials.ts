/**
 * Delegates the private-key operation of Apple pass signing to a key you never
 * hand to passlet — a KMS, an HSM, or any remote signing service.
 *
 * passlet still assembles the PKCS#7 detached signature itself (certificates
 * are public material, only the private key is secret). It hands you the exact
 * bytes to sign — the DER-encoded signed attributes of the CMS SignerInfo — and
 * expects the raw signature back. This keeps the callback as small as a single
 * `kms.sign()` call: you never have to build ASN.1, and passlet never needs the
 * key.
 *
 * The signature must be **RSASSA-PKCS1-v1_5** (`RSA_PKCS1_*` on AWS KMS,
 * `RSA_SIGN_PKCS1_*` on Google Cloud KMS) over `signedAttributes` using
 * {@link AppleExternalSigner.digestAlgorithm}. passlet verifies the result
 * against `signerCert` before writing the pass, so a mismatched key, digest or
 * padding fails fast with a `WalletError`.
 *
 * @example
 * ```ts
 * const credentials = {
 *   apple: {
 *     passTypeIdentifier: "pass.com.example.app",
 *     teamId: "ABCD1234EF",
 *     signerCert: await readFile("signer.pem", "utf8"),
 *     wwdr: await readFile("wwdr.pem", "utf8"),
 *     signer: {
 *       async sign(signedAttributes) {
 *         const { Signature } = await kms.send(
 *           new SignCommand({
 *             KeyId: process.env.KMS_KEY_ID,
 *             Message: signedAttributes,
 *             MessageType: "RAW",
 *             SigningAlgorithm: "RSASSA_PKCS1_V1_5_SHA_256",
 *           })
 *         );
 *         return Signature;
 *       },
 *     },
 *   },
 * };
 * ```
 */
export interface AppleExternalSigner {
	/**
	 * Digest used for both the CMS digest algorithm and the signature.
	 * Defaults to `"sha256"` — `"sha1"` matches the in-memory key path but is
	 * rejected by most KMS providers.
	 */
	digestAlgorithm?: "sha1" | "sha256";
	/**
	 * Signs the DER-encoded signed attributes with RSASSA-PKCS1-v1_5 and returns
	 * the raw signature bytes (not DER-wrapped, not base64).
	 */
	sign(signedAttributes: Uint8Array): Promise<Uint8Array> | Uint8Array;
}

interface AppleCredentialsBase {
	/** Pass type identifier registered in your Apple Developer account. @example "pass.com.yourcompany.app" */
	passTypeIdentifier: string;
	/** PEM-encoded pass signing certificate from Apple Developer. */
	signerCert: string;
	/** Your 10-character Apple Team ID. @example "ABCD1234EF" */
	teamId: string;
	/** PEM-encoded Apple WWDR intermediate certificate. */
	wwdr: string;
}

/**
 * Credentials for signing Apple Wallet `.pkpass` files.
 *
 * Provide the private key either directly as `signerKey` (PEM) or, to keep it
 * outside the process, as an {@link AppleExternalSigner} under `signer`. Exactly
 * one of the two is allowed; the certificates are always required.
 */
export type AppleCredentials =
	| (AppleCredentialsBase & {
			signer?: never;
			/** PEM-encoded private key paired with `signerCert`. */
			signerKey: string;
	  })
	| (AppleCredentialsBase & {
			/** Externally-held signing key (KMS/HSM) used instead of `signerKey`. */
			signer: AppleExternalSigner;
			signerKey?: never;
	  });

/** Credentials for signing Google Wallet JWTs and calling the Wallet REST API. */
export interface GoogleCredentials {
	/** `client_email` from your Google Cloud service account JSON key. */
	clientEmail: string;
	/** Issuer ID from the Google Pay & Wallet Console. */
	issuerId: string;
	/**
	 * Approved domains where the "Add to Google Wallet" button is embedded.
	 * Required for the web save button to render (e.g. `["https://example.com"]`).
	 */
	origins?: string[];
	/** `private_key` from your Google Cloud service account JSON key (PKCS#8 PEM). */
	privateKey: string;
}

/** Credentials passed to {@link Wallet}. Omit a provider to skip that platform. */
export interface WalletCredentials {
	/** Apple Wallet credentials. Required to generate `.pkpass` files. */
	apple?: AppleCredentials;
	/** Google Wallet credentials. Required to generate Google Wallet JWTs. */
	google?: GoogleCredentials;
}

/** Result of {@link Pass.create}. */
export interface IssuedPass {
	/**
	 * Signed `.pkpass` archive ready to serve, or `null` if Apple credentials were omitted.
	 *
	 * Serve it under the `APPLE_PASS_CONTENT_TYPE` content type — iOS refuses passes
	 * sent under any other type. On Node HTTP servers wrap it with `Buffer.from(apple)`.
	 */
	apple: Uint8Array | null;
	/**
	 * Signed JWT for a Google Wallet save link, or `null` if Google credentials were omitted.
	 *
	 * Pass it to the exported `googleSaveUrl(jwt)` helper to get the
	 * `https://pay.google.com/gp/v/save/<jwt>` URL to link or redirect to.
	 */
	google: string | null;
	/** Non-fatal notices — e.g. a missing optional image or an unset recommended field. */
	warnings: string[];
}
