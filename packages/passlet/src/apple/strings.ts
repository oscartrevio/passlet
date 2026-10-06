import type { ParsedTemplate } from "../schema/template";

// pass.strings uses NeXTSTEP/plist escaping, not JSON escaping.
export function escapeStringsValue(value: string): string {
	return value
		.replace(/\\/g, "\\\\")
		.replace(/"/g, '\\"')
		.replace(/\n/g, "\\n")
		.replace(/\r/g, "\\r");
}

// Apple matches literal pass.json strings, not field keys. Locale keys resolve
// to labels, "<key>_value" to rendered values, and "name" to the pass name.
// Unmatched keys pass through for literals such as logoText.
const VALUE_SUFFIX = "_value";

function stringsLiteral(
	template: ParsedTemplate,
	values: Record<string, string | null>,
	key: string
): string | undefined {
	if (key === "name") {
		return template.name;
	}
	const isValue = key.endsWith(VALUE_SUFFIX);
	const fieldKey = isValue ? key.slice(0, -VALUE_SUFFIX.length) : key;
	const field = template.fields.find((f) => f.key === fieldKey);
	if (!field) {
		return key;
	}
	if (!isValue) {
		// An unlabelled field has no literal in pass.json to key an entry on.
		return field.label;
	}
	return (field.key in values ? values[field.key] : field.value) ?? undefined;
}

export function buildStringsLines(
	template: ParsedTemplate,
	values: Record<string, string | null>,
	translations: Record<string, string>
): string[] {
	// Two field keys can share a label — keep the first translation for a given
	// literal so the file has no duplicate entries.
	const entries = new Map<string, string>();
	for (const [key, translation] of Object.entries(translations)) {
		const literal = stringsLiteral(template, values, key);
		if (literal === undefined || entries.has(literal)) {
			continue;
		}
		entries.set(
			literal,
			`"${escapeStringsValue(literal)}" = "${escapeStringsValue(translation)}";`
		);
	}
	return [...entries.values()];
}
