// biome-ignore lint/performance/noNamespaceImport: the namespace tree-shakes; zod/mini's named `z` export bundles all of zod.
import * as z from "zod/mini";
import {
	type Barcode,
	barcodeSchema,
	type GoogleModules,
	type GooglePassMessage,
	googleMessageSchema,
	googleModulesSchema,
	type ParsedBarcode,
	type ParsedGooglePassMessage,
} from "./parts";

// TOTP-based rotating barcode — generates a new barcode value every periodMillis ms.
// valuePattern uses {totp_value_hex} or {totp_value_decimal} as the rotating placeholder.
const googleRotatingBarcodeSchema = z.object({
	// Only QR_CODE and PDF_417 support rotation — the other BarcodeType values
	// (AZTEC, CODE_128, …) are rejected for a RotatingBarcode.
	type: z._default(z.enum(["QR_CODE", "PDF_417"]), "QR_CODE"),
	// Pattern containing the TOTP placeholder, e.g. "https://example.com/redeem/{totp_value_hex}"
	valuePattern: z
		.string()
		.check(z.minLength(1, "rotatingBarcode.valuePattern must not be empty")),
	totpDetails: z.object({
		periodMillis: z._default(z.string(), "30000"),
		algorithm: z._default(z.literal("TOTP_SHA1"), "TOTP_SHA1"),
		parameters: z.array(
			z.object({
				key: z.string(),
				valueLength: z.int().check(z.minimum(1), z.maximum(8)),
			})
		),
	}),
	renderEncoding: z.optional(z.literal("UTF_8")),
});

export const passContentSchema = z.object({
	serialNumber: z
		.string()
		.check(z.minLength(1, "PassContent missing: serialNumber")),
	barcode: z.optional(barcodeSchema),
	// Multiple barcodes. Apple emits every entry in `barcodes` and renders the
	// first one the device can display (iOS 27 and later reads more than one), so
	// list the preferred format first and a widely-supported fallback after it.
	// Google keeps a single barcode per object and uses the first entry.
	// Takes precedence over `barcode` when both are given.
	barcodes: z.optional(z.array(barcodeSchema)),
	// Apple: no equivalent — ignored
	// Google: validTimeInterval.start
	validFrom: z.optional(
		z.iso.datetime({
			message: 'must be an ISO datetime e.g. "2024-01-01T00:00:00Z"',
		})
	),
	expiresAt: z.optional(
		z.iso.datetime({
			message: 'must be an ISO datetime e.g. "2025-01-01T00:00:00Z"',
		})
	),
	// Per-recipient field values. null hides the field for this recipient.
	values: z.optional(z.record(z.string(), z.nullable(z.string()))),
	// Passes sharing a group are shown together. Apple: groupingIdentifier,
	// which Wallet honors only on boarding passes and event tickets, so it is
	// written for flight and event templates only. Google:
	// groupingInfo.groupingId on the object, for every pass type.
	group: z.optional(
		z.string().check(z.minLength(1, "group must not be empty"))
	),
	// Apple-specific per-recipient options.
	apple: z.optional(
		z.object({
			// Mark this issued pass as void. Displays a "Void" banner on the pass.
			// For Google, use pass.expire() instead — it transitions state via the API.
			voided: z.optional(z.boolean()),
		})
	),
	// Google-specific per-recipient options.
	google: z.optional(
		z.object({
			// Smart Tap NFC value for this specific pass holder (required when enableSmartTap is true)
			smartTapRedemptionValue: z.optional(z.string()),
			// TOTP rotating barcode — replaces the static barcode for this pass holder
			rotatingBarcode: z.optional(googleRotatingBarcodeSchema),
			// Per-recipient info messages shown inside the pass view
			messages: z.optional(z.array(googleMessageSchema)),
			// Per-recipient links, images, and value-added modules. Google merges
			// these with the class-level modules of the same name.
			...googleModulesSchema.shape,
			// Google transitObject requires tripType — per-recipient override of
			// google.transit.tripType (ignored outside the transit vertical).
			tripType: z.optional(z.enum(["oneWay", "roundTrip"])),
		})
	),
});

export interface RotatingBarcode {
	renderEncoding?: "UTF_8";
	totpDetails: {
		/** Defaults to `"30000"`. */
		periodMillis?: string;
		/** Defaults to `"TOTP_SHA1"`. */
		algorithm?: "TOTP_SHA1";
		parameters: { key: string; valueLength: number }[];
	};
	/** Defaults to `"QR_CODE"`. */
	type?: "QR_CODE" | "PDF_417";
	valuePattern: string;
}

export interface GoogleContentOptions extends GoogleModules {
	messages?: GooglePassMessage[];
	rotatingBarcode?: RotatingBarcode;
	smartTapRedemptionValue?: string;
	tripType?: "oneWay" | "roundTrip";
}

export interface PassContent {
	apple?: { voided?: boolean };
	barcode?: Barcode;
	barcodes?: Barcode[];
	expiresAt?: string;
	google?: GoogleContentOptions;
	group?: string;
	serialNumber: string;
	validFrom?: string;
	values?: Record<string, string | null>;
}

/** A rotating barcode as validated, with every default applied. */
export interface ParsedRotatingBarcode extends RotatingBarcode {
	totpDetails: Required<RotatingBarcode["totpDetails"]>;
	type: "QR_CODE" | "PDF_417";
}

interface ParsedGoogleContentOptions extends GoogleContentOptions {
	messages?: ParsedGooglePassMessage[];
	rotatingBarcode?: ParsedRotatingBarcode;
}

/** Recipient content as validated, with every default applied. */
export interface ParsedContent extends PassContent {
	barcode?: ParsedBarcode;
	barcodes?: ParsedBarcode[];
	google?: ParsedGoogleContentOptions;
}
