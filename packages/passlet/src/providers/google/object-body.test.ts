import { generateKeyPairSync } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { GoogleCredentials } from "../../types/credentials";
import { generateGooglePass } from "./index";

// ─── Fixtures ────────────────────────────────────────────────────────────────

let credentials: GoogleCredentials;

beforeAll(() => {
	// generateKeyPairSync is synchronous and fast enough for test setup.
	const { privateKey } = generateKeyPairSync("rsa", {
		modulusLength: 2048,
		privateKeyEncoding: { type: "pkcs8", format: "pem" },
	});
	credentials = {
		issuerId: "3388000000022801234",
		clientEmail: "test@test-project.iam.gserviceaccount.com",
		privateKey: privateKey as string,
	};
});

// Stub fetch: OAuth token endpoint returns a fake token;
// all Google Wallet API calls return 201 Created.
afterEach(() => {
	vi.unstubAllGlobals();
});

function stubFetch() {
	vi.stubGlobal(
		"fetch",
		vi.fn().mockImplementation((url: string) => {
			if (url.includes("oauth2.googleapis.com")) {
				return Promise.resolve({
					ok: true,
					json: () => Promise.resolve({ access_token: "test-token" }),
				});
			}
			return Promise.resolve({
				ok: true,
				status: 201,
				text: () => Promise.resolve(""),
			});
		})
	);
}

/** Decode a JWT payload without verification — just for asserting structure. */
function decodePayload(jwt: string): Record<string, unknown> {
	const [, payload] = jwt.split(".");
	const padded = payload.replace(/-/g, "+").replace(/_/g, "/");
	return JSON.parse(Buffer.from(padded, "base64").toString("utf-8"));
}

async function generate(
	passConfig: Parameters<typeof generateGooglePass>[0],
	createConfig: Parameters<typeof generateGooglePass>[1]
) {
	stubFetch();
	const { pass, warnings } = await generateGooglePass(
		passConfig,
		createConfig,
		credentials
	);
	if (!pass) {
		throw new Error("expected a JWT");
	}
	return { payload: decodePayload(pass), warnings };
}

// ─── JWT structure ────────────────────────────────────────────────────────────

describe("JWT structure", () => {
	it("includes iss, aud, typ, iat, and payload", async () => {
		const { payload } = await generate(
			{ type: "loyalty", id: "test-pass", name: "Rewards", fields: [] },
			{ serialNumber: "s1" }
		);
		expect(payload.iss).toBe(credentials.clientEmail);
		expect(payload.aud).toBe("google");
		expect(payload.typ).toBe("savetowallet");
		expect(typeof payload.iat).toBe("number");
		expect(payload.payload).toBeDefined();
	});

	it("uses the pluralised object type key in the payload", async () => {
		const { payload } = await generate(
			{ type: "loyalty", id: "test-pass", name: "Rewards", fields: [] },
			{ serialNumber: "s1" }
		);
		const inner = payload.payload as Record<string, unknown>;
		expect(inner).toHaveProperty("loyaltyObjects");
	});
});

// ─── Object body: shared fields ───────────────────────────────────────────────

