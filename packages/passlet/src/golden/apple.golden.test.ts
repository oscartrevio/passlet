/**
 * GOLDEN TESTS — Apple Wallet
 *
 * PHILOSOPHY
 * These tests encode the *vendor contract*, not passlet's current behaviour.
 * A complete `.pkpass` is built for every pass type with a self-signed cert
 * generated in-test, unzipped, and checked at the three layers Apple's
 * installer actually enforces:
 *
 *   1. pass.json — compared against an explicit golden object, written out in
 *      full so a reviewer can read the emitted payload as a diff rather than
 *      reverse-engineer it from assertions. Everything dynamic (serial numbers,
 *      pass type identifier, team id) is pinned by the fixture, so the goldens
 *      are byte-stable across runs.
 *   2. manifest.json — every archive member is listed with a SHA-1 recomputed
 *      here from the member's own bytes, and the manifest names nothing that is
 *      not in the archive.
 *   3. signature — parsed as DER PKCS#7, asserted to be a *detached* SignedData,
 *      with its messageDigest authenticated attribute equal to the SHA-1 of the
 *      manifest bytes and its signature cryptographically verified against the
 *      signer certificate. This is the check that catches a signature that is
 *      well-formed but signs the wrong thing.
 *
 * HOW TO UPDATE
 * A failure means passlet regressed or Apple changed the format. Update a
 * golden ONLY in the second case, and ONLY with the doc reference (a
 * developer.apple.com/documentation/walletpasses/* URL) in the commit message.
 * Never patch a golden to match new output just to get back to green — that
 * discards the only signal this file produces.
 */

import { createHash } from "node:crypto";
import JSZip from "jszip";
import forge from "node-forge";
import { beforeAll, describe, expect, it } from "vitest";
import { generateApplePass } from "../providers/apple/index";
import {
	generateTestCerts,
	type TestCerts,
} from "../providers/apple/test-certs";
import type { AppleCredentials } from "../types/credentials";
import type { CreateConfig, PassConfig } from "../types/schemas";

const PASS_TYPE_IDENTIFIER = "pass.com.test.example";
const TEAM_ID = "ABCD1234EF";
/** Stub PNG bytes — Apple never parses image content during manifest checks. */
const IMAGE = new Uint8Array([1, 2, 3]);
const ICON = { base: IMAGE, retina: IMAGE };

let certs: TestCerts;
let credentials: AppleCredentials;

