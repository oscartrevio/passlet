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

const wallet = new Wallet({
	apple: {
		passTypeIdentifier: process.env.APPLE_PASS_TYPE_IDENTIFIER!,
		teamId: process.env.APPLE_TEAM_ID!,
		signerCert: process.env.APPLE_SIGNER_CERT!,
		signerKey: process.env.APPLE_SIGNER_KEY!,
		wwdr: process.env.APPLE_WWDR!,
	},
	google: {
		issuerId: process.env.GOOGLE_ISSUER_ID!,
		clientEmail: process.env.GOOGLE_CLIENT_EMAIL!,
		privateKey: process.env.GOOGLE_PRIVATE_KEY!,
	},
});

export async function createPassAction(
	input: CreatePassInput
): Promise<CreatePassResult> {
	try {
		const pass = wallet.loyalty({
			id: "passlet-playground",
			name: "Passlet",
			color: input.color,
			banner: input.banner ? Buffer.from(input.banner, "base64") : undefined,
			fields: [
				field.header("memberId", "No.", input.memberNo),
				field.secondary("member", "Member", input.memberName),
				field.secondary("since", "Issued On", input.since),
			],
			apple: {
				icon: Buffer.from(APPLE_ICON_BASE64, "base64"),
				foregroundColor: input.textColor,
				labelColor: input.textColor,
			},
		});

		const issued = await pass.create({
			serialNumber: `passlet-${Date.now()}`,
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
