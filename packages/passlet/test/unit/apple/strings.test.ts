import { describe, expect, it } from "vitest";
import { buildStringsLines } from "../../../src/providers/apple/index";
import type { FieldDef, PassConfig } from "../../../src/types/schemas";

type LoyaltyPass = Extract<PassConfig, { type: "loyalty" }>;

function loyalty(overrides: Partial<LoyaltyPass> = {}): LoyaltyPass {
	return {
		type: "loyalty",
		id: "p1",
		name: "Acme Rewards",
		fields: [],
		...overrides,
	};
}

function field(key: string, label?: string, value?: string): FieldDef {
	return { slot: "primary", key, label, value };
}

describe("buildStringsLines", () => {
	// Apple matches entries against the literal strings in pass.json, so a
	// locale key has to resolve to the label, the pass name or the value.
	it("keys entries by the literal label, pass name and field value, never the field key", () => {
		const pass = loyalty({
			fields: [field("points", "Points"), field("tier", "Tier", "Gold")],
		});
		expect(
			buildStringsLines(
				pass,
				{},
				{ points: "Puntos", name: "Recompensas Acme", tier_value: "Oro" }
			)
		).toEqual([
			'"Points" = "Puntos";',
			'"Acme Rewards" = "Recompensas Acme";',
			'"Gold" = "Oro";',
		]);
	});

	it("passes unmatched keys through so literals such as logoText can be translated", () => {
		expect(
			buildStringsLines(loyalty(), {}, { "Fly Away": "Vuela lejos" })
		).toEqual(['"Fly Away" = "Vuela lejos";']);
	});

	it("skips a field with no label — there is no literal to key on", () => {
		const pass = loyalty({ fields: [field("points", undefined, "500")] });
		expect(buildStringsLines(pass, {}, { points: "Puntos" })).toEqual([]);
	});

	it("keeps one entry when two fields share a label", () => {
		const pass = loyalty({
			fields: [field("points", "Total"), field("spend", "Total")],
		});
		expect(
			buildStringsLines(pass, {}, { points: "Total ES", spend: "Ignored" })
		).toEqual(['"Total" = "Total ES";']);
	});

	it("keys _value entries by the per-recipient value and skips a hidden field", () => {
		const pass = loyalty({ fields: [field("tier", "Tier", "Gold")] });
		expect(
			buildStringsLines(pass, { tier: "Silver" }, { tier_value: "Plata" })
		).toEqual(['"Silver" = "Plata";']);
		expect(
			buildStringsLines(pass, { tier: null }, { tier_value: "Plata" })
		).toEqual([]);
	});

	it("escapes both the literal and the translation", () => {
		const pass = loyalty({ name: 'The "Best" Pass' });
		expect(buildStringsLines(pass, {}, { name: 'Say "Hola"\nAdiós' })).toEqual([
			'"The \\"Best\\" Pass" = "Say \\"Hola\\"\\nAdiós";',
		]);
	});
});
