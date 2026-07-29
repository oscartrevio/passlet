import { describe, expect, it } from "vitest";
import { APPLE_PASS_CONTENT_TYPE, googleSaveUrl } from "./index";

describe("APPLE_PASS_CONTENT_TYPE", () => {
	it("is the exact type iOS requires for .pkpass downloads", () => {
		expect(APPLE_PASS_CONTENT_TYPE).toBe("application/vnd.apple.pkpass");
	});
});

describe("googleSaveUrl", () => {
	it("builds the pay.google.com save link for a JWT", () => {
		expect(googleSaveUrl("header.payload.signature")).toBe(
			"https://pay.google.com/gp/v/save/header.payload.signature"
		);
	});

	it("produces a parseable https URL whose last path segment is the JWT", () => {
		const jwt = "eyJhbGciOiJSUzI1NiJ9.eyJpc3MiOiJhQGIuY29tIn0.c2ln";
		const url = new URL(googleSaveUrl(jwt));
		expect(url.protocol).toBe("https:");
		expect(url.host).toBe("pay.google.com");
		expect(url.pathname.split("/").pop()).toBe(jwt);
	});

	it("does not mangle base64url characters used by JWTs", () => {
		const jwt = "ab-_.cd-_.ef-_";
		expect(googleSaveUrl(jwt).endsWith(jwt)).toBe(true);
	});
});
