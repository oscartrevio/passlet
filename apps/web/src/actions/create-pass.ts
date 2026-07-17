"use server";

import { headers } from "next/headers";
import { field, Wallet } from "passlet";
import { checkRateLimit, recordPassCreated } from "@/lib/rate-limit";
import type { WalletProvider } from "@/types/pass";

function requiredEnv(name: string): string {
	const value = process.env[name];
	if (!value) {
		throw new Error(`Missing environment variable: ${name}`);
	}
	return value;
}

interface CreatePassInput {
	banner?: string;
	color: string;
	memberName: string;
	memberNo: string;
	provider: WalletProvider;
	since: string;
	textColor: string;
}

interface CreatePassResult {
	appleBytes?: number[];
	googleJwt?: string;
	warnings: string[];
}

const APPLE_ICON_BASE64 =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7nWJ0AAAAASUVORK5CYII=";

const appleCredentials = {
	passTypeIdentifier: requiredEnv("APPLE_PASS_TYPE_IDENTIFIER"),
	teamId: requiredEnv("APPLE_TEAM_ID"),
	signerCert: requiredEnv("APPLE_SIGNER_CERT"),
	signerKey: requiredEnv("APPLE_SIGNER_KEY"),
	wwdr: requiredEnv("APPLE_WWDR"),
};

const googleCredentials = {
	issuerId: requiredEnv("GOOGLE_ISSUER_ID"),
	clientEmail: requiredEnv("GOOGLE_CLIENT_EMAIL"),
	privateKey: requiredEnv("GOOGLE_PRIVATE_KEY"),
};

export async function createPassAction(
	input: CreatePassInput
): Promise<CreatePassResult> {
	// Throttle by client IP so the public playground can't be scripted to spam
	// Apple signing (CPU) or the Google Wallet API (writes to the real issuer).
	const headerList = await headers();
	const ip =
		headerList.get("x-forwarded-for")?.split(",")[0]?.trim() || "anonymous";
	const allowed = await checkRateLimit(ip);
	if (!allowed) {
		throw new Error(
			"You're creating passes too quickly. Please wait a minute and try again."
		);
	}

	const wallet = new Wallet(
		input.provider === "apple"
			? { apple: appleCredentials }
			: { google: googleCredentials }
	);

	const pass = wallet.loyalty({
		id: `passlet-${input.memberNo}`,
		name: "Passlet",
		color: input.color,
		fields: [
			field.header("memberId", "ID"),
			field.secondary("member", "Member"),
			field.secondary("since", "Since"),
		],
		apple: {
			logoText: "Passlet",
			icon: Buffer.from(APPLE_ICON_BASE64, "base64"),
			strip: input.banner ? Buffer.from(input.banner, "base64") : undefined,
			foregroundColor: input.textColor,
			labelColor: input.textColor,
		},
		google: {
			logo: process.env.GOOGLE_LOGO_URL,
		},
	});

	const issued = await pass.create({
		serialNumber: `passlet-${Date.now()}`,
		values: {
			memberId: input.memberNo,
			member: input.memberName,
			since: input.since,
		},
		barcode: {
			format: "QR",
			value: "https://github.com/oscartrevio/passlet",
			altText: "",
		},
	});

	// Count this creation by member name and provider (viewable in Upstash).
	await recordPassCreated(input.memberName, input.provider);

	return {
		appleBytes:
			input.provider === "apple" && issued.apple
				? Array.from(issued.apple)
				: undefined,
		googleJwt:
			input.provider === "google" ? (issued.google ?? undefined) : undefined,
		warnings: issued.warnings,
	};
}
