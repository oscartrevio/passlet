// Regenerates test/support/google-discovery.json, the oracle the Google tests
// check request bodies against, from Google's Wallet Objects discovery
// document. Run from packages/passlet, then format:
//   node scripts/update-google-schema.ts && pnpm biome format --write test/support/google-discovery.json
// Keeps only the schemas reachable from the resources passlet writes, and of
// each property only what the oracle checks: its type, its schema reference,
// its allowed enum values (deprecated aliases dropped) and whether Google
// deprecated it.
import { writeFileSync } from "node:fs";

const SOURCE =
	"https://walletobjects.googleapis.com/$discovery/rest?version=v1";
const OUTPUT = new URL(
	"../test/support/google-discovery.json",
	import.meta.url
);

// The request bodies passlet sends: every class and object it writes, and
// AddMessage.
const ROOTS = [
	"LoyaltyClass",
	"LoyaltyObject",
	"OfferClass",
	"OfferObject",
	"EventTicketClass",
	"EventTicketObject",
	"FlightClass",
	"FlightObject",
	"GiftCardClass",
	"GiftCardObject",
	"GenericClass",
	"GenericObject",
	"TransitClass",
	"TransitObject",
	"AddMessageRequest",
];

interface DiscoveryProperty {
	$ref?: string;
	deprecated?: boolean;
	enum?: string[];
	enumDeprecated?: boolean[];
	items?: DiscoveryProperty;
	type?: string;
}

interface Discovery {
	revision: string;
	schemas: Record<
		string,
		{ properties?: Record<string, DiscoveryProperty> } | undefined
	>;
}

interface Property {
	$ref?: string;
	deprecated?: true;
	enum?: string[];
	items?: Property;
	type?: string;
}

function prune(property: DiscoveryProperty): Property {
	return {
		...(property.type && { type: property.type }),
		...(property.$ref && { $ref: property.$ref }),
		...(property.items && { items: prune(property.items) }),
		...(property.enum && {
			enum: property.enum.filter(
				(_, index) => !property.enumDeprecated?.[index]
			),
		}),
		...(property.deprecated && { deprecated: true }),
	};
}

const response = await fetch(SOURCE);
if (!response.ok) {
	throw new Error(`GET ${SOURCE} answered ${response.status}`);
}
const discovery: Discovery = await response.json();

const schemas: Record<string, Record<string, Property>> = {};
const pending = [...ROOTS];
for (let name = pending.pop(); name; name = pending.pop()) {
	if (schemas[name]) {
		continue;
	}
	const properties = discovery.schemas[name]?.properties;
	if (!properties) {
		throw new Error(`discovery document has no schema ${name}`);
	}
	schemas[name] = Object.fromEntries(
		Object.entries(properties)
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([key, property]) => [key, prune(property)])
	);
	for (const property of Object.values(properties)) {
		const ref = property.$ref ?? property.items?.$ref;
		if (ref) {
			pending.push(ref);
		}
	}
}

const sorted = Object.fromEntries(
	Object.entries(schemas).sort(([a], [b]) => a.localeCompare(b))
);
writeFileSync(
	OUTPUT,
	`${JSON.stringify({ source: SOURCE, revision: discovery.revision, schemas: sorted }, null, "\t")}\n`
);
console.log(
	`Wrote ${Object.keys(sorted).length} schemas (revision ${discovery.revision})`
);
