import JSZip from "jszip";
import { beforeAll, describe, expect, it } from "vitest";
import type { AppleCredentials } from "../../types/credentials";
import { generateApplePass } from "./index";
import { generateTestCerts, type TestCerts } from "./test-certs";

const SHA1_RE = /^[0-9a-f]{40}$/;

// ─── Fixtures ────────────────────────────────────────────────────────────────

let certs: TestCerts;
let credentials: AppleCredentials;

// Stub icon — Apple requires one but content doesn't matter for structure tests.
const STUB_ICON = new Uint8Array([1, 2, 3]);

beforeAll(() => {
	certs = generateTestCerts();
	credentials = {
		passTypeIdentifier: "pass.com.test.example",
		teamId: "ABCD1234EF",
		signerCert: certs.signerCert,
		signerKey: certs.signerKey,
		wwdr: certs.wwdr,
	};
}, 30_000);

async function extractPassJson(
	passBytes: Uint8Array
): Promise<Record<string, unknown>> {
	const zip = await JSZip.loadAsync(passBytes);
	const raw = await zip.file("pass.json")?.async("string");
	if (!raw) {
		throw new Error("pass.json not found in .pkpass");
	}
	return JSON.parse(raw);
}

// ─── Credential fields ───────────────────────────────────────────────────────

describe("pass.json credential fields", () => {
	it("includes passTypeIdentifier, teamIdentifier, and serialNumber", async () => {
		const { pass } = await generateApplePass(
			{
				type: "loyalty",
				id: "p1",
				name: "My Pass",
				fields: [],
				apple: { icon: STUB_ICON },
			},
			{ serialNumber: "serial-001" },
			credentials
		);
		const json = await extractPassJson(pass);
		expect(json.passTypeIdentifier).toBe("pass.com.test.example");
		expect(json.teamIdentifier).toBe("ABCD1234EF");
		expect(json.serialNumber).toBe("serial-001");
		expect(json.formatVersion).toBe(1);
	});

	it("uses pass name as organizationName", async () => {
		const { pass } = await generateApplePass(
			{
				type: "loyalty",
				id: "p1",
				name: "Acme Rewards",
				fields: [],
				apple: { icon: STUB_ICON },
			},
			{ serialNumber: "s1" },
			credentials
		);
		const json = await extractPassJson(pass);
		expect(json.organizationName).toBe("Acme Rewards");
	});
});

// ─── Pass type keys ───────────────────────────────────────────────────────────

describe("pass.json type key", () => {
	it.each([
		["loyalty", "storeCard"],
		["coupon", "coupon"],
		["event", "eventTicket"],
		["flight", "boardingPass"],
		["generic", "generic"],
	])("%s pass uses the %s key", async (type, expectedKey) => {
		const base = {
			id: "p1",
			name: "Test",
			fields: [],
			apple: { icon: STUB_ICON },
		};
		const config =
			type === "flight"
				? { ...base, type: "flight" as const, transitType: "air" as const }
				: { ...base, type: type as "loyalty" | "coupon" | "event" | "generic" };

		const { pass } = await generateApplePass(
			config as Parameters<typeof generateApplePass>[0],
			{ serialNumber: "s1" },
			credentials
		);
		const json = await extractPassJson(pass);
		expect(json).toHaveProperty(expectedKey);
	});

	it("giftCard uses storeCard key", async () => {
		const { pass } = await generateApplePass(
			{
				type: "giftCard",
				id: "p1",
				name: "Gift",
				fields: [],
				apple: { icon: STUB_ICON },
			},
			{ serialNumber: "s1" },
			credentials
		);
		const json = await extractPassJson(pass);
		expect(json).toHaveProperty("storeCard");
	});
});

// ─── Colors ──────────────────────────────────────────────────────────────────

describe("pass.json colors", () => {
	it("converts backgroundColor to rgb() format", async () => {
		const { pass } = await generateApplePass(
			{
				type: "loyalty",
				id: "p1",
				name: "Test",
				fields: [],
				color: "#1a2b3c",
				apple: { icon: STUB_ICON },
			},
			{ serialNumber: "s1" },
			credentials
		);
		const json = await extractPassJson(pass);
		expect(json.backgroundColor).toBe("rgb(26, 43, 60)");
	});

	it("converts foregroundColor to rgb() format", async () => {
		const { pass } = await generateApplePass(
			{
				type: "loyalty",
				id: "p1",
				name: "Test",
				fields: [],
				apple: { icon: STUB_ICON, foregroundColor: "#ffffff" },
			},
			{ serialNumber: "s1" },
			credentials
		);
		const json = await extractPassJson(pass);
		expect(json.foregroundColor).toBe("rgb(255, 255, 255)");
	});

	it("omits backgroundColor when color is not set", async () => {
		const { pass } = await generateApplePass(
			{
				type: "loyalty",
				id: "p1",
				name: "Test",
				fields: [],
				apple: { icon: STUB_ICON },
			},
			{ serialNumber: "s1" },
			credentials
		);
		const json = await extractPassJson(pass);
		expect(json.backgroundColor).toBeUndefined();
	});
});

