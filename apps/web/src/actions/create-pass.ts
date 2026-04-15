"use server";

import { field, Wallet } from "passlet";
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
