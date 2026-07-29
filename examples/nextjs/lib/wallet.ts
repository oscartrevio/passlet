import { readFileSync } from "node:fs";
import { join } from "node:path";
import { field, Wallet } from "passlet";

/**
 * A single, module-scoped Wallet instance.
 *
 * Credentials are secrets: this file must only ever be imported from server
 * code (route handlers, server actions, server components) — never from a
 * "use client" module.
 */

// Apple images are raw bytes. `icon` is REQUIRED for every Apple pass; without
// it `create()` throws WalletError("APPLE_MISSING_ICON").
const icon = readFileSync(join(process.cwd(), "assets/icon.png"));

// Both providers are optional. Omit one and Passlet simply returns `null` for
// it in the create() result, so you can ship Google-only or Apple-only.
export const wallet = new Wallet({
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
		// Service-account keys are stored with literal "\n" escapes in .env —
		// restore real newlines or the PKCS#8 import fails with
		// WalletError("GOOGLE_INVALID_PRIVATE_KEY").
		privateKey: requireEnv("GOOGLE_PRIVATE_KEY").replace(/\\n/g, "\n"),
		// Domains that embed the "Add to Google Wallet" button.
		origins: ["http://localhost:3000"],
	},
});

/**
 * A pass config is a reusable TEMPLATE — build it once and issue it to many
 * recipients with `create()`. It is validated eagerly, so a bad config throws
 * WalletError("PASS_CONFIG_INVALID") at import time rather than per request.
 */
export const rewardsCard = wallet.loyalty({
	id: "rewards-card",
	name: "Acme Rewards",
	color: "#1c1917",
	fields: [
		// No value here — supplied per recipient via `values` in create().
		field.primary("points", "Points"),
		field.secondary("tier", "Tier", "Gold"),
		field.back("terms", "Terms", "Points expire after 12 months."),
	],
	apple: { icon, foregroundColor: "#fafaf9", labelColor: "#a8a29e" },
	// Google only accepts hosted image URLs — binary uploads are not supported.
	// A `logo` is REQUIRED, otherwise create() throws GOOGLE_MISSING_LOGO.
	google: { logo: requireEnv("GOOGLE_LOGO_URL"), issuerName: "Acme Inc." },
});

function requireEnv(name: string): string {
	const value = process.env[name];
	if (!value) {
		throw new Error(`Missing environment variable: ${name}`);
	}
	return value;
}