describe("object body: shared fields", () => {
	it("sets id and classId from issuerId", async () => {
		const { payload } = await generate(
			{ type: "loyalty", id: "my-pass", name: "Rewards", fields: [] },
			{ serialNumber: "serial-001" }
		);
		const obj = (
			(payload.payload as Record<string, unknown>).loyaltyObjects as Record<
				string,
				unknown
			>[]
		)[0];

		expect(obj.id).toBe(`${credentials.issuerId}.serial-001`);
		expect(obj.classId).toBe(`${credentials.issuerId}.my-pass`);
		expect(obj.state).toBe("ACTIVE");
	});

	it("includes barcode with Google type string", async () => {
		const { payload } = await generate(
			{ type: "generic", id: "p1", name: "Pass", fields: [] },
			{ serialNumber: "s1", barcode: { value: "ABC-123", format: "QR" } }
		);
		const obj = (
			(payload.payload as Record<string, unknown>).genericObjects as Record<
				string,
				unknown
			>[]
		)[0];

		const barcode = obj.barcode as Record<string, unknown>;
		expect(barcode.type).toBe("QR_CODE");
		expect(barcode.value).toBe("ABC-123");
	});

	it("omits barcode when not set", async () => {
		const { payload } = await generate(
			{ type: "generic", id: "p1", name: "Pass", fields: [] },
			{ serialNumber: "s1" }
		);
		const obj = (
			(payload.payload as Record<string, unknown>).genericObjects as Record<
				string,
				unknown
			>[]
		)[0];
		expect(obj.barcode).toBeUndefined();
	});

	it("includes validTimeInterval when validFrom and expiresAt are set", async () => {
		const { payload } = await generate(
			{ type: "generic", id: "p1", name: "Pass", fields: [] },
			{
				serialNumber: "s1",
				validFrom: "2024-01-01T00:00:00Z",
				expiresAt: "2025-01-01T00:00:00Z",
			}
		);
		const obj = (
			(payload.payload as Record<string, unknown>).genericObjects as Record<
				string,
				unknown
			>[]
		)[0];

		const interval = obj.validTimeInterval as Record<string, unknown>;
		expect((interval.start as Record<string, unknown>).date).toBe(
			"2024-01-01T00:00:00Z"
		);
		expect((interval.end as Record<string, unknown>).date).toBe(
			"2025-01-01T00:00:00Z"
		);
	});

	it("omits validTimeInterval when neither validFrom nor expiresAt are set", async () => {
		const { payload } = await generate(
			{ type: "generic", id: "p1", name: "Pass", fields: [] },
			{ serialNumber: "s1" }
		);
		const obj = (
			(payload.payload as Record<string, unknown>).genericObjects as Record<
				string,
				unknown
			>[]
		)[0];
		expect(obj.validTimeInterval).toBeUndefined();
	});
});

// ─── Object body: display fields ─────────────────────────────────────────────

describe("object body: display fields", () => {
	it("maps primary field to header and subheader", async () => {
		const { payload } = await generate(
			{
				type: "loyalty",
				id: "p1",
				name: "Rewards",
				fields: [
					{ slot: "primary", key: "points", label: "Points", value: "500" },
				],
			},
			{ serialNumber: "s1" }
		);
		const obj = (
			(payload.payload as Record<string, unknown>).loyaltyObjects as Record<
				string,
				unknown
			>[]
		)[0];

		expect(obj.header).toMatchObject({ defaultValue: { value: "500" } });
		expect(obj.subheader).toMatchObject({ defaultValue: { value: "Points" } });
	});

	it("puts non-primary fields in textModulesData", async () => {
		const { payload } = await generate(
			{
				type: "loyalty",
				id: "p1",
				name: "Rewards",
				fields: [
					{ slot: "secondary", key: "member", label: "Member", value: "Jane" },
					{ slot: "auxiliary", key: "tier", label: "Tier", value: "Gold" },
				],
			},
			{ serialNumber: "s1" }
		);
		const obj = (
			(payload.payload as Record<string, unknown>).loyaltyObjects as Record<
				string,
				unknown
			>[]
		)[0];
		const modules = obj.textModulesData as Record<string, unknown>[];

		expect(modules.find((m) => m.id === "member")).toMatchObject({
			header: "Member",
			body: "Jane",
		});
		expect(modules.find((m) => m.id === "tier")).toMatchObject({
			header: "Tier",
			body: "Gold",
		});
	});

	it("puts back fields in infoModuleData", async () => {
		const { payload } = await generate(
			{
				type: "loyalty",
				id: "p1",
				name: "Rewards",
				fields: [
					{ slot: "back", key: "terms", label: "Terms", value: "No refunds." },
				],
			},
			{ serialNumber: "s1" }
		);
		const obj = (
			(payload.payload as Record<string, unknown>).loyaltyObjects as Record<
				string,
				unknown
			>[]
		)[0];
		const info = obj.infoModuleData as Record<string, unknown>;
		const rows = info.labelValueRows as Record<string, unknown>[];

		expect(rows[0].columns).toMatchObject([
			{ label: "Terms", value: "No refunds." },
		]);
	});

	it("overrides field value with createConfig.values", async () => {
		const { payload } = await generate(
			{
				type: "loyalty",
				id: "p1",
				name: "Rewards",
				fields: [
					{ slot: "primary", key: "points", label: "Points", value: "0" },
				],
			},
			{ serialNumber: "s1", values: { points: "1500" } }
		);
		const obj = (
			(payload.payload as Record<string, unknown>).loyaltyObjects as Record<
				string,
				unknown
			>[]
		)[0];
		expect(obj.header).toMatchObject({ defaultValue: { value: "1500" } });
	});

	it("hides a field when its value is null in createConfig.values", async () => {
		const { payload } = await generate(
			{
				type: "loyalty",
				id: "p1",
				name: "Rewards",
				fields: [
					{ slot: "secondary", key: "member", label: "Member", value: "Jane" },
				],
			},
			{ serialNumber: "s1", values: { member: null } }
		);
		const obj = (
			(payload.payload as Record<string, unknown>).loyaltyObjects as Record<
				string,
				unknown
			>[]
		)[0];
		expect(obj.textModulesData).toBeUndefined();
	});
});

