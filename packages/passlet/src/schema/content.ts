import {
	array,
	boolean,
	nonEmpty,
	nullable,
	object,
	optional,
	record,
	string,
	validate,
} from "./check";
import {
	type GoogleContentOptions,
	googleContentOptions,
	type ParsedGoogleContentOptions,
} from "./google";
import { type Barcode, barcode, type ParsedBarcode, timestamp } from "./parts";

/** Apple-only options of one recipient's pass. */
export interface AppleContentOptions {
	/**
	 * Shows the pass as void. For Google, call `template.expire()`, which moves
	 * the pass to the expired state.
	 */
	voided?: boolean;
}

/** One recipient's pass: what `create()` issues and `load` returns. */
export interface PassContent {
	/** Apple-only options of this pass. */
	apple?: AppleContentOptions;
	/** The pass's barcode. */
	barcode?: Barcode;
	/**
	 * Several barcodes, taking precedence over `barcode`. Apple writes them
	 * all and shows the first the device can render (iOS 27 and later read
	 * more than one), so list the preferred format first and a widely
	 * supported fallback after it. Google keeps one barcode: the first.
	 */
	barcodes?: Barcode[];
	/**
	 * When the pass expires, as a W3C timestamp with a time zone like
	 * `"2025-12-09T13:00-07:00"`. Apple: `expirationDate`. Google:
	 * `validTimeInterval.end`.
	 */
	expiresAt?: string;
	/** Google-only options of this pass. */
	google?: GoogleContentOptions;
	/**
	 * Passes with the same group show together. Apple: `groupingIdentifier`,
	 * which Wallet honors on boarding passes and event tickets only, so it is
	 * written for those. Google: `groupingInfo.groupingId`, on every pass type.
	 */
	group?: string;
	/**
	 * Identifies the pass. With Google credentials it may hold only letters,
	 * digits, `.`, `_` and `-`, because Google uses it in the object ID.
	 */
	serialNumber: string;
	/**
	 * Google only: when the pass becomes valid, as a W3C timestamp with a time
	 * zone. Google: `validTimeInterval.start`.
	 */
	validFrom?: string;
	/** This recipient's field values by field key; `null` hides the field. */
	values?: Record<string, string | null>;
}

/** Recipient content as validated, with every default applied. */
export interface ParsedContent extends PassContent {
	/** The barcode, with its format default applied. */
	barcode?: ParsedBarcode;
	/** The barcodes, each with its format default applied. */
	barcodes?: ParsedBarcode[];
	/** Google-only options, with every default applied. */
	google?: ParsedGoogleContentOptions;
}

const content = object<ParsedContent>({
	serialNumber: nonEmpty,
	barcode: optional(barcode),
	barcodes: optional(array(barcode)),
	validFrom: optional(timestamp),
	expiresAt: optional(timestamp),
	values: optional(record(nullable(string))),
	group: optional(nonEmpty),
	apple: optional(object<AppleContentOptions>({ voided: optional(boolean) })),
	google: optional(googleContentOptions),
});

/**
 * The content as validated, with every default applied.
 *
 * @throws {WalletError} `CREATE_CONFIG_INVALID` listing every issue.
 */
export function parseContent(input: PassContent): ParsedContent {
	return validate(content, input, "CREATE_CONFIG_INVALID", "content");
}
