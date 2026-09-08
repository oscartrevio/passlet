export const WALLET_ERROR_CODES = {
	PASS_CONFIG_INVALID: {
		status: 400,
		message: "Invalid pass template.",
		why: "The template does not satisfy the pass schema.",
		fix: "Correct each field listed in issues before constructing the template.",
	},
	CREATE_CONFIG_INVALID: {
		status: 400,
		message: "Invalid recipient data.",
		why: "The issuance or update data does not satisfy the recipient schema.",
		fix: "Correct each field listed in issues before retrying the operation.",
	},
	APPLE_INVALID_SIGNER_CERT: {
		status: 500,
		message: "Invalid Apple signing certificate.",
		why: "signerCert could not be parsed as a PEM certificate.",
		fix: "Export your Pass Type ID certificate as PEM and pass its contents as signerCert.",
	},
	APPLE_INVALID_SIGNER_KEY: {
		status: 500,
		message: "Invalid Apple signing key.",
		why: "signerKey could not be parsed as an unencrypted PEM private key.",
		fix: "Export the private key matching signerCert as unencrypted PEM.",
	},
	APPLE_INVALID_WWDR: {
		status: 500,
		message: "Invalid Apple WWDR certificate.",
		why: "wwdr could not be parsed as a PEM certificate.",
		fix: "Download the Apple WWDR G4 intermediate certificate and convert DER to PEM.",
	},
	APPLE_SIGNING_FAILED: {
		status: 500,
		message: "Apple pass signing failed.",
		why: "The signer could not produce the pass's detached PKCS#7 signature.",
		fix: "Check the certificate/key pair; for an external signer, check the digest and RSA padding.",
	},
	APPLE_MISSING_ICON: {
		status: 400,
		message: "Apple pass icon is missing.",
		why: "Apple Wallet requires an icon on every pass.",
		fix: "Set apple.icon to PNG bytes or an accessible image URL, with an @2x variant.",
	},
	APPLE_BOARDING_MISSING_TRANSIT_TYPE: {
		status: 400,
		message: "Boarding pass transit type is missing.",
		why: "Apple boarding passes require a transitType.",
		fix: "Set transitType to air, train, bus, boat, or generic.",
	},
	APPLE_MISSING_AUTH_TOKEN: {
		status: 400,
		message: "Apple update authentication token is missing or too short.",
		why: "A pass using webServiceURL needs an authenticationToken of at least 16 characters.",
		fix: "Set apple.authenticationToken to a secure token with at least 16 characters.",
	},
	APPLE_APP_LAUNCH_URL_REQUIRES_STORE_IDS: {
		status: 400,
		message: "Associated App Store identifiers are missing.",
		why: "Apple requires associatedStoreIdentifiers when appLaunchURL is set.",
		fix: "Set apple.associatedStoreIdentifiers to your app's numeric App Store IDs.",
	},
	GOOGLE_INVALID_PRIVATE_KEY: {
		status: 500,
		message: "Invalid Google service-account private key.",
		why: "privateKey could not be imported as a PKCS#8 PEM private key.",
		fix: "Use private_key unchanged from the service-account JSON, not the filename or entire JSON.",
	},
	GOOGLE_SIGNING_FAILED: {
		status: 500,
		message: "Google JWT signing failed.",
		why: "The service-account key could not sign the OAuth assertion or Wallet JWT.",
		fix: "Check that the service-account key is a valid RSA private key usable with RS256.",
	},
	GOOGLE_API_ERROR: {
		status: 502,
		message: "Google rejected the Wallet request.",
		why: "The Wallet API returned an error not covered by a more specific code.",
		fix: "Check status and verify the pass fields against Google's resource requirements.",
	},
	GOOGLE_AUTH_FAILED: {
		status: 401,
		message: "Google authentication failed.",
		why: "Google rejected the service-account assertion or access token.",
		fix: "Check clientEmail, the active service-account key, and the system clock.",
	},
	GOOGLE_ACCESS_DENIED: {
		status: 403,
		message: "Google denied access to the issuer.",
		why: "The credentials do not have permission to perform this Wallet operation.",
		fix: "Enable the Wallet API and grant the service-account email Developer access to your issuer.",
	},
	GOOGLE_NOT_FOUND: {
		status: 404,
		message: "Google Wallet resource was not found.",
		why: "The requested class or saved pass object does not exist for this issuer.",
		fix: "Check the issuer, template ID, and serial number; a pass must be saved before updating it.",
	},
	GOOGLE_CONFLICT: {
		status: 409,
		message: "Google Wallet resource already exists.",
		why: "Another resource already uses the requested ID.",
		fix: "Use the existing resource or a different ID; publish shared template changes explicitly.",
	},
	GOOGLE_RATE_LIMITED: {
		status: 429,
		message: "Google request quota was exceeded.",
		why: "Google is limiting requests for the issuer or project.",
		fix: "Reduce request volume and wait before retrying; respect retryAfter when provided.",
	},
	GOOGLE_UNAVAILABLE: {
		status: 503,
		message: "Google Wallet is temporarily unavailable.",
		why: "Google returned a server error.",
		fix: "Retry later with backoff and respect retryAfter when provided.",
	},
	GOOGLE_NETWORK_ERROR: {
		status: 502,
		message: "Could not reach Google.",
		why: "The OAuth or Wallet request failed before a complete response could be read.",
		fix: "Check DNS, TLS, proxies, and network access to Google's OAuth and Wallet endpoints.",
	},
	GOOGLE_INVALID_RESPONSE: {
		status: 502,
		message: "Google returned an invalid response.",
		why: "A successful response was malformed or missing required data.",
		fix: "Check for an upstream service or proxy failure before retrying.",
	},
	GOOGLE_NOT_CONFIGURED: {
		status: 500,
		message: "Google Wallet is not configured.",
		why: "Template publication was requested without Google credentials.",
		fix: "Configure google credentials on Wallet before calling publish().",
	},
	GOOGLE_MISSING_LOGO: {
		status: 400,
		message: "Google Wallet logo is missing.",
		why: "Google loyalty and transit classes require a publicly accessible logo URL.",
		fix: "Set google.logo to a hosted image URL; image bytes are not supported by Google.",
	},
	GOOGLE_FLIGHT_MISSING_CLASS_FIELDS: {
		status: 400,
		message: "Google flight details are incomplete.",
		why: "The flight class is missing required header or departure data.",
		fix: "Set carrier, flightNumber, origin, destination, and departure on the flight template.",
	},
	GOOGLE_FLIGHT_MISSING_PASSENGER_NAME: {
		status: 400,
		message: "Google flight passenger name is missing.",
		why: "Google requires passengerName on each flight pass object.",
		fix: "Set values.passengerName when issuing the flight pass.",
	},
	IMAGE_FETCH_NETWORK_ERROR: {
		status: 502,
		message: "Could not download the image.",
		why: "The image request failed before its bytes could be read.",
		fix: "Check the image URL and network access, or supply Apple image bytes directly.",
	},
	IMAGE_FETCH_FAILED: {
		status: 502,
		message: "The image server rejected the download.",
		why: "The image URL returned a non-success HTTP status.",
		fix: "Check that the URL is accessible and has not expired; inspect status for the response code.",
	},
} as const;

export type WalletErrorCode = keyof typeof WALLET_ERROR_CODES;

export interface WalletValidationIssue {
	message: string;
	path: readonly (string | number)[];
}

export interface WalletErrorOptions extends ErrorOptions {
	issues?: readonly WalletValidationIssue[];
	/** Seconds to wait, as requested by the remote server. No retry is performed. */
	retryAfter?: number;
	/** Upstream HTTP status, when available; otherwise the catalog default is used. */
	status?: number;
}

export class WalletError extends Error {
	readonly code: WalletErrorCode;
	readonly status: number;
	readonly why: string;
	readonly fix: string;
	readonly retryAfter: number | undefined;
	readonly issues: readonly WalletValidationIssue[];

	constructor(
		code: WalletErrorCode,
		message?: string,
		options?: WalletErrorOptions
	) {
		const definition = WALLET_ERROR_CODES[code];
		super(message ?? definition.message, options);
		this.name = "WalletError";
		this.code = code;
		this.status = options?.status ?? definition.status;
		this.why = definition.why;
		this.fix = definition.fix;
		this.retryAfter = options?.retryAfter;
		this.issues = options?.issues ?? [];
	}
}
