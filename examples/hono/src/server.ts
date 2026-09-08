import { readFileSync } from "node:fs";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import {
	APPLE_PASS_CONTENT_TYPE,
	field,
	googleSaveUrl,
	Wallet,
	WalletError,
} from "passlet";

// Use the Node adapter; Apple pass signing requires node:crypto.
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

const app = new Hono();

app.get("/passes/:serial/apple", async (c) => {
	const serial = c.req.param("serial");

	const { apple, warnings } = await rewardsCard.create({
		serialNumber: serial,
		values: { points: "1250" },
		barcode: { format: "QR", value: serial, altText: serial },
	});

	if (warnings.length > 0) {
		console.warn("[passlet]", warnings);
	}
	if (!apple) {
		return c.text("Apple Wallet is not configured", 501);
	}

	return new Response(apple, {
		headers: {
			// iOS Safari only triggers the "Add Pass" sheet for this exact type.
			"Content-Type": APPLE_PASS_CONTENT_TYPE,
			"Content-Disposition": `attachment; filename="${sanitize(serial)}.pkpass"`,
			"Content-Length": String(apple.byteLength),
			"Cache-Control": "no-store, private",
		},
	});
});

app.get("/passes/:serial/google", async (c) => {
	const serial = c.req.param("serial");

	const { google, warnings } = await rewardsCard.create({
		serialNumber: serial,
		values: { points: "1250" },
		barcode: { format: "QR", value: serial },
	});

	if (warnings.length > 0) {
		console.warn("[passlet]", warnings);
	}
	if (!google) {
		return c.text("Google Wallet is not configured", 501);
	}

	// Save links are recipient-specific; keep the redirect uncached.
	return new Response(null, {
		status: 302,
		headers: {
			Location: googleSaveUrl(google),
			"Cache-Control": "no-store, private",
		},
	});
});

app.onError((error, c) => {
	if (error instanceof WalletError) {
		console.error(error.code, error.message);
		return c.text(`Pass generation failed: ${error.code}`, 500);
	}
	console.error(error);
	return c.text("Internal Server Error", 500);
});

serve({ fetch: app.fetch, port: 3000 }, (info) => {
	console.log(`Listening on http://localhost:${info.port}`);
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
