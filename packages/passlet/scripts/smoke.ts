/** biome-ignore-all lint/style/noNonNullAssertion: env vars are validated by smoke test setup */

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { field, Wallet } from "../src/index";

// Credentials — omit a provider to skip it entirely
const apple = process.env.APPLE_SIGNER_CERT
	? {
			passTypeIdentifier: process.env.APPLE_PASS_TYPE_IDENTIFIER!,
			teamId: process.env.APPLE_TEAM_ID!,
			signerCert: process.env.APPLE_SIGNER_CERT,
			signerKey: process.env.APPLE_SIGNER_KEY!,
			wwdr: process.env.APPLE_WWDR!,
		}
	: undefined;

const google = process.env.GOOGLE_ISSUER_ID
	? {
			issuerId: process.env.GOOGLE_ISSUER_ID,
			clientEmail: process.env.GOOGLE_CLIENT_EMAIL!,
			privateKey: process.env.GOOGLE_PRIVATE_KEY!,
		}
	: undefined;

if (!(apple || google)) {
	console.error(
		"No credentials found in .env — set APPLE_SIGNER_CERT or GOOGLE_ISSUER_ID."
	);
	process.exit(1);
}

const wallet = new Wallet({ apple, google });

console.log(
	`Credentials: ${[apple && "Apple", google && "Google"].filter(Boolean).join(" + ")}\n`
);

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
	process.stdout.write(`  ${label.padEnd(28)}`);
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
			parts.push(`⚠ ${result.warnings.join(", ")}`);
		}

		console.log(`PASS  ${ms}ms  ${parts.join("  ")}`);
		passed++;
	} catch (err) {
		const ms = Date.now() - start;
		console.log(`FAIL  ${ms}ms  ${(err as Error).message}`);
		failed++;
	}
}

async function runUpdate(label: string, updatePromise: Promise<void>) {
	const start = Date.now();
	process.stdout.write(`  ${label.padEnd(28)}`);
	try {
		await updatePromise;
		console.log(`PASS  ${Date.now() - start}ms`);
		passed++;
	} catch (err) {
		const msg = (err as Error).message;
		// Google objects only exist after a user saves the JWT — PATCH/expire will 404
		// until then. Mark as SKIP rather than FAIL so the suite stays green.
		if (msg.includes("404")) {
			console.log(
				`SKIP  ${Date.now() - start}ms  object not yet saved to a wallet`
			);
		} else {
			console.log(`FAIL  ${Date.now() - start}ms  ${msg}`);
			failed++;
		}
	}
}

function section(title: string) {
	console.log(`\n${title}`);
	console.log("─".repeat(title.length));
}

// ─── All pass types ───────────────────────────────────────────────────────────

section("Pass types");

await run(
	"loyalty",
	"loyalty",
	wallet
		.loyalty({
			id: "smoke-loyalty",
			name: "Rewards Card",
			color: "#1a1a2e",
			fields: [
				field.primary("points", "Points", "1250"),
				field.secondary("tier", "Tier", "Gold"),
				field.back("member", "Member", "Jane Doe"),
			],
			apple: { icon: STUB_ICON },
			google: { logo: process.env.GOOGLE_LOGO_URL },
		})
		.create({ serialNumber: "smoke-loyalty" })
);

