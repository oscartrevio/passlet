#!/usr/bin/env tsx
/**
 * Smoke test — run with: pnpm smoke
 *
 * Creates one pass of each type using real credentials from .env.
 * Apple .pkpass files are written to scripts/out/ for manual inspection.
 * Google passes are verified by checking the returned JWT is non-empty.
 *
 * Skips a provider if its credentials are not set.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { WalletCredentials } from "../src/index";
import { field, Wallet } from "../src/index";

// ─── Credentials ────────────────────────────────────────────────────────────

const apple = process.env.APPLE_SIGNER_CERT
	? {
			passTypeIdentifier: process.env.APPLE_PASS_TYPE_IDENTIFIER ?? "",
			teamId: process.env.APPLE_TEAM_ID ?? "",
			signerCert: process.env.APPLE_SIGNER_CERT,
			signerKey: process.env.APPLE_SIGNER_KEY ?? "",
			wwdr: process.env.APPLE_WWDR ?? "",
		}
	: undefined;

const google = process.env.GOOGLE_ISSUER_ID
	? {
			issuerId: process.env.GOOGLE_ISSUER_ID,
			clientEmail: process.env.GOOGLE_CLIENT_EMAIL ?? "",
			// .env stores literal \n — unescape to real newlines
			privateKey: (process.env.GOOGLE_PRIVATE_KEY ?? "").replace(/\\n/g, "\n"),
		}
	: undefined;

if (!(apple || google)) {
	console.error("No credentials found in .env — nothing to test.");
	process.exit(1);
}

const credentials: WalletCredentials = { apple, google };
const wallet = new Wallet(credentials);

console.log(
	`\nCredentials: ${[apple && "Apple", google && "Google"].filter(Boolean).join(" + ")}\n`
);

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Minimal 1×1 white PNG — valid enough for pass generation without a real asset
const STUB_ICON = new Uint8Array([
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49,
	0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02,
	0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44,
	0x41, 0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00, 0x00, 0x00, 0x02, 0x00,
	0x01, 0xe2, 0x21, 0xbc, 0x33, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44,
	0xae, 0x42, 0x60, 0x82,
]);

const OUT_DIR = resolve(import.meta.dirname, "out");
mkdirSync(OUT_DIR, { recursive: true });

let passed = 0;
let failed = 0;

async function run(
	label: string,
	serial: string,
	passPromise: Promise<{
		apple: Uint8Array | null;
		google: string | null;
		warnings: string[];
	}>
) {
	const start = Date.now();
	process.stdout.write(`  ${label.padEnd(12)}`);
	try {
		const result = await passPromise;
		const ms = Date.now() - start;
		const parts: string[] = [];

		if (result.apple) {
			const outPath = resolve(OUT_DIR, `${serial}.pkpass`);
			writeFileSync(outPath, result.apple);
			parts.push(`Apple ${(result.apple.length / 1024).toFixed(1)}KB`);
		} else if (apple) {
			parts.push("Apple skipped");
		}

		if (result.google) {
			const url = `https://pay.google.com/gp/v/save/${result.google}`;
			const link = `\x1b]8;;${url}\x07Add to Google Wallet\x1b]8;;\x07`;
			parts.push(link);
		} else if (google) {
			parts.push("Google skipped");
		}

		if (result.warnings.length) {
			parts.push(`${result.warnings.length} warning(s)`);
		}

		console.log(`PASS  ${ms}ms  ${parts.join("  ")}`);
		passed++;
	} catch (err) {
		const ms = Date.now() - start;
		console.log(`FAIL  ${ms}ms  ${(err as Error).message}`);
		failed++;
	}
}

// ─── Pass types ───────────────────────────────────────────────────────────────

console.log("Running smoke tests...\n");

// Google loyaltyClass requires a public logo URL. If GOOGLE_LOGO_URL is not set,
// the Google provider is excluded for this pass type to avoid a 400 error.
const loyaltyCredentials =
	google && !process.env.GOOGLE_LOGO_URL ? { apple } : credentials;
await run(
	"loyalty",
	"loyalty",
	new Wallet(loyaltyCredentials)
		.loyalty({
			id: "loyalty-v2",
			name: "Rewards Card",
			color: "#1a1a2e",
			fields: [
				field.primary("points", "Points", "1250"),
				field.secondary("tier", "Tier", "Gold"),
				field.back("member", "Member", "Jane Doe"),
			],
			logo: process.env.GOOGLE_LOGO_URL,
			apple: { icon: STUB_ICON },
		})
		.create({ serialNumber: "loyalty" })
);

await run(
	"event",
	"event",
	wallet
		.event({
			id: "event-v2",
			name: "Summer Festival",
			color: "#6a0572",
			startsAt: "2026-07-15T20:00:00Z",
			endsAt: "2026-07-15T23:00:00Z",
			fields: [
				field.primary("venue", "Venue", "Central Park"),
				field.secondary("date", "Date", "Jul 15, 2026"),
				field.auxiliary("seat", "Seat", "A12"),
			],
			apple: { icon: STUB_ICON },
		})
		.create({ serialNumber: "event" })
);

await run(
	"flight",
	"flight",
	wallet
		.flight({
			id: "flight-v2",
			name: "AA 100",
			carrier: "AA",
			flightNumber: "100",
			origin: "JFK",
			destination: "LAX",
			departure: "2026-07-15T08:00:00Z",
			arrival: "2026-07-15T11:30:00Z",
			transitType: "air",
			fields: [
				field.primary("gate", "Gate", "B22"),
				field.secondary("seat", "Seat", "14A"),
			],
			apple: { icon: STUB_ICON },
		})
		.create({
			serialNumber: "flight",
			values: { passengerName: "Jane Doe" },
		})
);

await run(
	"coupon",
	"coupon",
	wallet
		.coupon({
			id: "coupon-v2",
			name: "20% Off",
			color: "#e63946",
			redemptionChannel: "both",
			fields: [
				field.primary("offer", "Offer", "20% off your next order"),
				field.secondary("code", "Code", "SUMMER20"),
				field.back("expires", "Expires", "Dec 31, 2026"),
			],
			apple: { icon: STUB_ICON },
		})
		.create({ serialNumber: "coupon" })
);

await run(
	"giftCard",
	"gift",
	wallet
		.giftCard({
			id: "giftcard-v2",
			name: "Store Gift Card",
			color: "#2a9d8f",
			currency: "USD",
			fields: [
				field.primary("balance", "Balance", "$50.00"),
				field.secondary("pin", "PIN", "1234"),
			],
			apple: { icon: STUB_ICON },
		})
		.create({ serialNumber: "gift" })
);

await run(
	"generic",
	"generic",
	wallet
		.generic({
			id: "generic-v2",
			name: "Member Card",
			color: "#264653",
			fields: [
				field.primary("id", "Member ID", "M-98765"),
				field.secondary("name", "Name", "Jane Doe"),
				field.back("since", "Member Since", "2024"),
			],
			apple: { icon: STUB_ICON },
		})
		.create({ serialNumber: "generic" })
);

// ─── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n${passed + failed} tests  ${passed} passed  ${failed} failed`);

if (apple) {
	console.log("\nApple .pkpass files written to: scripts/out/");
}

if (failed > 0) {
	process.exit(1);
}
