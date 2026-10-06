// Issues every fixture against the live Wallet API with the service account
// from .env: explicit class publication must succeed and the save JWT must name the
// object and class the API knows. Skips cleanly when GOOGLE_ISSUER_ID is absent.
import { beforeAll, describe, expect, it } from "vitest";
import type { GoogleObjectType } from "../../src/google/client";
import { googleSaveUrl, Wallet, type WalletConfig } from "../../src/index";
import {
	type FixtureName,
	fixtures,
	walletTemplate,
} from "../support/fixtures";
import { decodeJwt, decodeJwtObject } from "../support/google";

const CASES: { name: FixtureName; objectType: GoogleObjectType }[] = [
	{ name: "loyalty", objectType: "loyaltyObject" },
	{ name: "eventTicket", objectType: "eventTicketObject" },
	{ name: "boardingPass", objectType: "flightObject" },
	{ name: "transit", objectType: "transitObject" },
	{ name: "coupon", objectType: "offerObject" },
	{ name: "giftCard", objectType: "giftCardObject" },
	{ name: "generic", objectType: "genericObject" },
];

function requireEnv(name: string): string {
	const value = process.env[name];
	if (!value) {
		throw new Error(`${name} is not set`);
	}
	return value;
}

describe.skipIf(!process.env.GOOGLE_ISSUER_ID)(
	"Google Wallet against the live API",
	() => {
		// Google fetches class logos, so a public URL from .env replaces the
		// example.com placeholder when one is configured.
		const FIXTURES = fixtures({ logo: process.env.GOOGLE_LOGO_URL });
		let credentials: WalletConfig;
		let issuerId: string;

		beforeAll(() => {
			issuerId = requireEnv("GOOGLE_ISSUER_ID");
			credentials = {
				google: {
					issuerId,
					clientEmail: requireEnv("GOOGLE_CLIENT_EMAIL"),
					privateKey: requireEnv("GOOGLE_PRIVATE_KEY"),
				},
			};
		});

		it.each(
			CASES
		)("$name: publishes the class and signs a save JWT for its $objectType", async ({
			name,
			objectType,
		}) => {
			const { pass, create } = FIXTURES[name];
			const serialNumber = `e2e-${create.serialNumber}`;
			const template = walletTemplate(new Wallet(credentials), pass);
			await template.publish();
			const issued = await template.create({
				...create,
				serialNumber,
			});
			const jwt = issued.google;
			if (!jwt) {
				throw new Error("no Google pass was issued");
			}
			expect(decodeJwtObject(jwt, objectType)).toMatchObject({
				id: `${issuerId}.${serialNumber}`,
				classId: `${issuerId}.${pass.id}`,
			});
			expect(
				googleSaveUrl(jwt).startsWith("https://pay.google.com/gp/v/save/")
			).toBe(true);
		});

		it("createBundle writes two objects of different templates and signs one JWT naming both", async () => {
			const wallet = new Wallet(credentials);
			const { eventTicket, boardingPass } = FIXTURES;
			const { google: jwt } = await wallet.createBundle([
				{
					template: walletTemplate(wallet, eventTicket.pass),
					content: {
						...eventTicket.create,
						serialNumber: "e2e-many-event",
						group: "e2e-many",
					},
				},
				{
					template: walletTemplate(wallet, boardingPass.pass),
					content: {
						...boardingPass.create,
						serialNumber: "e2e-many-flight",
						group: "e2e-many",
					},
				},
			]);
			if (!jwt) {
				throw new Error("no Google pass was issued");
			}
			expect(decodeJwt(jwt).claims.payload).toEqual({
				eventTicketObjects: [
					{
						id: `${issuerId}.e2e-many-event`,
						classId: `${issuerId}.${eventTicket.pass.id}`,
					},
				],
				flightObjects: [
					{
						id: `${issuerId}.e2e-many-flight`,
						classId: `${issuerId}.${boardingPass.pass.id}`,
					},
				],
			});
		});
	}
);
