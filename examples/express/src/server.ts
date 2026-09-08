import { readFileSync } from "node:fs";
import express, {
	type NextFunction,
	type Request,
	type Response,
} from "express";
import {
	APPLE_PASS_CONTENT_TYPE,
	field,
	googleSaveUrl,
	Wallet,
	WalletError,
} from "passlet";

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
		privateKey: requireEnv("GOOGLE_PRIVATE_KEY"),
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

const app = express();

app.get("/passes/:serial/apple", async (req: Request, res: Response) => {
	const serial = req.params.serial;

	const { apple, warnings } = await rewardsCard.create({
		serialNumber: serial,
		values: { points: "1250" },
		barcode: { format: "QR", value: serial, altText: serial },
	});

	if (warnings.length > 0) {
		console.warn("[passlet]", warnings);
	}
	if (!apple) {
		res.status(501).send("Apple Wallet is not configured");
		return;
	}

	// res.end() preserves the explicit headers without adding an ETag.
	res.setHeader("Content-Type", APPLE_PASS_CONTENT_TYPE);
	res.setHeader(
		"Content-Disposition",
		`attachment; filename="${sanitize(serial)}.pkpass"`
	);
	res.setHeader("Content-Length", apple.byteLength);
	res.setHeader("Cache-Control", "no-store, private");
	res.end(Buffer.from(apple));
});

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

	// Save links are recipient-specific; keep the redirect uncached.
	res.setHeader("Cache-Control", "no-store, private");
	res.redirect(302, googleSaveUrl(google));
});

// Express 5 forwards rejected async handlers here automatically.
app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
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
