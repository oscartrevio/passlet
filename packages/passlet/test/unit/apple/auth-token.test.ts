import { describe, expect, it } from "vitest";
import { appleAuthTokens } from "../../../src/apple/auth-token";

const SECRET = "test-secret-that-is-at-least-32-characters";
const OTHER_SECRET = "another-secret-that-is-also-32-characters";
const PASS_TYPE = "pass.com.example.loyalty";
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;

const tokens = appleAuthTokens(SECRET, PASS_TYPE);

describe("issue", () => {
	// Issued passes embed this token and Apple forbids changing it, so the
	// derivation must never change. Computed independently with openssl.
	it("matches the frozen vector", () => {
		expect(tokens.issue("SN-001")).toBe(
			"Ea82gIoWdtsV7NOlffobJKGW-M-re58Y5SvuHD_lwmM"
		);
	});

	it("differs per serial number, pass type, and secret", () => {
		const token = tokens.issue("SN-001");
		expect(tokens.issue("SN-002")).not.toBe(token);
		expect(
			appleAuthTokens(SECRET, "pass.com.example.other").issue("SN-001")
		).not.toBe(token);
		expect(appleAuthTokens(OTHER_SECRET, PASS_TYPE).issue("SN-001")).not.toBe(
			token
		);
	});

	it("keeps the fields apart, so shifting the separator changes the token", () => {
		expect(appleAuthTokens(SECRET, "pass.a").issue("b.c")).not.toBe(
			appleAuthTokens(SECRET, "pass.a.b").issue("c")
		);
	});

	it("is 43 URL-safe characters, safe in pass.json and headers", () => {
		expect(tokens.issue("SN-001")).toMatch(TOKEN_SHAPE);
	});
});

describe("verifies", () => {
	it("accepts the pass's own token", () => {
		expect(tokens.verifies("SN-001", tokens.issue("SN-001"))).toBe(true);
	});

	it("rejects another pass's token", () => {
		expect(tokens.verifies("SN-001", tokens.issue("SN-002"))).toBe(false);
	});

	it("rejects a token derived from another secret", () => {
		expect(
			tokens.verifies(
				"SN-001",
				appleAuthTokens(OTHER_SECRET, PASS_TYPE).issue("SN-001")
			)
		).toBe(false);
	});

	it("rejects tokens of the wrong length without throwing", () => {
		const token = tokens.issue("SN-001");
		for (const candidate of [
			"",
			token.slice(0, -1),
			`${token}A`,
			"é".repeat(43),
		]) {
			expect(tokens.verifies("SN-001", candidate)).toBe(false);
		}
	});
});
