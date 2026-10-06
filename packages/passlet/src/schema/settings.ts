import type { PassTemplate } from "../template";
import type { PassContent } from "./content";

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
	 * Defaults to `"sha256"`, as the in-memory key path uses; `"sha1"` is
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
	/**
	 * Serve Apple's pass web service from `wallet.handler` so issued passes
	 * update in place. Without it, Apple passes are static once issued.
	 */
	webService?: AppleWebService;
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
	/** `private_key` from your Google Cloud service account JSON key (PEM RSA key). */
	privateKey: string;
}

/** Configuration passed to {@link Wallet}. Omit a provider to skip that platform. */
export interface WalletConfig {
	/** Apple Wallet credentials. Required to generate `.pkpass` files. */
	apple?: AppleCredentials;
	/** Google Wallet credentials. Required to generate Google Wallet JWTs. */
	google?: GoogleCredentials;
	/**
	 * Reads a pass's current content by serial number. Required by
	 * `wallet.update()` and by `apple.webService`, which re-render passes from it.
	 */
	load?: LoadPass;
}

/** Result of {@link PassTemplate.create}. */
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
}

/** Result of `wallet.createBundle()`. */
export interface IssuedBundle {
	/**
	 * A `.pkpasses` bundle holding one signed `.pkpass` per item, or `null` if
	 * Apple credentials were omitted. Always a bundle, even for one item.
	 *
	 * Serve it under the `APPLE_PASSES_CONTENT_TYPE` content type. On Node HTTP
	 * servers wrap it with `Buffer.from(apple)`.
	 */
	apple: Uint8Array | null;
	/**
	 * One signed JWT whose save link adds every item to Google Wallet, or `null`
	 * if Google credentials were omitted. Pass it to `googleSaveUrl(jwt)`.
	 */
	google: string | null;
}

/**
 * Your app's current content for one issued pass. passlet re-renders the pass
 * from this whenever it changes, so your database stays the single source of
 * truth for both wallets.
 */
export interface LoadedPass {
	/** Recipient data, exactly as you'd pass it to `create()`. */
	content: Omit<PassContent, "serialNumber">;
	/** The template the pass was issued from. */
	template: PassTemplate;
	/**
	 * When this pass's content last changed. Apple devices use it to skip
	 * passes that haven't changed since they last asked.
	 */
	updatedAt: Date;
}

/** Reads a pass's current content, or `null` if your app has no such pass. */
export type LoadPass = (
	serialNumber: string
) => Promise<LoadedPass | null> | LoadedPass | null;

/** One Apple device that added a pass and asked to hear about its updates. */
export interface PassRegistration {
	/** Apple's device library identifier. Not a hardware ID; it can change. */
	deviceLibraryIdentifier: string;
	/** APNs token for this device. */
	pushToken: string;
	serialNumber: string;
}

/**
 * Where your app keeps Apple device registrations: one row per
 * `(deviceLibraryIdentifier, serialNumber)` pair, holding the device's `pushToken`.
 */
export interface PassRegistrations {
	/**
	 * Save a registration, replacing the push token if the pair exists.
	 * Resolve `true` when the pair is new, `false` when it already existed.
	 */
	add(registration: PassRegistration): Promise<boolean>;
	/** Every device registered for a pass. */
	devices(
		serialNumber: string
	): Promise<Omit<PassRegistration, "serialNumber">[]>;
	/** Delete a registration. Deleting a missing pair is not an error. */
	remove(deviceLibraryIdentifier: string, serialNumber: string): Promise<void>;
	/** Every pass a device is registered for. */
	serialNumbers(deviceLibraryIdentifier: string): Promise<string[]>;
}

/**
 * Apple's pass web service: the endpoints devices call to register for and
 * download updates, plus the push notifications that tell them to.
 */
export interface AppleWebService {
	/** Messages devices report to `/v1/log`, usually errors with your service. */
	onLog?: (messages: string[]) => void;
	/**
	 * Certificate and key for APNs. Default: `signerCert` and `signerKey`.
	 * Required with an external `signer`, because APNs needs the private key
	 * itself for its TLS connection.
	 */
	push?: { cert: string; key: string };
	/** Storage for device registrations. */
	registrations: PassRegistrations;
	/**
	 * Secret that derives each pass's own authentication token. At least 32
	 * characters; generate one with `openssl rand -base64 32`.
	 *
	 * Keep it for as long as issued passes exist: Apple forbids changing a
	 * pass's token, so changing or losing the secret stops those passes from
	 * updating. It is separate from the signing key because Pass Type ID
	 * certificates are renewed yearly.
	 */
	secret: string;
	/**
	 * Public URL where `wallet.handler` is mounted. Written into every Apple
	 * pass as `webServiceURL`, so it must stay stable for as long as those
	 * passes exist. Apple requires HTTPS outside development.
	 */
	url: string;
}

/** Result of `wallet.update()`. */
export interface UpdateResult {
	/** Apple devices notified, or `null` without `apple.webService`. */
	apple: { failed: number; notified: number; removed: number } | null;
	/** What happened on Google, or `null` without Google credentials. */
	google: "updated" | "created" | null;
}
