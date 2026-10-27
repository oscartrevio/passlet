// A validated RSA key always signs, so a signing failure can only be forced
// by failing node:crypto's sign itself.
import { sign } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { Wallet } from "../../../src/wallet";
import { FIXTURES, walletTemplate } from "../../support/fixtures";
import { googleCredentials, stubGoogleFetch } from "../../support/google";

vi.mock("node:crypto", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:crypto")>();
	return { ...actual, sign: vi.fn(actual.sign) };
});

const { loyalty } = FIXTURES;

describe("Google signing failures", () => {
	it("normalizes an OAuth assertion signing failure before sending credentials", async () => {
		const cause = new Error("Signing unavailable");
		vi.mocked(sign).mockImplementationOnce(() => {
			throw cause;
		});
		const stub = stubGoogleFetch();
		await expect(
			walletTemplate(
				new Wallet({ google: googleCredentials() }),
				loyalty.pass
			).create(loyalty.create)
		).rejects.toMatchObject({ code: "GOOGLE_SIGNING_FAILED", cause });
		expect(stub.tokenRequests).toBe(0);
		expect(stub.requests).toEqual([]);
	});

	it("normalizes a save JWT signing failure after the object is written", async () => {
		const cause = new Error("Signing unavailable");
		const actual =
			await vi.importActual<typeof import("node:crypto")>("node:crypto");
		vi.mocked(sign)
			.mockImplementationOnce(actual.sign)
			.mockImplementationOnce(() => {
				throw cause;
			});
		const stub = stubGoogleFetch();
		await expect(
			walletTemplate(
				new Wallet({ google: googleCredentials() }),
				loyalty.pass
			).create(loyalty.create)
		).rejects.toMatchObject({ code: "GOOGLE_SIGNING_FAILED", cause });
		expect(stub.requests.map((request) => request.method)).toEqual([
			"GET",
			"POST",
			"POST",
		]);
	});
});
