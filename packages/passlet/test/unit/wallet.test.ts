import { afterEach, describe, expect, it, vi } from "vitest";
import { AppleProvider } from "../../src/apple/index";
import type {
	AppleCredentials,
	AppleWebService,
	PassRegistrations,
	PassTemplate,
} from "../../src/index";
import { Wallet } from "../../src/wallet";
import {
	appleCredentials,
	appleWebService,
	ICON,
	memoryRegistrations,
	PASS_TYPE_IDENTIFIER,
	TEAM_ID,
} from "../support/apple";
import {
	existingClasses,
	googleCredentials,
	LOGO_URL,
	stubGoogleFetch,
} from "../support/google";

const SECRET = "s".repeat(32);

const registrations: PassRegistrations = {
	add: () => Promise.resolve(true),
	devices: () => Promise.resolve([]),
	remove: () => Promise.resolve(),
	serialNumbers: () => Promise.resolve([]),
};

function webService(overrides: Partial<AppleWebService> = {}): AppleWebService {
	return {
		url: "https://example.com/wallet",
		secret: SECRET,
		registrations,
		...overrides,
	};
}

function appleWith(
	service: AppleWebService,
	apple: AppleCredentials = appleCredentials()
): AppleCredentials {
	return { ...apple, webService: service };
}

const load = () => null;

describe("apple.webService validation", () => {
	it.each([
		["a relative url", webService({ url: "/wallet" })],
		["a non-http url", webService({ url: "ftp://example.com/wallet" })],
		["no secret", webService({ secret: undefined as unknown as string })],
		["a short secret", webService({ secret: "too-short" })],
	])("rejects %s with APPLE_WEB_SERVICE_INVALID", (_, service) => {
		expect(() => new Wallet({ apple: appleWith(service), load })).toThrow(
			expect.objectContaining({ code: "APPLE_WEB_SERVICE_INVALID" })
		);
	});

	it("never puts a secret in the error", () => {
		const short = "leaky-secret";
		expect(
			() =>
				new Wallet({
					apple: appleWith(webService({ secret: short })),
					load,
				})
		).toThrow(
			expect.objectContaining({ message: expect.not.stringContaining(short) })
		);
	});

	// APNs authenticates with the private key over TLS, which an external
	// signer never hands over.
	it("requires push credentials with an external signer", () => {
		const { signerCert, wwdr } = appleCredentials();
		const signed: AppleCredentials = {
			passTypeIdentifier: PASS_TYPE_IDENTIFIER,
			teamId: TEAM_ID,
			signerCert,
			wwdr,
			signer: { sign: () => new Uint8Array() },
		};
		expect(
			() => new Wallet({ apple: appleWith(webService(), signed), load })
		).toThrow(expect.objectContaining({ code: "APPLE_WEB_SERVICE_INVALID" }));
		expect(
			() =>
				new Wallet({
					apple: appleWith(
						webService({ push: { cert: "cert", key: "key" } }),
						signed
					),
					load,
				})
		).not.toThrow();
	});

	it("requires load, which the web service renders passes from", () => {
		expect(() => new Wallet({ apple: appleWith(webService()) })).toThrow(
			expect.objectContaining({ code: "UPDATES_NOT_CONFIGURED" })
		);
	});

	it("accepts an http url for development", () => {
		expect(
			() =>
				new Wallet({
					apple: appleWith(webService({ url: "http://localhost:3000/wallet" })),
					load,
				})
		).not.toThrow();
	});
});

describe("wallet.handler", () => {
	it("answers 404 to everything without apple.webService", async () => {
		const { handler } = new Wallet({ apple: appleCredentials() });
		const response = await handler(
			new Request("https://example.com/wallet/v1/log", {
				method: "POST",
				body: JSON.stringify({ logs: ["x"] }),
			})
		);
		expect(response.status).toBe(404);
	});
});

describe("wallet.update", () => {
	it("needs load", async () => {
		await expect(new Wallet({}).update("serial-001")).rejects.toMatchObject({
			code: "UPDATES_NOT_CONFIGURED",
		});
	});

	it("reports a pass load cannot find", async () => {
		await expect(
			new Wallet({ load }).update("serial-001")
		).rejects.toMatchObject({ code: "PASS_NOT_FOUND", status: 404 });
	});

	// Google may already have applied its write; `results` is how the caller
	// tells, so a failing storage must not lose it.
	it("carries both outcomes when the registrations storage fails", async () => {
		stubGoogleFetch(existingClasses);
		const failure = new Error("registrations unavailable");
		const registrations = memoryRegistrations();
		registrations.devices = () => Promise.reject(failure);
		let template: PassTemplate | undefined;
		const wallet = new Wallet({
			apple: {
				...appleCredentials(),
				webService: appleWebService({ registrations }),
			},
			google: googleCredentials(),
			load: () =>
				template ? { template, content: {}, updatedAt: new Date() } : null,
		});
		template = wallet.loyalty({
			id: "rewards",
			name: "Rewards",
			apple: { icon: ICON },
			google: { logo: LOGO_URL },
		});

		await expect(wallet.update("serial-001")).rejects.toMatchObject({
			code: "APPLE_REGISTRATIONS_FAILED",
			cause: failure,
			results: {
				apple: { status: "rejected" },
				google: { status: "fulfilled", value: "updated" },
			},
		});
	});
});

describe("templates built by another Wallet", () => {
	// Built without credentials, so no Apple requirement was checked.
	const unchecked = () =>
		new Wallet({}).boardingPass({
			id: "flight",
			name: "Flight",
			apple: { icon: ICON },
		});

	it("are checked against this Wallet's providers when load returns one", async () => {
		const wallet = new Wallet({
			apple: appleCredentials(),
			load: () => ({
				template: unchecked(),
				content: {},
				updatedAt: new Date(),
			}),
		});
		await expect(wallet.update("serial-001")).rejects.toMatchObject({
			code: "APPLE_BOARDING_MISSING_TRANSIT_TYPE",
		});
	});

	it("are checked against this Wallet's providers in a bundle", async () => {
		const wallet = new Wallet({ apple: appleCredentials() });
		await expect(
			wallet.createBundle([
				{ template: unchecked(), content: { serialNumber: "serial-001" } },
			])
		).rejects.toMatchObject({ code: "APPLE_BOARDING_MISSING_TRANSIT_TYPE" });
	});

	it("are accepted once they pass", async () => {
		const foreign = new Wallet({}).generic({ id: "member", name: "Member" });
		await expect(
			new Wallet({}).createBundle([
				{ template: foreign, content: { serialNumber: "serial-001" } },
			])
		).resolves.toEqual({ apple: null, google: null });
	});
});

describe("template checks", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("run once per Wallet however often the template is used", async () => {
		const check = vi.spyOn(AppleProvider.prototype, "checkTemplate");
		let template: PassTemplate | undefined;
		const wallet = new Wallet({
			apple: appleCredentials(),
			load: () =>
				template ? { template, content: {}, updatedAt: new Date() } : null,
		});
		template = wallet.generic({
			id: "member",
			name: "Member",
			apple: { icon: ICON },
		});
		await template.create({ serialNumber: "serial-001" });
		await wallet.createBundle([
			{ template, content: { serialNumber: "serial-002" } },
		]);
		await wallet.update("serial-001");
		expect(check).toHaveBeenCalledTimes(1);
	});
});