// ─── Object body: loyalty fields ─────────────────────────────────────────────

describe("object body: loyalty fields", () => {
	it("maps points → loyaltyPoints, member → accountName, memberId → accountId", async () => {
		const { payload } = await generate(
			{
				type: "loyalty",
				id: "p1",
				name: "Rewards",
				fields: [
					{ slot: "primary", key: "points", label: "Points", value: "500" },
					{ slot: "secondary", key: "member", label: "Member", value: "Jane" },
					{ slot: "secondary", key: "memberId", label: "ID", value: "12345" },
				],
			},
			{ serialNumber: "s1" }
		);
		const obj = (
			(payload.payload as Record<string, unknown>).loyaltyObjects as Record<
				string,
				unknown
			>[]
		)[0];

		expect(obj.loyaltyPoints).toMatchObject({ balance: { string: "500" } });
		expect(obj.accountName).toBe("Jane");
		expect(obj.accountId).toBe("12345");
	});
});

// ─── Object body: flight fields ──────────────────────────────────────────────

describe("object body: flight fields", () => {
	it("puts passengerName and reservationInfo on the object", async () => {
		const { payload } = await generate(
			{
				type: "flight",
				id: "p1",
				name: "Flight",
				fields: [],
				carrier: "AA",
				flightNumber: "100",
				origin: "JFK",
				destination: "LAX",
				departure: "2024-06-01T08:00:00Z",
				arrival: "2024-06-01T11:30:00Z",
			},
			{ serialNumber: "s1", values: { passengerName: "John Doe" } }
		);
		const obj = (
			(payload.payload as Record<string, unknown>).flightObjects as Record<
				string,
				unknown
			>[]
		)[0];

		expect(obj.passengerName).toBe("John Doe");
		expect(obj.reservationInfo).toMatchObject({ confirmationCode: "s1" });
		// flightHeader, origin, and destination are class-level — not on the object
		expect(obj.flightHeader).toBeUndefined();
	});

	it("puts flightHeader, origin, and destination on the class", async () => {
		await generate(
			{
				type: "flight",
				id: "p1",
				name: "Flight",
				fields: [],
				carrier: "AA",
				flightNumber: "100",
				origin: "JFK",
				destination: "LAX",
				departure: "2024-06-01T08:00:00Z",
				arrival: "2024-06-01T11:30:00Z",
			},
			{ serialNumber: "s1", values: { passengerName: "John Doe" } }
		);

		const fetchMock = vi.mocked(globalThis.fetch);
		const classCall = fetchMock.mock.calls.find(
			([url]) => typeof url === "string" && url.includes("flightClass")
		);
		expect(classCall).toBeDefined();
		const classBody = JSON.parse(classCall?.[1]?.body as string) as Record<
			string,
			unknown
		>;

		expect(classBody.flightHeader).toMatchObject({
			carrier: { carrierIataCode: "AA" },
			flightNumber: "100",
		});
		expect((classBody.origin as Record<string, unknown>).airportIataCode).toBe(
			"JFK"
		);
		expect(classBody.localScheduledDepartureDateTime as string).toBe(
			"2024-06-01T08:00:00"
		);
		expect(
			(classBody.destination as Record<string, unknown>).airportIataCode
		).toBe("LAX");
	});

	it("adds a warning when passengerName is missing", async () => {
		const { warnings } = await generate(
			{
				type: "flight",
				id: "p1",
				name: "Flight",
				fields: [],
				carrier: "AA",
				flightNumber: "100",
				origin: "JFK",
				destination: "LAX",
			},
			{ serialNumber: "s1" }
		);
		expect(warnings.some((w) => w.includes("passengerName"))).toBe(true);
	});
});
