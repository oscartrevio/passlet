import { readFileSync } from "node:fs";
import express, {
	type NextFunction,
	type Request,
	type Response,
} from "express";
import { field, Wallet, WalletError } from "passlet";

/**
 * Passlet + Express 5.
 *
 * Run: pnpm dev   (reads .env — copy .env.example first)
 */

// ---------------------------------------------------------------------------
// Wallet setup — do this ONCE at boot, not per request.
// ---------------------------------------------------------------------------

// Apple requires an `icon`, supplied as raw bytes (Uint8Array/Buffer).
const icon = readFileSync(new URL("../assets/icon.png", import.meta.url));

const wallet = new Wallet({
	// Omit either provider entirely to ship single-platform.
	apple: {
		passTypeIdentifier: requireEnv("APPLE_PASS_TYPE_IDENTIFIER"),
		teamId: requireEnv("APPLE_TEAM_ID"),
		signerCert: requireEnv("APPLE_SIGNER_CERT"),
		signerKey: requireEnv("APPLE_SIGNER_KEY"),
		wwdr: requireEnv("APPLE_WWDR"),
	},
	google: {
		issuerId: requireEnv("GOOGLE_ISSUER_ID"),
		clientEmail: requireEnv("GOOGLE_CLIENT_EMAIL"),
		// .env stores the key with literal "\n" — restore real newlines or the
		// PKCS#8 import fails with GOOGLE_INVALID_PRIVATE_KEY.
		privateKey: requireEnv("GOOGLE_PRIVATE_KEY").replace(/\\n/g, "\n"),
		origins: ["http://localhost:3000"],
	},
});

// A reusable template, validated eagerly (throws PASS_CONFIG_INVALID at boot).
const rewardsCard = wallet.loyalty({
	id: "rewards-card",
	name: "Acme Rewards",
	color: "#1c1917",
	fields: [
		field.primary("points", "Points"), // value comes from create()
		field.secondary("tier", "Tier", "Gold"),
		field.back("terms", "Terms", "Points expire after 12 months."),
	],
	apple: { icon, foregroundColor: "#fafaf9", labelColor: "#a8a29e" },
	// Google takes hosted URLs only, and requires a logo.
	google: { logo: requireEnv("GOOGLE_LOGO_URL"), issuerName: "Acme Inc." },
});

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

const app = express();

/** GET /passes/:serial/apple — serves the signed .pkpass bytes. */
app.get("/passes/:serial/apple", async (req: Request, res: Response) => {
	const serial = req.params.serial;

	// `apple` is a Uint8Array, `google` is a JWT string; either is null when the
	// matching credentials were omitted from the Wallet.
	const { apple, warnings } = await rewardsCard.create({
		serialNumber: serial, // unique per recipient
		values: { points: "1250" }, // per-recipient field values
		barcode: { format: "QR", value: serial, altText: serial },
	});

	if (warnings.length > 0) {
		console.warn("[passlet]", warnings);
	}
	if (!apple) {
		res.status(501).send("Apple Wallet is not configured");
		return;
	}

	// Set the headers explicitly and finish with res.end(): res.send() would
	// guess a content type and may append an ETag, which some Wallet clients
	// handle poorly.
	res.setHeader("Content-Type", "application/vnd.apple.pkpass");
	res.setHeader(
		"Content-Disposition",
		`attachment; filename="${sanitize(serial)}.pkpass"`
	);
	res.setHeader("Content-Length", apple.byteLength);
	res.setHeader("Cache-Control", "no-store, private");
	res.end(Buffer.from(apple));
});

/** GET /passes/:serial/google — 302 to the Google Wallet save link. */
app.get("/passes/:serial/google", async (req: Request, res: Response) => {
	const serial = req.params.serial;

	const { google, warnings } = await rewardsCard.create({
		serialNumber: serial,
		values: { points: "1250" },
		barcode: { format: "QR", value: serial },
	});

	if (warnings.length > 0) {
		console.warn("[passlet]", warnings);
	}
	if (!google) {
		res.status(501).send("Google Wallet is not configured");
		return;
	}

	// The save URL is literally the JWT appended to Google's save endpoint.
	// The JWT is recipient-specific and short-lived, so keep it uncached.
	res.setHeader("Cache-Control", "no-store, private");
	res.redirect(302, `https://pay.google.com/gp/v/save/${google}`);
});

// Express 5 forwards rejected async handlers here automatically.
app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
	// Typed errors carry a stable `code` you can switch on.
	if (error instanceof WalletError) {
		console.error(error.code, error.message);
		res.status(500).send(`Pass generation failed: ${error.code}`);
		return;
	}
	console.error(error);
	res.status(500).send("Internal Server Error");
});

app.listen(3000, () => {
	console.log("Listening on http://localhost:3000");
	console.log("  /passes/user-123/apple");
	console.log("  /passes/user-123/google");
});

// ---------------------------------------------------------------------------

function requireEnv(name: string): string {
	const value = process.env[name];
	if (!value) {
		throw new Error(`Missing environment variable: ${name}`);
	}
	return value;
}

/** Keep the Content-Disposition filename well-formed for any serial number. */
function sanitize(value: string): string {
	return value.replace(/[^\w.-]/g, "_");
}
