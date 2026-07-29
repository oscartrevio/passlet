import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { GoogleCredentials } from "../../types/credentials";
import { importGoogleKey } from "./api";

const { privateKey: pem } = generateKeyPairSync("rsa", {
	modulusLength: 2048,
	privateKeyEncoding: { type: "pkcs8", format: "pem" },
	publicKeyEncoding: { type: "spki", format: "pem" },
});

function credentials(privateKey: string): GoogleCredentials {
	return {
		clientEmail: "svc@example.iam.gserviceaccount.com",
		issuerId: "3388000000000000000",
		privateKey,
	};
}

describe("importGoogleKey", () => {
	it("imports a well-formed PKCS#8 PEM", async () => {
		await expect(importGoogleKey(credentials(pem))).resolves.toMatchObject({
			type: "private",
		});
	});

	it("imports a key whose newlines survived as literal \\n sequences", async () => {
		// What you get from `process.env.GOOGLE_PRIVATE_KEY` when the service
		// account JSON was pasted into a .env file verbatim.
		const escaped = pem.replace(/\n/g, "\\n");
		expect(escaped).toContain("\\n");
		expect(escaped).not.toContain("\n");
		await expect(importGoogleKey(credentials(escaped))).resolves.toMatchObject({
			type: "private",
		});
	});

	it("imports a key that is only partially escaped", async () => {
		const partial = pem.replace("-----\n", "-----\\n");
		await expect(importGoogleKey(credentials(partial))).resolves.toMatchObject({
			type: "private",
		});
	});

	it("still reports GOOGLE_INVALID_PRIVATE_KEY for genuinely broken keys", async () => {
		await expect(
			importGoogleKey(credentials("not-a-pem\\nat-all"))
		).rejects.toMatchObject({ code: "GOOGLE_INVALID_PRIVATE_KEY" });
	});
});
