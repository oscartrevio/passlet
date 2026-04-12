/** biome-ignore-all lint/style/noNonNullAssertion: <> */
"use server";

import { field, Wallet } from "passlet";

export interface CreatePassInput {
	banner?: string;
	color: string;
	memberName: string;
	memberNo: string;
	provider: "apple" | "google";
	since: string;
	textColor: string;
}

export interface CreatePassResult {
	appleBytes?: number[];
	error?: string;
	googleJwt?: string;
	warnings: string[];
}

const APPLE_ICON_BASE64 =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7nWJ0AAAAASUVORK5CYII=";

const appleCredentials = {
	passTypeIdentifier: process.env.APPLE_PASS_TYPE_IDENTIFIER!,
	teamId: process.env.APPLE_TEAM_ID!,
	signerCert: process.env.APPLE_SIGNER_CERT!,
	signerKey: process.env.APPLE_SIGNER_KEY!,
	wwdr: process.env.APPLE_WWDR!,
};

const googleCredentials = {
	issuerId: process.env.GOOGLE_ISSUER_ID!,
	clientEmail: process.env.GOOGLE_CLIENT_EMAIL!,
	privateKey: process.env.GOOGLE_PRIVATE_KEY!,
};

export async function createPassAction(
	input: CreatePassInput
): Promise<CreatePassResult> {
	try {
		const wallet = new Wallet(
			input.provider === "apple"
				? { apple: appleCredentials }
				: { google: googleCredentials }
		);

		const pass = wallet.loyalty({
			id: `passlet-${input.memberNo}`,
			name: "Passlet",
			color: input.color,
			logo:
				input.provider === "google" ? process.env.GOOGLE_LOGO_URL : undefined,
			banner: input.banner ? Buffer.from(input.banner, "base64") : undefined,
			fields: [
				field.header("memberId", "ID"),
				field.secondary("member", "Member"),
				field.secondary("since", "Issued On"),
			],
			apple: {
				icon: Buffer.from(APPLE_ICON_BASE64, "base64"),
				foregroundColor: input.textColor,
				labelColor: input.textColor,
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
	} catch (error) {
		return {
			warnings: [],
			error: error instanceof Error ? error.message : "Failed to create pass.",
		};
	}
}