interface Fixture {
	create: CreateConfig;
	/** Files the archive must contain, besides manifest.json and signature. */
	files: string[];
	pass: PassConfig;
	/** Full expected pass.json. */
	passJson: Record<string, unknown>;
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

const FIXTURES: Record<string, Fixture> = {
	// storeCard is Apple's loyalty layout — there is no dedicated loyalty type.
	loyalty: {
		pass: {
			type: "loyalty",
			id: "a-loyalty",
			name: "Acme Rewards",
			color: "#1a1a2e",
			apple: {
				icon: ICON,
				logo: IMAGE,
				logoText: "Acme",
				foregroundColor: "#ffffff",
				labelColor: "#cccccc",
				description: "Acme loyalty card",
			},
			locales: {
				es: { points: "Puntos", tier_value: "Oro", name: "Recompensas Acme" },
			},
			fields: [
				{ slot: "primary", key: "points", label: "Points", value: "1250" },
				{ slot: "secondary", key: "tier", label: "Tier", value: "Gold" },
				{
					slot: "back",
					key: "terms",
					label: "Terms",
					value: "No refunds.",
					// An empty array explicitly disables Apple's data detectors, so the
					// key must survive to pass.json rather than being pruned as falsy.
					dataDetectorTypes: [],
				},
			],
		},
		create: {
			serialNumber: "loyalty-001",
			barcode: { value: "LOY-1250", format: "QR" },
		},
		files: [
			"es.lproj/pass.strings",
			"icon.png",
			"icon@2x.png",
			"logo.png",
			"pass.json",
		],
		passJson: {
			formatVersion: 1,
			passTypeIdentifier: PASS_TYPE_IDENTIFIER,
			serialNumber: "loyalty-001",
			teamIdentifier: TEAM_ID,
			organizationName: "Acme Rewards",
			description: "Acme loyalty card",
			logoText: "Acme",
			// Apple's colour keys take CSS rgb() triplets, never hex.
			backgroundColor: "rgb(26, 26, 46)",
			foregroundColor: "rgb(255, 255, 255)",
			labelColor: "rgb(204, 204, 204)",
			// `barcodes` is the modern key; `barcode` is the deprecated singular
			// fallback older OS versions read, emitted only for QR/PDF417/Aztec.
			barcodes: [
				{
					message: "LOY-1250",
					format: "PKBarcodeFormatQR",
					messageEncoding: "utf-8",
				},
			],
			barcode: {
				message: "LOY-1250",
				format: "PKBarcodeFormatQR",
				messageEncoding: "utf-8",
			},
			storeCard: {
				headerFields: [],
				primaryFields: [{ key: "points", label: "Points", value: "1250" }],
				secondaryFields: [{ key: "tier", label: "Tier", value: "Gold" }],
				auxiliaryFields: [],
				backFields: [
					{
						key: "terms",
						label: "Terms",
						value: "No refunds.",
						dataDetectorTypes: [],
					},
				],
			},
		},
	},

	// Poster event ticket: eventLogoText replaces logoText, which Apple ignores
	// entirely for this style scheme.
	event: {
		pass: {
			type: "event",
			id: "a-event",
			name: "Summer Festival",
			color: "#6a0572",
			startsAt: "2026-07-15T20:00:00Z",
			endsAt: "2026-07-15T23:00:00Z",
			apple: {
				icon: ICON,
				eventLogoText: "Festival",
				preferredStyleSchemes: ["posterEventTicket"],
				logoText: "must be dropped on a poster event ticket",
				footerBackgroundColor: "#123456",
				bagPolicyURL: "https://example.com/bags",
			},
			fields: [
				{
					slot: "primary",
					key: "venue",
					label: "Venue",
					value: "Central Park",
				},
				{ slot: "auxiliary", key: "seat", label: "Seat", value: "A12", row: 0 },
				{ slot: "auxiliary", key: "row", label: "Row", value: "12", row: 1 },
			],
		},
		create: {
			serialNumber: "event-001",
			barcode: { value: "EVT-1", format: "PDF417" },
		},
		files: ["icon.png", "icon@2x.png", "pass.json"],
		passJson: {
			formatVersion: 1,
			passTypeIdentifier: PASS_TYPE_IDENTIFIER,
			serialNumber: "event-001",
			teamIdentifier: TEAM_ID,
			organizationName: "Summer Festival",
			description: "Summer Festival",
			backgroundColor: "rgb(106, 5, 114)",
			// PDF417 is not UTF-8 safe — Apple documents iso-8859-1 for it.
			barcodes: [
				{
					message: "EVT-1",
					format: "PKBarcodeFormatPDF417",
					messageEncoding: "iso-8859-1",
				},
			],
			barcode: {
				message: "EVT-1",
				format: "PKBarcodeFormatPDF417",
				messageEncoding: "iso-8859-1",
			},
			// Derived from startsAt/endsAt so the pass surfaces on the lock screen.
			relevantDates: [
				{ startDate: "2026-07-15T20:00:00Z", endDate: "2026-07-15T23:00:00Z" },
			],
			eventLogoText: "Festival",
			footerBackgroundColor: "rgb(18, 52, 86)",
			preferredStyleSchemes: ["posterEventTicket"],
			bagPolicyURL: "https://example.com/bags",
			semantics: {
				eventName: "Summer Festival",
				eventStartDate: "2026-07-15T20:00:00Z",
				eventEndDate: "2026-07-15T23:00:00Z",
				venueName: "Central Park",
				seats: [{ seatNumber: "A12", seatRow: "12" }],
			},
			eventTicket: {
				headerFields: [],
				primaryFields: [
					{ key: "venue", label: "Venue", value: "Central Park" },
				],
				secondaryFields: [],
				// `row` is an auxiliary-only key on event tickets.
				auxiliaryFields: [
					{ key: "seat", label: "Seat", value: "A12", row: 0 },
					{ key: "row", label: "Row", value: "12", row: 1 },
				],
				backFields: [],
			},
		},
	},

	// boardingPass — transitType is required and lives inside the pass-type
	// dictionary, not at the top level.
	flight: {
		pass: {
			type: "flight",
			id: "a-flight",
			name: "AA 100",
			color: "#003087",
			transitType: "air",
			carrier: "AA",
			flightNumber: "100",
			origin: "JFK",
			destination: "LAX",
			departure: "2026-07-15T08:00:00Z",
			arrival: "2026-07-15T11:30:00Z",
			apple: { icon: ICON, upgradeURL: "https://example.com/upgrade" },
			fields: [
				{ slot: "primary", key: "gate", label: "Gate", value: "B22" },
				{ slot: "secondary", key: "seat", label: "Seat", value: "14A" },
				{ slot: "auxiliary", key: "terminal", label: "Terminal", value: "4" },
			],
		},
		create: {
			serialNumber: "flight-001",
			barcode: { value: "BP-1", format: "Aztec" },
		},
		files: ["icon.png", "icon@2x.png", "pass.json"],
		passJson: {
			formatVersion: 1,
			passTypeIdentifier: PASS_TYPE_IDENTIFIER,
			serialNumber: "flight-001",
			teamIdentifier: TEAM_ID,
			organizationName: "AA 100",
			description: "AA 100",
			backgroundColor: "rgb(0, 48, 135)",
			barcodes: [
				{
					message: "BP-1",
					format: "PKBarcodeFormatAztec",
					messageEncoding: "utf-8",
				},
			],
			barcode: {
				message: "BP-1",
				format: "PKBarcodeFormatAztec",
				messageEncoding: "utf-8",
			},
			relevantDates: [
				{ startDate: "2026-07-15T08:00:00Z", endDate: "2026-07-15T11:30:00Z" },
			],
			upgradeURL: "https://example.com/upgrade",
			// Semantic tags drive flight tracking and Siri suggestions. Note
			// flightNumber is the numeric portion as a JSON number, while
			// flightCode is the carrier-prefixed string.
			semantics: {
				airlineCode: "AA",
				flightCode: "AA100",
				flightNumber: 100,
				departureAirportCode: "JFK",
				destinationAirportCode: "LAX",
				originalDepartureDate: "2026-07-15T08:00:00Z",
				originalArrivalDate: "2026-07-15T11:30:00Z",
				departureGate: "B22",
				departureTerminal: "4",
				seats: [{ seatNumber: "14A" }],
			},
			boardingPass: {
				headerFields: [],
				primaryFields: [{ key: "gate", label: "Gate", value: "B22" }],
				secondaryFields: [{ key: "seat", label: "Seat", value: "14A" }],
				auxiliaryFields: [{ key: "terminal", label: "Terminal", value: "4" }],
				backFields: [],
				transitType: "PKTransitTypeAir",
			},
		},
	},

	coupon: {
		pass: {
			type: "coupon",
			id: "a-coupon",
			name: "20% Off",
			color: "#e63946",
			redemptionChannel: "both",
			apple: { icon: ICON, strip: IMAGE },
			fields: [
				{ slot: "primary", key: "offer", label: "Offer", value: "20% off" },
				{ slot: "secondary", key: "code", label: "Code", value: "SUMMER20" },
			],
		},
		create: { serialNumber: "coupon-001", expiresAt: "2026-12-31T23:59:59Z" },
		files: ["icon.png", "icon@2x.png", "pass.json", "strip.png"],
		passJson: {
			formatVersion: 1,
			passTypeIdentifier: PASS_TYPE_IDENTIFIER,
			serialNumber: "coupon-001",
			teamIdentifier: TEAM_ID,
			organizationName: "20% Off",
			description: "20% Off",
			backgroundColor: "rgb(230, 57, 70)",
			expirationDate: "2026-12-31T23:59:59Z",
			coupon: {
				headerFields: [],
				primaryFields: [{ key: "offer", label: "Offer", value: "20% off" }],
				secondaryFields: [{ key: "code", label: "Code", value: "SUMMER20" }],
				auxiliaryFields: [],
				backFields: [],
			},
		},
	},

	// Apple has no gift-card layout — it shares storeCard with loyalty. The
	// currency is expressed per field, via currencyCode + numberStyle.
	giftCard: {
		pass: {
			type: "giftCard",
			id: "a-gift",
			name: "Store Gift Card",
			color: "#2a9d8f",
			currency: "USD",
			apple: { icon: ICON },
			fields: [
				{
					slot: "primary",
					key: "balance",
					label: "Balance",
					value: "50.00",
					currencyCode: "USD",
					numberStyle: "decimal",
				},
				{
					slot: "secondary",
					key: "issued",
					label: "Issued",
					value: "2026-01-15T00:00:00Z",
					dateStyle: "medium",
					timeStyle: "none",
					textAlignment: "right",
				},
			],
		},
		create: { serialNumber: "gift-001" },
		files: ["icon.png", "icon@2x.png", "pass.json"],
		passJson: {
			formatVersion: 1,
			passTypeIdentifier: PASS_TYPE_IDENTIFIER,
			serialNumber: "gift-001",
			teamIdentifier: TEAM_ID,
			organizationName: "Store Gift Card",
			description: "Store Gift Card",
			backgroundColor: "rgb(42, 157, 143)",
			storeCard: {
				headerFields: [],
				primaryFields: [
					{
						key: "balance",
						label: "Balance",
						value: "50.00",
						numberStyle: "PKNumberStyleDecimal",
						currencyCode: "USD",
					},
				],
				secondaryFields: [
					{
						key: "issued",
						label: "Issued",
						value: "2026-01-15T00:00:00Z",
						dateStyle: "PKDateStyleMedium",
						timeStyle: "PKDateStyleNone",
						textAlignment: "PKTextAlignmentRight",
					},
				],
				auxiliaryFields: [],
				backFields: [],
			},
		},
	},

	generic: {
		pass: {
			type: "generic",
			id: "a-generic",
			name: "Member Card",
			color: "#264653",
			apple: {
				icon: ICON,
				nfc: { message: "hello", encryptionPublicKey: "KEY" },
				sharingProhibited: true,
			},
			fields: [
				{ slot: "primary", key: "mid", label: "Member ID", value: "M-98765" },
			],
		},
		create: { serialNumber: "generic-001" },
		files: ["icon.png", "icon@2x.png", "pass.json"],
		passJson: {
			formatVersion: 1,
			passTypeIdentifier: PASS_TYPE_IDENTIFIER,
			serialNumber: "generic-001",
			teamIdentifier: TEAM_ID,
			organizationName: "Member Card",
			description: "Member Card",
			backgroundColor: "rgb(38, 70, 83)",
			sharingProhibited: true,
			// requiresAuthentication is omitted when unset rather than defaulted.
			nfc: { message: "hello", encryptionPublicKey: "KEY" },
			generic: {
				headerFields: [],
				primaryFields: [{ key: "mid", label: "Member ID", value: "M-98765" }],
				secondaryFields: [],
				auxiliaryFields: [],
				backFields: [],
			},
		},
	},
};

// ─── Archive helpers ─────────────────────────────────────────────────────────

interface Archive {
	/** Names of the real (non-directory) archive members. */
	entries: string[];
	manifest: Record<string, string>;
	manifestBytes: Uint8Array;
	passJson: Record<string, unknown>;
	/** SHA-1 of each member's bytes, recomputed here. */
	sha1: Record<string, string>;
	signature: Uint8Array;
	warnings: string[];
}

async function readArchive(fixture: Fixture): Promise<Archive> {
	const { pass, warnings } = await generateApplePass(
		fixture.pass,
		fixture.create,
		credentials
	);
	const zip = await JSZip.loadAsync(pass);

	// JSZip records implicit folder entries (es.lproj/) alongside real members;
	// Apple's manifest only covers files, so directories are filtered out.
	const entries = Object.keys(zip.files).filter(
		(name) => !zip.files[name]?.dir
	);

	const sha1: Record<string, string> = {};
	let manifestBytes: Uint8Array<ArrayBufferLike> = new Uint8Array();
	let signature: Uint8Array<ArrayBufferLike> = new Uint8Array();
	for (const name of entries) {
		const bytes = await zip.file(name)?.async("uint8array");
		if (!bytes) {
			throw new Error(`missing archive member ${name}`);
		}
		sha1[name] = createHash("sha1").update(Buffer.from(bytes)).digest("hex");
		if (name === "manifest.json") {
			manifestBytes = bytes;
		}
		if (name === "signature") {
			signature = bytes;
		}
	}

	return {
		entries,
		manifest: JSON.parse(Buffer.from(manifestBytes).toString("utf-8")),
		manifestBytes,
		passJson: JSON.parse(
			(await zip.file("pass.json")?.async("string")) ?? "null"
		),
		sha1,
		signature,
		warnings,
	};
}

const MESSAGE_DIGEST_OID = forge.pki.oids.messageDigest as string;

interface SignedData {
	authenticatedAttributes: forge.asn1.Asn1[];
	certificateCount: number;
	/** Present only when the signature is NOT detached. */
	content: unknown;
	digestAlgorithmOid: string;
	signature: string;
	type: string;
}

function parseSignature(der: Uint8Array): SignedData {
	const message = forge.pkcs7.messageFromAsn1(
		forge.asn1.fromDer(forge.util.binary.raw.encode(der))
	) as unknown as {
		certificates?: unknown[];
		rawCapture: {
			authenticatedAttributes: forge.asn1.Asn1[];
			content?: unknown;
			digestAlgorithm: string;
			signature: string;
		};
		type: string;
	};
	return {
		authenticatedAttributes: message.rawCapture.authenticatedAttributes,
		certificateCount: (message.certificates ?? []).length,
		content: message.rawCapture.content,
		digestAlgorithmOid: forge.asn1.derToOid(message.rawCapture.digestAlgorithm),
		signature: message.rawCapture.signature,
		type: message.type,
	};
}

/** Hex of the messageDigest authenticated attribute — what the signer committed to. */
function messageDigestAttribute(signed: SignedData): string {
	for (const attr of signed.authenticatedAttributes) {
		const seq = attr.value as forge.asn1.Asn1[];
		const oidNode = seq[0];
		const valueSet = seq[1];
		if (!(oidNode && valueSet)) {
			continue;
		}
		if (forge.asn1.derToOid(oidNode.value as string) !== MESSAGE_DIGEST_OID) {
			continue;
		}
		const octet = (valueSet.value as forge.asn1.Asn1[])[0];
		return forge.util.bytesToHex(octet?.value as string);
	}
	throw new Error("signature carries no messageDigest attribute");
}

/**
 * Re-serializes the authenticated attributes into the SET container defined by
 * RFC 2315 §9.3 — the exact bytes the signature covers — and verifies them
 * against the signer certificate's public key.
 */
function signatureVerifies(signed: SignedData, signerCertPem: string): boolean {
	const set = forge.asn1.create(
		forge.asn1.Class.UNIVERSAL,
		forge.asn1.Type.SET,
		true,
		signed.authenticatedAttributes.slice()
	);
	const md = forge.md.sha1.create();
	md.update(forge.asn1.toDer(set).getBytes());
	const cert = forge.pki.certificateFromPem(signerCertPem);
	const publicKey = cert.publicKey as forge.pki.rsa.PublicKey;
	return publicKey.verify(md.digest().getBytes(), signed.signature);
}

// ─── Suite ───────────────────────────────────────────────────────────────────

const archives: Record<string, Archive> = {};

beforeAll(async () => {
	certs = generateTestCerts();
	credentials = {
		passTypeIdentifier: PASS_TYPE_IDENTIFIER,
		teamId: TEAM_ID,
		signerCert: certs.signerCert,
		signerKey: certs.signerKey,
		wwdr: certs.wwdr,
	};
	for (const [name, fixture] of Object.entries(FIXTURES)) {
		archives[name] = await readArchive(fixture);
	}
}, 60_000);

const CASES = Object.entries(FIXTURES);

describe.each(CASES)("%s .pkpass", (name, fixture) => {
	it("emits exactly the expected pass.json", () => {
		expect(archives[name]?.passJson).toEqual(fixture.passJson);
	});

	it("contains exactly the expected archive members", () => {
		expect(archives[name]?.entries.sort()).toEqual(
			[...fixture.files, "manifest.json", "signature"].sort()
		);
	});

	it("lists every payload file in manifest.json with a matching SHA-1", () => {
		const archive = archives[name];
		if (!archive) {
			throw new Error(`no archive for ${name}`);
		}
		const payload = archive.entries.filter(
			(entry) => entry !== "manifest.json" && entry !== "signature"
		);

		// Recomputed hashes, not the ones the generator wrote.
		const recomputed = Object.fromEntries(
			payload.map((entry) => [entry, archive.sha1[entry]])
		);
		expect(archive.manifest).toEqual(recomputed);
	});

	it("signs the manifest with a detached PKCS#7 SignedData", () => {
		const archive = archives[name];
		if (!archive) {
			throw new Error(`no archive for ${name}`);
		}
		const signed = parseSignature(archive.signature);

		expect(signed.type).toBe(forge.pki.oids.signedData);
		// Detached: the manifest bytes are not embedded in the signature.
		expect(signed.content).toBeUndefined();
		// Signer certificate plus the WWDR intermediate.
		expect(signed.certificateCount).toBe(2);
		expect(signed.digestAlgorithmOid).toBe(forge.pki.oids.sha1);
	});

	it("commits to the manifest bytes and verifies against the signer cert", () => {
		const archive = archives[name];
		if (!archive) {
			throw new Error(`no archive for ${name}`);
		}
		const signed = parseSignature(archive.signature);

		// The signed messageDigest attribute must be the SHA-1 of manifest.json —
		// this is what makes the signature cover the whole archive.
		expect(messageDigestAttribute(signed)).toBe(
			createHash("sha1")
				.update(Buffer.from(archive.manifestBytes))
				.digest("hex")
		);
		expect(signatureVerifies(signed, certs.signerCert)).toBe(true);
	});

	it("generates without warnings", () => {
		expect(archives[name]?.warnings).toEqual([]);
	});
});

// ─── Localization ────────────────────────────────────────────────────────────
//
// Apple resolves a pass.strings entry by the LITERAL string pass.json emits, not
// by the field key. A field with key "points" and label "Points" is localized by
// an entry keyed "Points" — keying it "points" produces a file the device parses
// but never matches, so the pass silently renders untranslated.
// https://developer.apple.com/documentation/walletpasses/creating-the-source-for-a-pass

describe("localization", () => {
	it("keys pass.strings by the literal strings, never the field keys", async () => {
		const fixture = FIXTURES.loyalty;
		if (!fixture) {
			throw new Error("missing loyalty fixture");
		}
		const { pass } = await generateApplePass(
			fixture.pass,
			fixture.create,
			credentials
		);
		const zip = await JSZip.loadAsync(pass);
		const strings = await zip.file("es.lproj/pass.strings")?.async("string");

		// Golden file content, in emission order.
		expect(strings).toBe(
			[
				// "points" → the field's label
				'"Points" = "Puntos";',
				// "tier_value" → the field's rendered value
				'"Gold" = "Oro";',
				// reserved "name" → the pass name
				'"Acme Rewards" = "Recompensas Acme";',
			].join("\n")
		);

		// The field keys must never appear as lookup keys — Apple cannot match them.
		for (const key of ["points", "tier", "tier_value", "name"]) {
			expect(strings, `"${key}" must not be a pass.strings key`).not.toContain(
				`"${key}" =`
			);
		}
	});

	it("hashes the .lproj file into the manifest like any other member", () => {
		const archive = archives.loyalty;
		if (!archive) {
			throw new Error("no loyalty archive");
		}
		expect(archive.manifest["es.lproj/pass.strings"]).toBe(
			archive.sha1["es.lproj/pass.strings"]
		);
	});
});
