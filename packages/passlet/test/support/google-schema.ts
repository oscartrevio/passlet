/**
 * Checks request bodies against Google's Wallet Objects discovery document,
 * pruned into google-discovery.json by scripts/update-google-schema.ts:
 * https://walletobjects.googleapis.com/$discovery/rest?version=v1
 * Every key at every depth must be a field Google documents, of the
 * documented type, with a current (non-deprecated) enum value. Regenerate the
 * fixture rather than editing it.
 */
import type { GoogleVertical } from "../../src/google/utils";
import discovery from "./google-discovery.json" with { type: "json" };

export type GoogleResource = `${GoogleVertical}${"Class" | "Object"}`;

interface Property {
	$ref?: string;
	deprecated?: boolean;
	enum?: string[];
	items?: Property;
	type?: string;
}

const schemas: Record<string, Record<string, Property> | undefined> =
	discovery.schemas;

const DOC_BASE = "https://developers.google.com/wallet/reference/rest/v1";

function propertyViolations(
	property: Property,
	value: unknown,
	path: string
): string[] {
	// JSON.stringify drops undefined, and a PATCH clears a field with null.
	if (value === undefined || value === null) {
		return [];
	}
	if (property.deprecated) {
		return [`${path} is deprecated`];
	}
	if (property.$ref) {
		return schemaViolations(property.$ref, value, path);
	}
	if (property.type === "array") {
		if (!Array.isArray(value)) {
			return [`${path} must be an array`];
		}
		const items = property.items;
		return items
			? value.flatMap((item, index) =>
					propertyViolations(items, item, `${path}[${index}]`)
				)
			: [];
	}
	const expected = property.type === "integer" ? "number" : property.type;
	if (typeof value !== expected) {
		return [`${path} must be a ${property.type}, got ${JSON.stringify(value)}`];
	}
	if (property.enum && !property.enum.includes(String(value))) {
		return [`${path} has no current enum value ${JSON.stringify(value)}`];
	}
	return [];
}

function schemaViolations(
	schema: string,
	value: unknown,
	path: string
): string[] {
	const properties = schemas[schema];
	if (!properties) {
		throw new Error(`google-discovery.json has no schema ${schema}`);
	}
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return [`${path} must be a ${schema} object`];
	}
	return Object.entries(value).flatMap(([key, field]) => {
		const property = properties[key];
		if (property) {
			return propertyViolations(property, field, `${path}.${key}`);
		}
		return field === undefined
			? []
			: [`${path}.${key} is not a ${schema} field`];
	});
}

// `loyaltyClass` → `LoyaltyClass`; the AddMessage body has its own schema.
function assertSchema(resource: string, body: object): void {
	const schema =
		resource === "addMessage"
			? "AddMessageRequest"
			: `${resource.charAt(0).toUpperCase()}${resource.slice(1)}`;
	const violations = schemaViolations(schema, body, resource);
	if (violations.length > 0) {
		throw new Error(
			`${violations.join("\n")}\nSee ${DOC_BASE}/${resource.toLowerCase()} (discovery revision ${discovery.revision})`
		);
	}
}

/** Throws unless `body` is a valid write of `resource`, nested fields included. */
export function assertGoogleSchema(
	resource: GoogleResource,
	body: object
): void {
	assertSchema(resource, body);
}

/**
 * Throws unless a Wallet request body is one Google accepts for its path:
 * `/loyaltyClass`, `/loyaltyObject/{id}`, `/loyaltyObject/{id}/addMessage`.
 */
export function assertWalletRequest(
	method: string,
	path: string,
	body: object | undefined
): void {
	if ((method === "GET") !== (body === undefined)) {
		throw new Error(`${method} ${path}: only GET is sent without a body`);
	}
	const [, resource = "", , action] = path.split("/");
	if (body) {
		assertSchema(action ?? resource, body);
	}
}

export function assertRequiredKeys(
	resource: GoogleResource,
	body: Record<string, unknown>,
	required: readonly string[]
): void {
	const missing = required.filter((key) => body[key] === undefined);
	if (missing.length > 0) {
		throw new Error(
			`${resource} is missing required key(s): ${missing.join(", ")}.\nSee ${DOC_BASE}/${resource.toLowerCase()}`
		);
	}
}
