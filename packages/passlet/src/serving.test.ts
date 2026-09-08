import { describe, expect, it } from "vitest";
import { APPLE_PASS_CONTENT_TYPE, googleSaveUrl } from "./index";

describe("APPLE_PASS_CONTENT_TYPE", () => {
	it("is the exact type iOS requires for .pkpass downloads", () => {
		expect(APPLE_PASS_CONTENT_TYPE).toBe("application/vnd.apple.pkpass");
	});
});

describe("googleSaveUrl", () => {
	it("builds the pay.google.com save link for a JWT", () => {
		expect(googleSaveUrl("ab-_.cd-_.ef-_")).toBe(
			"https://pay.google.com/gp/v/save/ab-_.cd-_.ef-_"
		);
	});
});
