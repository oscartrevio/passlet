import { generateKeyPairSync } from "node:crypto";
import JSZip from "jszip";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { generateApplePass } from "./providers/apple/index";
import {
	generateTestCerts,
	type TestCerts,
} from "./providers/apple/test-certs";
import { generateGooglePass } from "./providers/google/index";
import type { AppleCredentials, GoogleCredentials } from "./types/credentials";
import type { CreateConfig, PassConfig, PassType } from "./types/schemas";

// A single source of truth for "what each platform requires per pass type",
// driven straight off the audit's required-field matrix. If a provider ever
// stops emitting a required field, the matching row fails — the regression net
// that would have caught the gift-card cardNumber / generic header bugs.

const STUB_ICON = new Uint8Array([1, 2, 3]);
const LOGO = "https://example.com/logo.png";

// Minimal VALID config per type (all required structured props supplied).
function passFor(type: PassType): PassConfig {
	const base = {
		id: `c-${type}`,
		name: "Test Pass",
		color: "#1a1a2e",
		apple: { icon: { base: STUB_ICON, retina: STUB_ICON } },
	};
	switch (type) {
		case "loyalty":
			return {
				...base,
				type,
				google: { logo: LOGO },
				fields: [
					{ slot: "primary", key: "points", label: "Points", value: "10" },
				],
			};
		case "event":
			return {
				...base,
				type,
				startsAt: "2026-07-15T20:00:00Z",
				fields: [
					{ slot: "primary", key: "venue", label: "Venue", value: "Park" },
				],
			};
		case "flight":
			return {
				...base,
				type,
				transitType: "air",
				carrier: "AA",
				flightNumber: "100",
				origin: "JFK",
				destination: "LAX",
				departure: "2026-07-15T08:00:00Z",
				fields: [],
			};
		case "coupon":
			return {
				...base,
				type,
				redemptionChannel: "both",
				fields: [
					{ slot: "primary", key: "offer", label: "Offer", value: "10%" },
				],
			};
		case "giftCard":
			return {
				...base,
				type,
				currency: "USD",
				fields: [
					{ slot: "primary", key: "balance", label: "Balance", value: "50.00" },
				],
			};
		default:
			return {
				...base,
				type: "generic",
				fields: [{ slot: "primary", key: "id", label: "ID", value: "M-1" }],
			};
	}
}

const CREATE: CreateConfig = {
	serialNumber: "serial-001",
	barcode: { value: "ABC-123", format: "QR" },
	values: { passengerName: "Jane Doe" },
};

const ALL_TYPES: PassType[] = [
	"loyalty",
	"event",
	"flight",
	"coupon",
	"giftCard",
	"generic",
];

// ─── Apple ─────────────────────────────────────────────────────────────────────

const APPLE_TOP_LEVEL_REQUIRED = [
	"formatVersion",
	"passTypeIdentifier",
	"serialNumber",
	"teamIdentifier",
	"organizationName",
	"description",
];

const APPLE_STYLE_KEY: Record<PassType, string> = {
	loyalty: "storeCard",
	event: "eventTicket",
	flight: "boardingPass",
	coupon: "coupon",
	giftCard: "storeCard",
	generic: "generic",
};

describe("Apple required fields per type", () => {
	let credentials: AppleCredentials;

	beforeAll(() => {
		const certs: TestCerts = generateTestCerts();
		credentials = {
			passTypeIdentifier: "pass.com.test.example",
			teamId: "ABCD1234EF",
			signerCert: certs.signerCert,
			signerKey: certs.signerKey,
			wwdr: certs.wwdr,
		};
	}, 30_000);

	async function passJson(type: PassType): Promise<Record<string, unknown>> {
		const { pass } = await generateApplePass(
			passFor(type),
			CREATE,
			credentials
		);
		const zip = await JSZip.loadAsync(pass);
		return JSON.parse(
			(await zip.file("pass.json")?.async("string")) ?? "{}"
		) as Record<string, unknown>;
	}

	it.each(
		ALL_TYPES
	)("%s includes all required top-level keys + style", async (type) => {
		const json = await passJson(type);
		for (const key of APPLE_TOP_LEVEL_REQUIRED) {
			expect(json[key], `${type}.${key}`).toBeDefined();
		}
		expect(json[APPLE_STYLE_KEY[type]], `${type} style key`).toBeDefined();
	});

	it("boardingPass includes transitType", async () => {
		const json = await passJson("flight");
		expect((json.boardingPass as { transitType?: string }).transitType).toBe(
			"PKTransitTypeAir"
		);
	});
});