// ─── Barcode ─────────────────────────────────────────────────────────────────

describe("pass.json barcode", () => {
	it("includes barcode with Apple format string", async () => {
		const { pass } = await generateApplePass(
			{
				type: "loyalty",
				id: "p1",
				name: "Test",
				fields: [],
				apple: { icon: STUB_ICON },
			},
			{ serialNumber: "s1", barcode: { value: "ABC-123", format: "QR" } },
			credentials
		);
		const json = await extractPassJson(pass);
		const barcodes = json.barcodes as {
			format: string;
			message: string;
			messageEncoding: string;
		}[];
		expect(barcodes).toHaveLength(1);
		expect(barcodes.at(0)?.format).toBe("PKBarcodeFormatQR");
		expect(barcodes.at(0)?.message).toBe("ABC-123");
		expect(barcodes.at(0)?.messageEncoding).toBe("iso-8859-1");
	});

	it("uses barcode value as altText when altText is not set", async () => {
		const { pass } = await generateApplePass(
			{
				type: "loyalty",
				id: "p1",
				name: "Test",
				fields: [],
				apple: { icon: STUB_ICON },
			},
			{ serialNumber: "s1", barcode: { value: "ABC-123", format: "QR" } },
			credentials
		);
		const json = await extractPassJson(pass);
		const barcodes = json.barcodes as { altText: string }[];
		expect(barcodes.at(0)?.altText).toBe("ABC-123");
	});

	it("omits barcodes when no barcode is set", async () => {
		const { pass } = await generateApplePass(
			{
				type: "loyalty",
				id: "p1",
				name: "Test",
				fields: [],
				apple: { icon: STUB_ICON },
			},
			{ serialNumber: "s1" },
			credentials
		);
		const json = await extractPassJson(pass);
		expect(json.barcodes).toBeUndefined();
	});
});

// ─── Field slots ─────────────────────────────────────────────────────────────

describe("pass.json field slots", () => {
	it("places fields in the correct Apple slots", async () => {
		const { pass } = await generateApplePass(
			{
				type: "loyalty",
				id: "p1",
				name: "Test",
				fields: [
					{ slot: "header", key: "tier", label: "Tier", value: "Gold" },
					{ slot: "primary", key: "points", label: "Points", value: "500" },
					{ slot: "secondary", key: "member", label: "Member", value: "Jane" },
					{ slot: "back", key: "terms", label: "Terms", value: "No refunds." },
				],
				apple: { icon: STUB_ICON },
			},
			{ serialNumber: "s1" },
			credentials
		);
		const json = await extractPassJson(pass);
		const body = json.storeCard as {
			headerFields: { key: string }[];
			primaryFields: { key: string }[];
			secondaryFields: { key: string }[];
			backFields: { key: string }[];
		};

		expect(body.headerFields.map((f) => f.key)).toContain("tier");
		expect(body.primaryFields.map((f) => f.key)).toContain("points");
		expect(body.secondaryFields.map((f) => f.key)).toContain("member");
		expect(body.backFields.map((f) => f.key)).toContain("terms");
	});

	it("overrides field value with value from createConfig.values", async () => {
		const { pass } = await generateApplePass(
			{
				type: "loyalty",
				id: "p1",
				name: "Test",
				fields: [
					{ slot: "primary", key: "points", label: "Points", value: "0" },
				],
				apple: { icon: STUB_ICON },
			},
			{ serialNumber: "s1", values: { points: "750" } },
			credentials
		);
		const json = await extractPassJson(pass);
		const primary = (json.storeCard as { primaryFields: { value: string }[] })
			.primaryFields;
		expect(primary.at(0)?.value).toBe("750");
	});

	it("hides a field when its value is null in createConfig.values", async () => {
		const { pass } = await generateApplePass(
			{
				type: "loyalty",
				id: "p1",
				name: "Test",
				fields: [
					{ slot: "primary", key: "points", label: "Points", value: "0" },
				],
				apple: { icon: STUB_ICON },
			},
			{ serialNumber: "s1", values: { points: null } },
			credentials
		);
		const json = await extractPassJson(pass);
		const primary = (json.storeCard as { primaryFields: unknown[] })
			.primaryFields;
		expect(primary).toHaveLength(0);
	});
});

