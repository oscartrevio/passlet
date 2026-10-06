import { describe, expect, it } from "vitest";
import { importGoogleKey } from "../../../src/google/client";
import { googleCredentials } from "../../support/google";

describe("importGoogleKey", () => {
	it("imports a PEM whether its newlines are real or literal \\n sequences", () => {
		const credentials = googleCredentials();
		expect(importGoogleKey(credentials)).toMatchObject({ type: "private" });

		// A service-account JSON pasted into a .env file keeps its "\n" escapes.
		const escaped = credentials.privateKey.replace(/\n/g, "\\n");
		expect(
			importGoogleKey(googleCredentials({ privateKey: escaped }))
		).toMatchObject({ type: "private" });
	});

	it("reports GOOGLE_INVALID_PRIVATE_KEY for a value that is not a PEM key", () => {
		expect(() =>
			importGoogleKey(googleCredentials({ privateKey: "not-a-pem\\nat-all" }))
		).toThrow(expect.objectContaining({ code: "GOOGLE_INVALID_PRIVATE_KEY" }));
	});
});
