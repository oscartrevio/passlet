import { describe, expect, it } from "vitest";
import { WalletError } from "./errors";
import { field, Pass } from "./pass";
import { createConfigSchema, passConfigSchema } from "./types/schemas";

// Minimal valid configs used as baselines throughout these tests.
const BASE_LOYALTY = {
	type: "loyalty" as const,
	id: "test-pass",
	name: "Test Pass",
	fields: [],
};

const BASE_CREATE = {
	serialNumber: "serial-001",
};

// ─── passConfigSchema ────────────────────────────────────────────────────────

describe("passConfigSchema", () => {
	it("accepts a minimal valid loyalty pass", () => {
		expect(passConfigSchema.safeParse(BASE_LOYALTY).success).toBe(true);
	});

	it("requires id", () => {
		const result = passConfigSchema.safeParse({ ...BASE_LOYALTY, id: "" });
		expect(result.success).toBe(false);
	});

	it("requires name", () => {
		const result = passConfigSchema.safeParse({ ...BASE_LOYALTY, name: "" });
		expect(result.success).toBe(false);
	});

	it("rejects an invalid hex color", () => {
		const result = passConfigSchema.safeParse({
			...BASE_LOYALTY,
			color: "red",
		});
		expect(result.success).toBe(false);
	});

	it("accepts a valid hex color", () => {
		const result = passConfigSchema.safeParse({
			...BASE_LOYALTY,
			color: "#1a2b3c",
		});
		expect(result.success).toBe(true);
	});

	it("rejects an unknown pass type", () => {
		const result = passConfigSchema.safeParse({
			...BASE_LOYALTY,
			type: "unknown",
		});
		expect(result.success).toBe(false);
	});

	it("validates IATA carrier code on flight passes", () => {
		const valid = passConfigSchema.safeParse({
			type: "flight",
			id: "f1",
			name: "Flight",
			fields: [],
			carrier: "AA",
		});
		expect(valid.success).toBe(true);

		const invalid = passConfigSchema.safeParse({
			type: "flight",
			id: "f1",
			name: "Flight",
			fields: [],
			carrier: "american", // too long, lowercase
		});
		expect(invalid.success).toBe(false);
	});

	it("validates IATA airport code on flight passes", () => {
		const invalid = passConfigSchema.safeParse({
			type: "flight",
			id: "f1",
			name: "Flight",
			fields: [],
			origin: "jfk", // must be uppercase
		});
		expect(invalid.success).toBe(false);
	});

	it("validates ISO datetime on event passes", () => {
		const invalid = passConfigSchema.safeParse({
			type: "event",
			id: "e1",
			name: "Event",
			fields: [],
			startsAt: "not-a-date",
		});
		expect(invalid.success).toBe(false);
	});
});

// ─── createConfigSchema ──────────────────────────────────────────────────────

describe("createConfigSchema", () => {
	it("accepts a minimal valid create config", () => {
		expect(createConfigSchema.safeParse(BASE_CREATE).success).toBe(true);
	});

	it("requires serialNumber", () => {
		const result = createConfigSchema.safeParse({ serialNumber: "" });
		expect(result.success).toBe(false);
	});

	it("validates ISO datetime for validFrom", () => {
		const invalid = createConfigSchema.safeParse({
			...BASE_CREATE,
			validFrom: "2024-01-01",
		});
		expect(invalid.success).toBe(false);

		const valid = createConfigSchema.safeParse({
			...BASE_CREATE,
			validFrom: "2024-01-01T00:00:00Z",
		});
		expect(valid.success).toBe(true);
	});

	it("validates ISO datetime for expiresAt", () => {
		const invalid = createConfigSchema.safeParse({
			...BASE_CREATE,
			expiresAt: "2025-12-31",
		});
		expect(invalid.success).toBe(false);
	});

	it("requires barcode value to be non-empty", () => {
		const invalid = createConfigSchema.safeParse({
			...BASE_CREATE,
			barcode: { value: "" },
		});
		expect(invalid.success).toBe(false);
	});

	it("defaults barcode format to QR", () => {
		const result = createConfigSchema.safeParse({
			...BASE_CREATE,
			barcode: { value: "abc123" },
		});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.barcode?.format).toBe("QR");
		}
	});
});

// ─── Pass constructor validation ─────────────────────────────────────────────

describe("Pass constructor", () => {
	it("throws PASS_CONFIG_INVALID for an empty id", () => {
		expect(() => new Pass({ ...BASE_LOYALTY, id: "" }, {})).toThrow(
			WalletError
		);
		expect(() => new Pass({ ...BASE_LOYALTY, id: "" }, {})).toThrow(
			expect.objectContaining({ code: "PASS_CONFIG_INVALID" })
		);
	});

	it("throws PASS_CONFIG_INVALID for an invalid color", () => {
		expect(
			() => new Pass({ ...BASE_LOYALTY, color: "blue" as never }, {})
		).toThrow(expect.objectContaining({ code: "PASS_CONFIG_INVALID" }));
	});

	it("does not throw for a valid config", () => {
		expect(() => new Pass(BASE_LOYALTY, {})).not.toThrow();
	});
});

// ─── Pass.create() validation ─────────────────────────────────────────────────

describe("Pass.create() config validation", () => {
	it("throws CREATE_CONFIG_INVALID for an empty serialNumber", async () => {
		const pass = new Pass(BASE_LOYALTY, {});
		await expect(pass.create({ serialNumber: "" })).rejects.toMatchObject({
			code: "CREATE_CONFIG_INVALID",
		});
	});

	it("throws CREATE_CONFIG_INVALID for an invalid validFrom", async () => {
		const pass = new Pass(BASE_LOYALTY, {});
		await expect(
			pass.create({ serialNumber: "s1", validFrom: "bad-date" as never })
		).rejects.toMatchObject({ code: "CREATE_CONFIG_INVALID" });
	});

	it("does not throw for valid config with no credentials", async () => {
		const pass = new Pass(BASE_LOYALTY, {});
		const result = await pass.create(BASE_CREATE);
		// No credentials → both are null, no errors
		expect(result.apple).toBeNull();
		expect(result.google).toBeNull();
		expect(result.warnings).toEqual([]);
	});
});

// ─── field builder ────────────────────────────────────────────────────────────

describe("field builder", () => {
	it("builds a primary field with the right slot", () => {
		const f = field.primary("name", "Name");
		expect(f).toMatchObject({ slot: "primary", key: "name", label: "Name" });
	});

	it("passes through optional field options", () => {
		const f = field.back("terms", "Terms", { value: "No refunds." });
		expect(f.value).toBe("No refunds.");
	});
});
