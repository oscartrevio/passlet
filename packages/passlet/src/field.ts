import type { FieldDef } from "./schema/parts";

type FieldOptions = Omit<FieldDef, "slot" | "key" | "label">;

type FieldArg = string | FieldOptions;

function resolveOptions(arg: FieldArg | undefined): FieldOptions | undefined {
	return typeof arg === "string" ? { value: arg } : arg;
}

/**
 * Builders for pass display fields. Pass the result into the `fields` array
 * of any template config.
 *
 * The third argument is either a string (shorthand for `value`) or a full
 * {@link FieldDef} options object for formatting, alignment, and more.
 *
 * @example
 * fields: [
 *   field.primary("points", "Points", "1 250"),
 *   field.secondary("tier", "Tier", "Gold"),
 *   field.back("terms", "Terms", { value: "No refunds." }),
 * ]
 */
export const field = {
	/**
	 * Top-right corner of the pass. Space is limited — use at most one field.
	 *
	 * Apple → `headerFields`. Google → `textModulesData`.
	 */
	header: (key: string, label: string, arg?: FieldArg): FieldDef => ({
		slot: "header",
		key,
		label,
		...resolveOptions(arg),
	}),
	/**
	 * Large, prominent area below the logo.
	 *
	 * Apple → `primaryFields`. Google → `subheader` (label) + `header` (value).
	 * On boarding passes, Apple renders a transit icon between the two primary fields,
	 * so place departure on the left and arrival on the right.
	 */
	primary: (key: string, label: string, arg?: FieldArg): FieldDef => ({
		slot: "primary",
		key,
		label,
		...resolveOptions(arg),
	}),
	/**
	 * Row below the primary area.
	 *
	 * Apple → `secondaryFields`. Google → `textModulesData`.
	 */
	secondary: (key: string, label: string, arg?: FieldArg): FieldDef => ({
		slot: "secondary",
		key,
		label,
		...resolveOptions(arg),
	}),
	/**
	 * Row below secondary. Supports two rows — pass `{ row: 0 }` or `{ row: 1 }` to assign.
	 *
	 * Apple → `auxiliaryFields`. Google → `textModulesData`.
	 */
	auxiliary: (key: string, label: string, arg?: FieldArg): FieldDef => ({
		slot: "auxiliary",
		key,
		label,
		...resolveOptions(arg),
	}),
	/**
	 * Back of the pass — visible only when the user flips it over.
	 * Good for terms, redemption instructions, or contact info.
	 *
	 * Apple → `backFields`. Google → `textModulesData`.
	 */
	back: (key: string, label: string, arg?: FieldArg): FieldDef => ({
		slot: "back",
		key,
		label,
		...resolveOptions(arg),
	}),
};

/**
 * `Content-Type` Apple Wallet requires when serving a `.pkpass` file.
 *
 * iOS silently refuses to open a pass served under any other type (a plain
 * `application/octet-stream` download is the most common failure), so use this
 * constant rather than retyping the string.
 *
 * @example
 * res.setHeader("Content-Type", APPLE_PASS_CONTENT_TYPE);
 * res.end(Buffer.from(apple)); // Buffer.from — `apple` is a Uint8Array
 */
export const APPLE_PASS_CONTENT_TYPE = "application/vnd.apple.pkpass";

/**
 * `Content-Type` for a `.pkpasses` bundle of several passes, as returned by
 * `wallet.createBundle()`.
 *
 * @example
 * res.setHeader("Content-Type", APPLE_PASSES_CONTENT_TYPE);
 * res.end(Buffer.from(apple));
 */
export const APPLE_PASSES_CONTENT_TYPE = "application/vnd.apple.pkpasses";

/**
 * Builds the "Add to Google Wallet" save link for a signed JWT — the `google`
 * value returned by {@link PassTemplate.create}.
 *
 * @example
 * const { google } = await card.create({ serialNumber: "user-123" });
 * if (google) {
 *   res.redirect(googleSaveUrl(google));
 * }
 */
export function googleSaveUrl(jwt: string): string {
	return `https://pay.google.com/gp/v/save/${jwt}`;
}
