export interface AppleCredentials {
	/** @example "pass.com.yourcompany.yourapp" */
	passTypeIdentifier: string;
	/** PEM-encoded pass signing certificate. */
	signerCert: string;
	/** PEM-encoded private key paired with the signing certificate. */
	signerKey: string;
	/** Your 10-character Apple Team ID. @example "ABCD1234EF" */
	teamId: string;
	/** PEM-encoded Apple WWDR intermediate certificate. */
	wwdr: string;
}

export interface GoogleCredentials {
	/** client_email from your Google Cloud service account JSON key. */
	clientEmail: string;
	/** Your Google Wallet issuer ID from the Google Pay & Wallet Console. */
	issuerId: string;
	/** private_key from your Google Cloud service account JSON key (PKCS#8 PEM). */
	privateKey: string;
}

export interface WalletCredentials {
	/** Apple Wallet credentials. Omit to skip Apple pass generation. */
	apple?: AppleCredentials;
	/** Google Wallet credentials. Omit to skip Google pass generation. */
	google?: GoogleCredentials;
}

export interface IssuedPass {
	/** The .pkpass file as Uint8Array, ready to serve. null when Apple credentials were not provided. */
	apple: Uint8Array | null;
	/** Signed Google Wallet JWT for the save link. null when Google credentials were not provided. */
	google: string | null;
	/** Non-fatal warnings (e.g. optional image fetch failures). */
	warnings: string[];
}
