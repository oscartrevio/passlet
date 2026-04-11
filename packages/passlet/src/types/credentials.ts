/** Credentials for signing Apple Wallet `.pkpass` files. */
export interface AppleCredentials {
	/** Pass type identifier registered in your Apple Developer account. @example "pass.com.yourcompany.app" */
	passTypeIdentifier: string;
	/** PEM-encoded pass signing certificate from Apple Developer. */
	signerCert: string;
	/** PEM-encoded private key paired with `signerCert`. */
	signerKey: string;
	/** Your 10-character Apple Team ID. @example "ABCD1234EF" */
	teamId: string;
	/** PEM-encoded Apple WWDR intermediate certificate. */
	wwdr: string;
}

/** Credentials for signing Google Wallet JWTs and calling the Wallet REST API. */
export interface GoogleCredentials {
	/** `client_email` from your Google Cloud service account JSON key. */
	clientEmail: string;
	/** Issuer ID from the Google Pay & Wallet Console. */
	issuerId: string;
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
	/** Signed `.pkpass` archive ready to serve, or `null` if Apple credentials were omitted. */
	apple: Uint8Array | null;
	/** Signed JWT for a Google Wallet save link (`pay.google.com/gp/v/save/<jwt>`), or `null` if Google credentials were omitted. */
	google: string | null;
	/** Non-fatal notices — e.g. a missing optional image or an unset recommended field. */
	warnings: string[];
}
