import { readFileSync } from "node:fs";
import { join } from "node:path";
import { field, Wallet } from "passlet";

// Server-only: signing credentials must never enter a client bundle.
const icon = readFileSync(join(process.cwd(), "assets/icon.png"));

// Omit either provider to issue passes for only one platform.
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
		privateKey: requireEnv("GOOGLE_PRIVATE_KEY"),
		// Domains that embed the "Add to Google Wallet" button.
		origins: ["http://localhost:3000"],
	},
});

// Reuse the template across recipients; configuration is validated at construction.
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
	// Google requires a hosted logo URL.
	google: { logo: requireEnv("GOOGLE_LOGO_URL"), issuerName: "Acme Inc." },
});

function requireEnv(name: string): string {
	const value = process.env[name];
	if (!value) {
		throw new Error(`Missing environment variable: ${name}`);
	}
	return value;
}
