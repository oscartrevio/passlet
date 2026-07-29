import { readFileSync } from "node:fs";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { field, Wallet, WalletError } from "passlet";

/**
 * Passlet + Hono on the Node adapter.
 *
 * Passlet signs .pkpass archives with node-forge/jszip, so it needs a Node-like
 * runtime with `node:crypto`. It does not run on Cloudflare Workers' edge
 * runtime unless `nodejs_compat` is enabled.
 *
 * Run: pnpm dev   (reads .env — copy .env.example first)
 */

// ---------------------------------------------------------------------------
// Wallet setup — do this ONCE at boot, not per request.
// ---------------------------------------------------------------------------

// Apple requires an `icon`; it is raw bytes (Uint8Array/Buffer).
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

const app = new Hono();

/** GET /passes/:serial/apple — serves the signed .pkpass bytes. */
app.get("/passes/:serial/apple", async (c) => {
	const serial = c.req.param("serial");

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
		return c.text("Apple Wallet is not configured", 501);
	}

	// Returning a raw Response keeps full control over the headers. `c.body()`
	// works too, but the exact Content-Type below is non-negotiable.
	return new Response(apple, {
		headers: {
			// iOS Safari only triggers the "Add Pass" sheet for this exact type.
			"Content-Type": "application/vnd.apple.pkpass",
			"Content-Disposition": `attachment; filename="${sanitize(serial)}.pkpass"`,
			"Content-Length": String(apple.byteLength),
			"Cache-Control": "no-store, private",
		},
	});
});

/** GET /passes/:serial/google — 302 to the Google Wallet save link. */
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

	// The save URL is literally the JWT appended to Google's save endpoint.
	// (`c.redirect(url, 302)` is equivalent — this form makes the no-store
	// header, which matters for a recipient-specific JWT, explicit.)
	return new Response(null, {
		status: 302,
		headers: {
			Location: `https://pay.google.com/gp/v/save/${google}`,
			"Cache-Control": "no-store, private",
		},
	});
});

// Typed errors carry a stable `code` you can switch on.
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
