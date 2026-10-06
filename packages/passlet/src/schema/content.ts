import { z } from "zod";
import {
	barcodeSchema,
	googleMessageSchema,
	googleModulesSchema,
} from "./parts";

// TOTP-based rotating barcode — generates a new barcode value every periodMillis ms.
// valuePattern uses {totp_value_hex} or {totp_value_decimal} as the rotating placeholder.
const googleRotatingBarcodeSchema = z.object({
	// Only QR_CODE and PDF_417 support rotation — the other BarcodeType values
	// (AZTEC, CODE_128, …) are rejected for a RotatingBarcode.
	type: z.enum(["QR_CODE", "PDF_417"]).default("QR_CODE"),
	// Pattern containing the TOTP placeholder, e.g. "https://example.com/redeem/{totp_value_hex}"
	valuePattern: z
		.string()
		.min(1, "rotatingBarcode.valuePattern must not be empty"),
	totpDetails: z.object({
		periodMillis: z.string().default("30000"),
		algorithm: z.literal("TOTP_SHA1").default("TOTP_SHA1"),
		parameters: z.array(
			z.object({
				key: z.string(),
				valueLength: z.number().int().min(1).max(8),
			})
		),
	}),
	renderEncoding: z.literal("UTF_8").optional(),
});

export const passContentSchema = z.object({
	serialNumber: z.string().min(1, "PassContent missing: serialNumber"),
	barcode: barcodeSchema.optional(),
	// Multiple barcodes. Apple emits every entry in `barcodes` and renders the
	// first one the device can display (iOS 27 and later reads more than one), so
	// list the preferred format first and a widely-supported fallback after it.
	// Google keeps a single barcode per object and uses the first entry.
	// Takes precedence over `barcode` when both are given.
	barcodes: z.array(barcodeSchema).optional(),
	// Apple: no equivalent — ignored
	// Google: validTimeInterval.start
	validFrom: z.iso
		.datetime({
			message: 'must be an ISO datetime e.g. "2024-01-01T00:00:00Z"',
		})
		.optional(),
	expiresAt: z.iso
		.datetime({
			message: 'must be an ISO datetime e.g. "2025-01-01T00:00:00Z"',
		})
		.optional(),
	// Per-recipient field values. null hides the field for this recipient.
	values: z.record(z.string(), z.string().nullable()).optional(),
	// Passes sharing a group are shown together. Apple: groupingIdentifier,
	// which Wallet honors only on boarding passes and event tickets, so it is
	// written for flight and event templates only. Google:
	// groupingInfo.groupingId on the object, for every pass type.
	group: z.string().min(1, "group must not be empty").optional(),
	// Apple-specific per-recipient options.
	apple: z
		.object({
			// Mark this issued pass as void. Displays a "Void" banner on the pass.
			// For Google, use pass.expire() instead — it transitions state via the API.
			voided: z.boolean().optional(),
		})
		.optional(),
	// Google-specific per-recipient options.
	google: z
		.object({
			// Smart Tap NFC value for this specific pass holder (required when enableSmartTap is true)
			smartTapRedemptionValue: z.string().optional(),
			// TOTP rotating barcode — replaces the static barcode for this pass holder
			rotatingBarcode: googleRotatingBarcodeSchema.optional(),
			// Per-recipient info messages shown inside the pass view
			messages: z.array(googleMessageSchema).optional(),
			// Per-recipient links, images, and value-added modules. Google merges
			// these with the class-level modules of the same name.
			...googleModulesSchema.shape,
			// Google transitObject requires tripType — per-recipient override of
			// google.transit.tripType (ignored outside the transit vertical).
			tripType: z.enum(["oneWay", "roundTrip"]).optional(),
		})
		.optional(),
});

export type PassContent = z.infer<typeof passContentSchema>;
export type RotatingBarcode = z.infer<typeof googleRotatingBarcodeSchema>;
