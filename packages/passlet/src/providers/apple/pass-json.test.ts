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

// ─── logoText ─────────────────────────────────────────────────────────────────

describe("pass.json logoText", () => {
	it("is omitted when not provided (not defaulted to the pass name)", async () => {
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
		expect(json.logoText).toBeUndefined();
	});

	it("is emitted when explicitly set", async () => {
		const { pass } = await generateApplePass(
			{
				type: "loyalty",
				id: "p1",
				name: "Acme Rewards",
				fields: [],
				apple: { icon: STUB_ICON, logoText: "My Brand" },
			},
			{ serialNumber: "s1" },
			credentials
		);
		const json = await extractPassJson(pass);
		expect(json.logoText).toBe("My Brand");
	});

	it("is omitted for poster event tickets even when set", async () => {
		const { pass } = await generateApplePass(
			{
				type: "event",
				id: "e1",
				name: "Festival",
				fields: [],
				apple: {
					icon: STUB_ICON,
					logoText: "Ignored",
					eventLogoText: "Festival",
				},
			},
			{ serialNumber: "s1" },
			credentials
		);
		const json = await extractPassJson(pass);
		expect(json.logoText).toBeUndefined();
	});
});

// ─── Semantic tags & relevance ───────────────────────────────────────────────

describe("pass.json semantics and relevantDates", () => {
	const FLIGHT = {
		type: "flight" as const,
		id: "f1",
		name: "AA 100",
		transitType: "air" as const,
		carrier: "AA",
		flightNumber: "100",
		origin: "JFK",
		destination: "LAX",
		departure: "2026-07-15T08:00:00Z",
		arrival: "2026-07-15T11:30:00Z",
		fields: [],
		apple: { icon: STUB_ICON },
	};

	it("emits flight semantic tags from structured flight data", async () => {
		const { pass } = await generateApplePass(
			FLIGHT,
			{ serialNumber: "s1" },
			credentials
		);
		const json = await extractPassJson(pass);
		expect(json.semantics).toEqual({
			airlineCode: "AA",
			flightCode: "AA100",
			flightNumber: 100,
			departureAirportCode: "JFK",
			destinationAirportCode: "LAX",
			originalDepartureDate: "2026-07-15T08:00:00Z",
			originalArrivalDate: "2026-07-15T11:30:00Z",
		});
	});

	it("preserves a UTC offset on flight semantic dates (Apple keeps it)", async () => {
		const { pass } = await generateApplePass(
			{
				...FLIGHT,
				departure: "2026-07-15T08:00:00+04:00",
				arrival: "2026-07-15T11:30:00+04:00",
			},
			{ serialNumber: "s1" },
			credentials
		);
		const json = await extractPassJson(pass);
		const semantics = json.semantics as Record<string, unknown>;
		expect(semantics.originalDepartureDate).toBe("2026-07-15T08:00:00+04:00");
		expect(semantics.originalArrivalDate).toBe("2026-07-15T11:30:00+04:00");
	});

	it("derives relevantDates from flight departure/arrival", async () => {
		const { pass } = await generateApplePass(
			FLIGHT,
			{ serialNumber: "s1" },
			credentials
		);
		const json = await extractPassJson(pass);
		expect(json.relevantDates).toEqual([
			{ startDate: "2026-07-15T08:00:00Z", endDate: "2026-07-15T11:30:00Z" },
		]);
	});

	it("maps gate/terminal/boarding/seat fields to flight semantics", async () => {
		const { pass } = await generateApplePass(
			{
				...FLIGHT,
				fields: [
					{ slot: "secondary", key: "gate", label: "Gate", value: "B22" },
					{ slot: "secondary", key: "terminal", label: "Terminal", value: "4" },
					{
						slot: "auxiliary",
						key: "boardingZone",
						label: "Zone",
						value: "Group 2",
					},
					{ slot: "auxiliary", key: "seat", label: "Seat", value: "14A" },
				],
			},
			{ serialNumber: "s1" },
			credentials
		);
		const json = await extractPassJson(pass);
		const semantics = json.semantics as Record<string, unknown>;
		expect(semantics.departureGate).toBe("B22");
		expect(semantics.departureTerminal).toBe("4");
		expect(semantics.boardingGroup).toBe("Group 2");
		expect(semantics.seats).toEqual([{ seatNumber: "14A" }]);
	});

	it("maps venue and seat/row/section fields to event semantics", async () => {
		const { pass } = await generateApplePass(
			{
				type: "event",
				id: "e1",
				name: "Summer Festival",
				startsAt: "2026-07-15T20:00:00Z",
				fields: [
					{
						slot: "primary",
						key: "venue",
						label: "Venue",
						value: "Central Park",
					},
					{ slot: "auxiliary", key: "section", label: "Section", value: "A" },
					{ slot: "auxiliary", key: "row", label: "Row", value: "12" },
					{ slot: "auxiliary", key: "seat", label: "Seat", value: "5" },
				],
				apple: { icon: STUB_ICON },
			},
			{ serialNumber: "s1" },
			credentials
		);
		const json = await extractPassJson(pass);
		const semantics = json.semantics as Record<string, unknown>;
		expect(semantics.venueName).toBe("Central Park");
		expect(semantics.seats).toEqual([
			{ seatNumber: "5", seatRow: "12", seatSection: "A" },
		]);
	});

	it("emits event semantic tags and derives relevantDates", async () => {
		const { pass } = await generateApplePass(
			{
				type: "event",
				id: "e1",
				name: "Summer Festival",
				startsAt: "2026-07-15T20:00:00Z",
				endsAt: "2026-07-15T23:00:00Z",
				fields: [],
				apple: { icon: STUB_ICON },
			},
			{ serialNumber: "s1" },
			credentials
		);
		const json = await extractPassJson(pass);
		expect(json.semantics).toEqual({
			eventName: "Summer Festival",
			eventStartDate: "2026-07-15T20:00:00Z",
			eventEndDate: "2026-07-15T23:00:00Z",
		});
		expect(json.relevantDates).toEqual([
			{ startDate: "2026-07-15T20:00:00Z", endDate: "2026-07-15T23:00:00Z" },
		]);
	});

	it("lets an explicit apple.relevantDates override the derived value", async () => {
		const { pass } = await generateApplePass(
			{
				type: "event",
				id: "e1",
				name: "Show",
				startsAt: "2026-07-15T20:00:00Z",
				fields: [],
				apple: {
					icon: STUB_ICON,
					relevantDates: [{ date: "2026-07-14T20:00:00Z" }],
				},
			},
			{ serialNumber: "s1" },
			credentials
		);
		const json = await extractPassJson(pass);
		expect(json.relevantDates).toEqual([{ date: "2026-07-14T20:00:00Z" }]);
	});

	it("omits semantics for pass types without structured data", async () => {
		const { pass } = await generateApplePass(
			{
				type: "loyalty",
				id: "p1",
				name: "Card",
				fields: [],
				apple: { icon: STUB_ICON },
			},
			{ serialNumber: "s1" },
			credentials
		);
		const json = await extractPassJson(pass);
		expect(json.semantics).toBeUndefined();
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

	it("throws APPLE_MISSING_AUTH_TOKEN when webServiceURL has no authenticationToken", async () => {
		await expect(
			generateApplePass(
				{
					type: "loyalty",
					id: "p1",
					name: "Test",
					fields: [],
					apple: {
						icon: STUB_ICON,
						webServiceURL: "https://example.com/passes",
					},
				},
				{ serialNumber: "s1" },
				credentials
			)
		).rejects.toMatchObject({ code: "APPLE_MISSING_AUTH_TOKEN" });
	});
});
