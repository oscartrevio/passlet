import { describe, expect, it } from "vitest";
import { importGoogleKey } from "../../../src/providers/google/api";
import { googleCredentials } from "../../support/google";

describe("importGoogleKey", () => {
	it("imports a PKCS#8 PEM whether its newlines are real or literal \\n sequences", async () => {
		const credentials = googleCredentials();
		await expect(importGoogleKey(credentials)).resolves.toMatchObject({
			type: "private",
		});

		// A service-account JSON pasted into a .env file keeps its "\n" escapes.
		const escaped = credentials.privateKey.replace(/\n/g, "\\n");
		await expect(
			importGoogleKey(googleCredentials({ privateKey: escaped }))
		).resolves.toMatchObject({ type: "private" });
	});

	it("reports GOOGLE_INVALID_PRIVATE_KEY for a key that is not PKCS#8", async () => {
		await expect(
			importGoogleKey(googleCredentials({ privateKey: "not-a-pem\\nat-all" }))
		).rejects.toMatchObject({ code: "GOOGLE_INVALID_PRIVATE_KEY" });
	});
});
