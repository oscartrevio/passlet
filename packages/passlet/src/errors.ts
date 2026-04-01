export const WALLET_ERROR_CODES = {
	// Config validation — message comes from the schema
	PASS_CONFIG_INVALID: "PassConfig invalid",
	CREATE_CONFIG_INVALID: "CreateConfig invalid",

	// Apple — provider-level constraints the schema cannot enforce
	APPLE_INVALID_SIGNER_CERT:
		"Apple signing failed: signerCert is not a valid PEM certificate",
	APPLE_INVALID_SIGNER_KEY:
		"Apple signing failed: signerKey is not a valid PEM private key",
	APPLE_INVALID_WWDR:
		"Apple signing failed: wwdr is not a valid PEM certificate",
	APPLE_SIGNING_FAILED:
		"Apple signing failed: could not create PKCS#7 signature",
	APPLE_MISSING_ICON: "Apple Wallet requires an icon image for every pass",
	APPLE_UNSUPPORTED_BARCODE_FORMAT:
		"Apple Wallet does not support this barcode format — use QR, PDF417, or Aztec",
	APPLE_BOARDING_MISSING_TRANSIT_TYPE:
		"Apple Wallet boarding passes require a transitType",

	// Google — provider-level constraints the schema cannot enforce
	GOOGLE_INVALID_PRIVATE_KEY:
		"Google signing failed: privateKey is not a valid PKCS#8 PEM private key",
	GOOGLE_SIGNING_FAILED: "Google signing failed: could not sign the Wallet JWT",
	GOOGLE_API_ERROR: "Google Wallet API error",
	GOOGLE_MISSING_LOGO:
		"Google Wallet requires a public logo URL for this pass type",
	GOOGLE_FLIGHT_MISSING_CLASS_FIELDS:
		"Google Wallet flightClass requires flightHeader and localScheduledDepartureDateTime",
	GOOGLE_FLIGHT_MISSING_PASSENGER_NAME:
		"Google Wallet flightObject requires passengerName",

	// Images
	IMAGE_FETCH_NETWORK_ERROR: "Failed to fetch image: network error",
	IMAGE_FETCH_FAILED: "Failed to fetch image: non-2xx response",
} as const;

export type WalletErrorCode = keyof typeof WALLET_ERROR_CODES;

export class WalletError extends Error {
	readonly code: WalletErrorCode;

	constructor(code: WalletErrorCode, message?: string, options?: ErrorOptions) {
		super(message ?? WALLET_ERROR_CODES[code], options);
		this.name = "WalletError";
		this.code = code;
	}
}