// ─── Apple-specific fields ───────────────────────────────────────────────────

describe("pass.json apple-specific fields", () => {
	it("sets voided from createConfig.apple.voided", async () => {
		const { pass } = await generateApplePass(
			{
				type: "loyalty",
				id: "p1",
				name: "Test",
				fields: [],
				apple: { icon: STUB_ICON },
			},
			{ serialNumber: "s1", apple: { voided: true } },
			credentials
		);
		const json = await extractPassJson(pass);
		expect(json.voided).toBe(true);
	});

	it("sets expirationDate from createConfig.expiresAt", async () => {
		const { pass } = await generateApplePass(
			{
				type: "loyalty",
				id: "p1",
				name: "Test",
				fields: [],
				apple: { icon: STUB_ICON },
			},
			{ serialNumber: "s1", expiresAt: "2025-12-31T23:59:59Z" },
			credentials
		);
		const json = await extractPassJson(pass);
		expect(json.expirationDate).toBe("2025-12-31T23:59:59Z");
	});

	it("includes boardingPass transitType for flight passes", async () => {
		const { pass } = await generateApplePass(
			{
				type: "flight",
				id: "p1",
				name: "Test",
				fields: [],
				transitType: "air",
				apple: { icon: STUB_ICON },
			},
			{ serialNumber: "s1" },
			credentials
		);
		const json = await extractPassJson(pass);
		const boardingPass = json.boardingPass as { transitType: string };
		expect(boardingPass.transitType).toBe("PKTransitTypeAir");
	});
});

// ─── .pkpass zip structure ───────────────────────────────────────────────────

describe(".pkpass zip contents", () => {
	it("contains pass.json, manifest.json, and signature", async () => {
		const { pass } = await generateApplePass(
			{
				type: "loyalty",
				id: "p1",
				name: "Test",
				fields: [],
				apple: { icon: STUB_ICON },
			},
			{ serialNumber: "s1" },
			credentials
		);
		const zip = await JSZip.loadAsync(pass);
		expect(zip.file("pass.json")).not.toBeNull();
		expect(zip.file("manifest.json")).not.toBeNull();
		expect(zip.file("signature")).not.toBeNull();
	});

	it("contains icon.png", async () => {
		const { pass } = await generateApplePass(
			{
				type: "loyalty",
				id: "p1",
				name: "Test",
				fields: [],
				apple: { icon: STUB_ICON },
			},
			{ serialNumber: "s1" },
			credentials
		);
		const zip = await JSZip.loadAsync(pass);
		expect(zip.file("icon.png")).not.toBeNull();
	});

	it("manifest.json lists SHA1 hashes for every file", async () => {
		const { pass } = await generateApplePass(
			{
				type: "loyalty",
				id: "p1",
				name: "Test",
				fields: [],
				apple: { icon: STUB_ICON },
			},
			{ serialNumber: "s1" },
			credentials
		);
		const zip = await JSZip.loadAsync(pass);
		const manifestFile = zip.file("manifest.json");
		if (!manifestFile) {
			throw new Error("manifest.json not found");
		}
		const manifest = JSON.parse(await manifestFile.async("string")) as Record<
			string,
			string
		>;

		expect(manifest["pass.json"]).toMatch(SHA1_RE);
		expect(manifest["icon.png"]).toMatch(SHA1_RE);
	});
});

// ─── Validation errors ───────────────────────────────────────────────────────

describe("generateApplePass validation", () => {
	it("throws APPLE_MISSING_ICON when apple.icon is not set", async () => {
		await expect(
			generateApplePass(
				{ type: "loyalty", id: "p1", name: "Test", fields: [] },
				{ serialNumber: "s1" },
				credentials
			)
		).rejects.toMatchObject({ code: "APPLE_MISSING_ICON" });
	});

	it("throws APPLE_BOARDING_MISSING_TRANSIT_TYPE for flight with no transitType", async () => {
		await expect(
			generateApplePass(
				{
					type: "flight",
					id: "p1",
					name: "Test",
					fields: [],
					apple: { icon: STUB_ICON },
				},
				{ serialNumber: "s1" },
				credentials
			)
		).rejects.toMatchObject({ code: "APPLE_BOARDING_MISSING_TRANSIT_TYPE" });
	});
});