// ─── Google ────────────────────────────────────────────────────────────────────

const GOOGLE_CLASS_REQUIRED: Record<PassType, string[]> = {
	loyalty: ["id", "programName", "programLogo", "issuerName", "reviewStatus"],
	event: ["id", "eventName", "issuerName", "reviewStatus"],
	flight: [
		"id",
		"flightHeader",
		"origin",
		"destination",
		"localScheduledDepartureDateTime",
		"issuerName",
		"reviewStatus",
	],
	coupon: [
		"id",
		"provider",
		"title",
		"redemptionChannel",
		"issuerName",
		"reviewStatus",
	],
	giftCard: ["id", "issuerName", "reviewStatus"],
	generic: ["id"],
};

const GOOGLE_OBJECT_REQUIRED: Record<PassType, string[]> = {
	loyalty: ["id", "classId", "state"],
	event: ["id", "classId", "state"],
	flight: ["id", "classId", "state", "passengerName", "reservationInfo"],
	coupon: ["id", "classId", "state"],
	giftCard: ["id", "classId", "state", "cardNumber"],
	generic: ["id", "classId", "cardTitle", "header"],
};

const GOOGLE_CLASS_TYPE: Record<PassType, string> = {
	loyalty: "loyaltyClass",
	event: "eventTicketClass",
	flight: "flightClass",
	coupon: "offerClass",
	giftCard: "giftCardClass",
	generic: "genericClass",
};

const GOOGLE_OBJECTS_KEY: Record<PassType, string> = {
	loyalty: "loyaltyObjects",
	event: "eventTicketObjects",
	flight: "flightObjects",
	coupon: "offerObjects",
	giftCard: "giftCardObjects",
	generic: "genericObjects",
};

describe("Google required fields per type", () => {
	let credentials: GoogleCredentials;

	beforeAll(() => {
		const { privateKey } = generateKeyPairSync("rsa", {
			modulusLength: 2048,
			privateKeyEncoding: { type: "pkcs8", format: "pem" },
			publicKeyEncoding: { type: "spki", format: "pem" },
		});
		credentials = {
			issuerId: "3388000000022801234",
			clientEmail: "test@test.iam.gserviceaccount.com",
			privateKey: privateKey as string,
		};
	});

	afterEach(() => {
		vi.unstubAllGlobals?.();
		vi.restoreAllMocks();
	});

	function stubFetch() {
		vi.stubGlobal(
			"fetch",
			vi.fn((url: string, init?: RequestInit) => {
				if (url.includes("oauth2.googleapis.com")) {
					return Promise.resolve({
						ok: true,
						json: () => Promise.resolve({ access_token: "t" }),
					});
				}
				if (!init?.method || init.method === "GET") {
					return Promise.resolve({
						ok: false,
						status: 404,
						body: null,
						text: () => Promise.resolve(""),
					});
				}
				return Promise.resolve({
					ok: true,
					status: 201,
					body: null,
					text: () => Promise.resolve(""),
				});
			})
		);
	}

	function classBody(classType: string): Record<string, unknown> {
		const call = vi
			.mocked(globalThis.fetch)
			.mock.calls.find(
				([url, init]) =>
					typeof url === "string" &&
					url.includes(`/${classType}`) &&
					init?.method === "POST"
			);
		return JSON.parse((call?.[1]?.body as string) ?? "{}") as Record<
			string,
			unknown
		>;
	}

	function objectBody(jwt: string, key: string): Record<string, unknown> {
		const [, seg] = jwt.split(".");
		const outer = JSON.parse(
			Buffer.from(seg ?? "", "base64").toString("utf-8")
		) as Record<string, unknown>;
		return (
			(outer.payload as Record<string, Record<string, unknown>[]>)[key]?.[0] ??
			{}
		);
	}

	it.each(
		ALL_TYPES
	)("%s emits required class and object fields", async (type) => {
		stubFetch();
		const { pass } = await generateGooglePass(
			passFor(type),
			CREATE,
			credentials
		);
		if (!pass) {
			throw new Error("expected a JWT");
		}

		const cls = classBody(GOOGLE_CLASS_TYPE[type]);
		for (const key of GOOGLE_CLASS_REQUIRED[type]) {
			expect(cls[key], `${type} class.${key}`).toBeDefined();
		}

		const obj = objectBody(pass, GOOGLE_OBJECTS_KEY[type]);
		for (const key of GOOGLE_OBJECT_REQUIRED[type]) {
			expect(obj[key], `${type} object.${key}`).toBeDefined();
		}
	});
});
