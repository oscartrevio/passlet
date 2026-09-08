// Issues every fixture against the live Wallet API with the service account
// from .env: explicit class publication must succeed and the save JWT must name the
// object and class the API knows. Skips cleanly when GOOGLE_ISSUER_ID is absent.
import { beforeAll, describe, expect, it } from "vitest";
import { googleSaveUrl, Pass, type WalletCredentials } from "../../src/index";
import type { GoogleObjectType } from "../../src/providers/google/api";
import { type FixtureName, fixtures } from "../support/fixtures";
import { decodeJwtObject } from "../support/google";

const CASES: { name: FixtureName; objectType: GoogleObjectType }[] = [
	{ name: "loyalty", objectType: "loyaltyObject" },
	{ name: "event", objectType: "eventTicketObject" },
	{ name: "flight", objectType: "flightObject" },
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
		let credentials: WalletCredentials;
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
			const template = new Pass(pass, credentials);
			await template.publish();
			const issued = await template.create({
				...create,
				serialNumber,
			});
			const jwt = issued.google;
			if (!jwt) {
				throw new Error("no Google pass was issued");
			}
			expect(issued.warnings).toEqual([]);
			expect(decodeJwtObject(jwt, objectType)).toMatchObject({
				id: `${issuerId}.${serialNumber}`,
				classId: `${issuerId}.${pass.id}`,
			});
			expect(
				googleSaveUrl(jwt).startsWith("https://pay.google.com/gp/v/save/")
			).toBe(true);
		});

		// update/expire need an object a holder has saved to their wallet, so
		// only the idempotent delete is exercised here.
		it("deletes a never-saved object without error", async () => {
			await expect(
				new Pass(FIXTURES.generic.pass, credentials).delete("e2e-never-saved")
			).resolves.toBeUndefined();
		});
	}
);
