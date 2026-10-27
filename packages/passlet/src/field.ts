import type { FieldDef } from "./schema/parts";

type FieldOptions = Omit<FieldDef, "slot" | "key" | "label">;

type FieldArg = string | FieldOptions;

type FieldBuilder = (key: string, label: string, arg?: FieldArg) => FieldDef;

function slot(slot: FieldDef["slot"]): FieldBuilder {
	return (key, label, arg) => ({
		slot,
		key,
		label,
		...(typeof arg === "string" ? { value: arg } : arg),
	});
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
	header: slot("header"),
	/**
	 * Large, prominent area below the logo.
	 *
	 * Apple → `primaryFields`. Google → `subheader` (label) + `header` (value).
	 * On boarding passes, Apple renders a transit icon between the two primary fields,
	 * so place departure on the left and arrival on the right.
	 */
	primary: slot("primary"),
	/**
	 * Row below the primary area.
	 *
	 * Apple → `secondaryFields`. Google → `textModulesData`.
	 */
	secondary: slot("secondary"),
	/**
	 * Row below secondary. Supports two rows — pass `{ row: 0 }` or `{ row: 1 }` to assign.
	 *
	 * Apple → `auxiliaryFields`. Google → `textModulesData`.
	 */
	auxiliary: slot("auxiliary"),
	/**
	 * Back of the pass — visible only when the user flips it over.
	 * Good for terms, redemption instructions, or contact info.
	 *
	 * Apple → `backFields`. Google → `textModulesData`.
	 */
	back: slot("back"),
};

/** Recipient values by field key, as `content.values` carries them. */
type FieldValues = Readonly<Record<string, string | null>>;

/**
 * The text a pass shows for `field`: the recipient's value when
 * `content.values` has the key (`null` hides the field), else the template's
 * static `value`. Both wallets render from this one rule, and Apple's
 * pass.strings keys must match the pass.json text byte for byte.
 */
export function fieldValue(
	field: FieldDef,
	values: FieldValues
): string | undefined {
	const value = Object.hasOwn(values, field.key)
		? values[field.key]
		: field.value;
	return value ?? undefined;
}

/** {@link fieldValue} of the template field keyed `key`, if there is one. */
export function fieldValueByKey(
	fields: readonly FieldDef[],
	values: FieldValues,
	key: string
): string | undefined {
	const field = fields.find((f) => f.key === key);
	return field && fieldValue(field, values);
}
