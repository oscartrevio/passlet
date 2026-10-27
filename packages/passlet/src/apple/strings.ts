import { fieldValue } from "../field";
import type { ParsedTemplate } from "../schema/template";
import { encoder, type PassFile, passFile } from "./package";

// pass.strings uses NeXTSTEP/plist escaping, not JSON escaping. Backslashes go
// first: escaping quotes first would double the added backslash.
function escapeStringsValue(value: string): string {
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
	values: Readonly<Record<string, string | null>>,
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
	// An unlabelled field has no literal in pass.json to key an entry on.
	return isValue ? fieldValue(field, values) : field.label;
}

/**
 * One `<language>.lproj/pass.strings` per template locale, keyed by the
 * literal strings pass.json shows for these values.
 * https://developer.apple.com/documentation/walletpasses/creating-the-source-for-a-pass
 */
export function buildLocalizations(
	template: ParsedTemplate,
	values: Readonly<Record<string, string | null>>
): PassFile[] {
	return Object.entries(template.locales ?? {}).map(
		([language, translations]) => {
			// Two field keys can share a label — keep the first translation for a
			// given literal so the file has no duplicate entries.
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
			return passFile(
				`${language}.lproj/pass.strings`,
				encoder.encode([...entries.values()].join("\n"))
			);
		}
	);
}
