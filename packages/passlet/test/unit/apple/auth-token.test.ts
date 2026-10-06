import { describe, expect, it } from "vitest";
import {
	appleAuthToken,
	isAppleAuthToken,
} from "../../../src/apple/auth-token";

const SECRET = "test-secret-that-is-at-least-32-characters";
const OTHER_SECRET = "another-secret-that-is-also-32-characters";
const PASS_TYPE = "pass.com.example.loyalty";
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;

describe("appleAuthToken", () => {
	// Issued passes embed this token and Apple forbids changing it, so the
	// derivation must never change. Computed independently with openssl.
	it("matches the frozen vector", () => {
		expect(appleAuthToken(SECRET, PASS_TYPE, "SN-001")).toBe(
			"Ea82gIoWdtsV7NOlffobJKGW-M-re58Y5SvuHD_lwmM"
		);
	});

	it("differs per serial number, pass type, and secret", () => {
		const token = appleAuthToken(SECRET, PASS_TYPE, "SN-001");
		expect(appleAuthToken(SECRET, PASS_TYPE, "SN-002")).not.toBe(token);
		expect(appleAuthToken(SECRET, "pass.com.example.other", "SN-001")).not.toBe(
			token
		);
		expect(appleAuthToken(OTHER_SECRET, PASS_TYPE, "SN-001")).not.toBe(token);
	});

	it("keeps the fields apart, so shifting the separator changes the token", () => {
		expect(appleAuthToken(SECRET, "pass.a", "b.c")).not.toBe(
			appleAuthToken(SECRET, "pass.a.b", "c")
		);
	});

	it("is 43 URL-safe characters, safe in pass.json and headers", () => {
		expect(appleAuthToken(SECRET, PASS_TYPE, "SN-001")).toMatch(TOKEN_SHAPE);
	});
});

describe("isAppleAuthToken", () => {
	it("accepts the pass's own token", () => {
		expect(
			isAppleAuthToken(
				SECRET,
				PASS_TYPE,
				"SN-001",
				appleAuthToken(SECRET, PASS_TYPE, "SN-001")
			)
		).toBe(true);
	});

	it("rejects another pass's token", () => {
		expect(
			isAppleAuthToken(
				SECRET,
				PASS_TYPE,
				"SN-001",
				appleAuthToken(SECRET, PASS_TYPE, "SN-002")
			)
		).toBe(false);
	});

	it("rejects a token from another secret", () => {
		expect(
			isAppleAuthToken(
				SECRET,
				PASS_TYPE,
				"SN-001",
				appleAuthToken(OTHER_SECRET, PASS_TYPE, "SN-001")
			)
		).toBe(false);
	});

	it("rejects tokens of the wrong length without throwing", () => {
		const token = appleAuthToken(SECRET, PASS_TYPE, "SN-001");
		for (const candidate of [
			"",
			token.slice(0, -1),
			`${token}A`,
			"é".repeat(43),
		]) {
			expect(isAppleAuthToken(SECRET, PASS_TYPE, "SN-001", candidate)).toBe(
				false
			);
		}
	});
});