await run(
	"event",
	"event",
	wallet
		.event({
			id: "smoke-event",
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
		.create({ serialNumber: "smoke-event" })
);

await run(
	"flight (air)",
	"flight-air",
	wallet
		.flight({
			id: "smoke-flight",
			name: "AA 100",
			carrier: "AA",
			flightNumber: "100",
			origin: "JFK",
			destination: "LAX",
			departure: "2026-07-15T08:00:00Z",
			arrival: "2026-07-15T11:30:00Z",
			transitType: "air",
			fields: [
				// Apple boarding pass: primary = departure (left) / arrival (right) of transit icon
				field.primary("from", "JFK", "New York"),
				field.primary("to", "LAX", "Los Angeles"),
				field.header("date", "Date", "Jul 15"),
				field.secondary("passenger", "Passenger", "Jane Doe"),
				field.secondary("gate", "Gate", "B22"),
				field.auxiliary("seat", "Seat", "14A"),
				field.auxiliary("class", "Class", "Economy"),
				field.back("boarding", "Boarding", "7:30 AM"),
				field.back("departs", "Departs", "8:00 AM"),
			],
			apple: { icon: STUB_ICON },
		})
		.create({ serialNumber: "smoke-flight-air" })
);

await run(
	"coupon",
	"coupon",
	wallet
		.coupon({
			id: "smoke-coupon",
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
		.create({ serialNumber: "smoke-coupon" })
);

await run(
	"giftCard",
	"giftcard",
	wallet
		.giftCard({
			id: "smoke-giftcard",
			name: "Store Gift Card",
			color: "#2a9d8f",
			currency: "USD",
			fields: [
				field.primary("balance", "Balance", "50.00"),
				field.secondary("pin", "PIN", "1234"),
			],
			apple: { icon: STUB_ICON },
		})
		.create({ serialNumber: "smoke-giftcard" })
);

await run(
	"generic",
	"generic",
	wallet
		.generic({
			id: "smoke-generic",
			name: "Member Card",
			color: "#264653",
			fields: [
				field.primary("id", "Member ID", "M-98765"),
				field.secondary("name", "Name", "Jane Doe"),
				field.back("since", "Member Since", "2024"),
			],
			apple: { icon: STUB_ICON },
		})
		.create({ serialNumber: "smoke-generic" })
);

// ─── Barcode formats ──────────────────────────────────────────────────────────

section("Barcode formats");

for (const format of ["QR", "PDF417", "Aztec", "Code128"] as const) {
	await run(
		format,
		`barcode-${format.toLowerCase()}`,
		wallet
			.generic({
				id: "smoke-barcode",
				name: "Barcode Test",
				fields: [],
				apple: { icon: STUB_ICON },
			})
			.create({
				serialNumber: `smoke-barcode-${format.toLowerCase()}`,
				barcode: { format, value: "TEST-BARCODE-123" },
			})
	);
}

// ─── Field behaviors ──────────────────────────────────────────────────────────

section("Field behaviors");

await run(
	"all slot types",
	"fields-all-slots",
	wallet
		.generic({
			id: "smoke-fields",
			name: "Field Slots",
			fields: [
				field.header("tier", "Tier", "Gold"),
				field.primary("points", "Points", "500"),
				field.secondary("member", "Member", "Jane"),
				field.auxiliary("expires", "Expires", "Dec 31"),
				field.back("terms", "Terms", "No refunds."),
			],
			apple: { icon: STUB_ICON },
		})
		.create({ serialNumber: "smoke-fields-all-slots" })
);

await run(
	"values override at create",
	"fields-override",
	wallet
		.loyalty({
			id: "smoke-override",
			name: "Override Test",
			fields: [
				field.primary("points", "Points", "0"),
				field.secondary("tier", "Tier", "Bronze"),
			],
			apple: { icon: STUB_ICON },
			google: { logo: process.env.GOOGLE_LOGO_URL },
		})
		.create({
			serialNumber: "smoke-fields-override",
			values: { points: "9999", tier: "Platinum" },
		})
);

await run(
	"null hides field",
	"fields-null",
	wallet
		.loyalty({
			id: "smoke-null",
			name: "Null Test",
			fields: [
				field.primary("points", "Points", "100"),
				field.secondary("tier", "Tier", "Gold"),
			],
			apple: { icon: STUB_ICON },
			google: { logo: process.env.GOOGLE_LOGO_URL },
		})
		.create({
			serialNumber: "smoke-fields-null",
			values: { tier: null },
		})
);

// ─── Apple-specific options ───────────────────────────────────────────────────

section("Apple-specific options");

await run(
	"foreground + label colors",
	"apple-colors",
	wallet
		.loyalty({
			id: "smoke-apple-colors",
			name: "Color Test",
			color: "#1a1a2e",
			fields: [field.primary("points", "Points", "500")],
			apple: {
				icon: STUB_ICON,
				foregroundColor: "#ffffff",
				labelColor: "#aaaaaa",
			},
			google: { logo: process.env.GOOGLE_LOGO_URL },
		})
		.create({ serialNumber: "smoke-apple-colors" })
);

await run(
	"description + logoText",
	"apple-text",
	wallet
		.loyalty({
			id: "smoke-apple-text",
			name: "Text Test",
			fields: [],
			apple: {
				icon: STUB_ICON,
				description: "Custom pass description",
				logoText: "My Brand",
			},
			google: { logo: process.env.GOOGLE_LOGO_URL },
		})
		.create({ serialNumber: "smoke-apple-text" })
);

await run(
	"voided",
	"apple-voided",
	wallet
		.generic({
			id: "smoke-voided",
			name: "Voided Pass",
			fields: [field.primary("status", "Status", "Cancelled")],
			apple: { icon: STUB_ICON },
		})
		.create({
			serialNumber: "smoke-apple-voided",
			apple: { voided: true },
		})
);

await run(
	"expiresAt",
	"apple-expires",
	wallet
		.generic({
			id: "smoke-expires",
			name: "Expiry Test",
			fields: [],
			apple: { icon: STUB_ICON },
		})
		.create({
			serialNumber: "smoke-apple-expires",
			expiresAt: "2026-12-31T23:59:59Z",
		})
);

await run(
	"flight (train transitType)",
	"flight-train",
	wallet
		.flight({
			id: "smoke-train",
			name: "Eurostar",
			carrier: "ES",
			flightNumber: "9001",
			origin: "LHR",
			destination: "CDG",
			departure: "2026-08-01T09:00:00Z",
			transitType: "train",
			fields: [
				field.primary("car", "Car", "5"),
				field.secondary("seat", "Seat", "23A"),
			],
			apple: { icon: STUB_ICON },
		})
		.create({
			serialNumber: "smoke-flight-train",
			values: { passengerName: "John Smith" },
		})
);

// ─── Google-specific options ──────────────────────────────────────────────────

section("Google-specific options");

await run(
	"class-level messages",
	"google-messages",
	wallet
		.loyalty({
			id: "smoke-google-messages",
			name: "Messages Test",
			fields: [field.primary("points", "Points", "500")],
			apple: { icon: STUB_ICON },
			google: {
				logo: process.env.GOOGLE_LOGO_URL,
				messages: [
					{
						header: "Welcome back!",
						body: "You have new rewards waiting.",
						messageType: "TEXT",
					},
				],
				reviewStatus: "DRAFT",
			},
		})
		.create({ serialNumber: "smoke-google-messages" })
);

await run(
	"per-recipient messages",
	"google-obj-messages",
	wallet
		.loyalty({
			id: "smoke-google-obj-msg",
			name: "Object Messages",
			fields: [field.primary("points", "Points", "200")],
			apple: { icon: STUB_ICON },
			google: { logo: process.env.GOOGLE_LOGO_URL },
		})
		.create({
			serialNumber: "smoke-google-obj-messages",
			google: {
				messages: [
					{
						header: "Just for you",
						body: "Double points this weekend!",
						messageType: "TEXT_AND_NOTIFY",
					},
				],
			},
		})
);

await run(
	"validFrom + expiresAt",
	"google-interval",
	wallet
		.coupon({
			id: "smoke-google-interval",
			name: "Timed Coupon",
			redemptionChannel: "both",
			fields: [field.primary("offer", "Offer", "10% off")],
			apple: { icon: STUB_ICON },
		})
		.create({
			serialNumber: "smoke-google-interval",
			validFrom: "2026-01-01T00:00:00Z",
			expiresAt: "2026-12-31T23:59:59Z",
		})
);

await run(
	"coupon (online-only channel)",
	"coupon-online",
	wallet
		.coupon({
			id: "smoke-coupon-online",
			name: "Online Only",
			redemptionChannel: "online",
			fields: [field.primary("code", "Code", "ONLINE10")],
			apple: { icon: STUB_ICON },
		})
		.create({ serialNumber: "smoke-coupon-online" })
);

await run(
	"coupon (instore-only channel)",
	"coupon-instore",
	wallet
		.coupon({
			id: "smoke-coupon-instore",
			name: "In-Store Only",
			redemptionChannel: "instore",
			fields: [field.primary("code", "Code", "STORE10")],
			apple: { icon: STUB_ICON },
		})
		.create({ serialNumber: "smoke-coupon-instore" })
);

// ─── Pass lifecycle (Google only) ─────────────────────────────────────────────

if (google) {
	section("Pass lifecycle (Google)");

	const lifecyclePass = wallet.loyalty({
		id: "smoke-lifecycle",
		name: "Lifecycle Test",
		fields: [field.primary("points", "Points", "100")],
		apple: { icon: STUB_ICON },
		google: { logo: process.env.GOOGLE_LOGO_URL },
	});

	await run(
		"create",
		"lifecycle-create",
		lifecyclePass.create({ serialNumber: "smoke-lifecycle" })
	);

	await runUpdate(
		"update (new points value)",
		lifecyclePass.update({
			serialNumber: "smoke-lifecycle",
			values: { points: "500" },
		})
	);

	await runUpdate("expire", lifecyclePass.expire("smoke-lifecycle"));
}

// ─── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n${passed + failed} tests  ${passed} passed  ${failed} failed`);

if (apple) {
	console.log("\nApple .pkpass files written to: scripts/out/");
}

if (failed > 0) {
	process.exit(1);
}
