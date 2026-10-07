import { beforeAll, describe, expect, it, vi } from "vitest";
import type { ApnsOptions } from "../../../src/apple/apns";
import { type ApnsSender, AppleProvider } from "../../../src/apple/index";
import { WalletError } from "../../../src/errors";
import {
	type AppleCredentials,
	type LoyaltyTemplateConfig,
	Wallet,
} from "../../../src/index";
import {
	appleCredentials,
	issueApplePass,
	memoryRegistrations,
	PASS_TYPE_IDENTIFIER,
	type Pkpass,
	PNG,
	parseSignature,
	readPkpass,
} from "../../support/apple";
import { generateTestCerts, generateTestWwdr } from "../../support/certs";
import { FIXTURES, type FixtureName } from "../../support/fixtures";

// Payload members per fixture; manifest.json and signature are always added.
const MEMBERS: Record<FixtureName, string[]> = {
	loyalty: [
		"es.lproj/pass.strings",
		"icon.png",
		"icon@2x.png",
		"logo.png",
		"pass.json",
	],
	eventTicket: ["icon.png", "icon@2x.png", "pass.json"],
	boardingPass: ["icon.png", "icon@2x.png", "pass.json"],
	transit: ["icon.png", "icon@2x.png", "pass.json"],
	coupon: ["icon.png", "icon@2x.png", "pass.json", "strip.png"],
	giftCard: ["icon.png", "icon@2x.png", "pass.json"],
	generic: ["icon.png", "icon@2x.png", "pass.json"],
};

// id-sha256: the digest an in-memory signing key signs with.
const SHA256_OID = "2.16.840.1.101.3.4.2.1";

const NAMES = Object.keys(FIXTURES) as FixtureName[];
const archives = {} as Record<FixtureName, Pkpass>;
let credentials: AppleCredentials & { signerKey: string };

beforeAll(async () => {
	credentials = appleCredentials();
	await Promise.all(
		NAMES.map(async (name) => {
			const { pass, create } = FIXTURES[name];
			archives[name] = await readPkpass(
				await issueApplePass(pass, create, credentials)
			);
		})
	);
});

describe.each(NAMES)("%s .pkpass", (name) => {
	it("contains exactly the expected members", () => {
		expect(archives[name].entries).toEqual(
			[...MEMBERS[name], "manifest.json", "signature"].sort()
		);
	});

	it("lists every payload member in manifest.json with its SHA-1 and nothing else", () => {
		const { entries, manifest, sha1 } = archives[name];
		const payload = entries.filter(
			(entry) => entry !== "manifest.json" && entry !== "signature"
		);
		expect(manifest).toEqual(
			Object.fromEntries(payload.map((entry) => [entry, sha1[entry]]))
		);
	});
});

describe("signature", () => {
	it("is a detached PKCS#7 over manifest.json that verifies against the signer cert", () => {
		const { manifestSha256, signature } = archives.loyalty;
		const signed = parseSignature(signature);

		expect(signed).toMatchObject({
			certificateCount: 2,
			detached: true,
			digestAlgorithmOid: SHA256_OID,
			messageDigestHex: manifestSha256,
		});
		expect(signed.verifies(credentials.signerCert)).toBe(true);
	});
});

describe("localization", () => {
	// Apple matches localized strings by their emitted value, not by field keys.
	// https://developer.apple.com/documentation/walletpasses/creating-the-source-for-a-pass
	it("keys es.lproj/pass.strings by the literal strings and hashes it like any other member", () => {
		const { files, manifest, sha1 } = archives.loyalty;

		expect(new TextDecoder().decode(files["es.lproj/pass.strings"])).toBe(
			[
				'"Points" = "Puntos";',
				'"Gold" = "Oro";',
				'"Acme Rewards" = "Recompensas Acme";',
			].join("\n")
		);
		expect(manifest["es.lproj/pass.strings"]).toBe(
			sha1["es.lproj/pass.strings"]
		);
	});
});

describe("Wallet.create with Apple credentials", () => {
	const LOYALTY: Omit<LoyaltyTemplateConfig, "type"> = {
		id: "api-loyalty",
		name: "Acme Rewards",
		fields: [],
		apple: { icon: PNG },
	};

	it("issues a readable .pkpass and no Google JWT", async () => {
		const issued = await new Wallet({ apple: credentials })
			.loyalty(LOYALTY)
			.create({ serialNumber: "api-001" });
		if (!issued.apple) {
			throw new Error("no .pkpass issued");
		}

		const { passJson } = await readPkpass(issued.apple);
		expect(passJson).toMatchObject({
			passTypeIdentifier: PASS_TYPE_IDENTIFIER,
			serialNumber: "api-001",
		});
		expect(issued.google).toBeNull();
	});

	it("signs with PEM whose newlines were escaped into an env var", async () => {
		const envEscaped = (pem: string) => pem.replace(/\n/g, "\\n");
		const issued = await new Wallet({
			apple: {
				...credentials,
				signerCert: envEscaped(credentials.signerCert),
				signerKey: envEscaped(credentials.signerKey),
				wwdr: envEscaped(credentials.wwdr),
			},
		})
			.loyalty(LOYALTY)
			.create({ serialNumber: "api-002" });
		if (!issued.apple) {
			throw new Error("no .pkpass issued");
		}

		const { signature } = await readPkpass(issued.apple);
		expect(parseSignature(signature).verifies(credentials.signerCert)).toBe(
			true
		);
	});
});

// Wallet checks the signature against the Pass Type ID certificate and the
// WWDR intermediate that issued it, so a mismatch fails at setup.
// https://developer.apple.com/documentation/walletpasses/building-a-pass
describe("Apple signing credentials", () => {
	const build = (apple: Partial<AppleCredentials>) => () =>
		new Wallet({ apple: { ...credentials, ...apple } as AppleCredentials });

	it.each([
		{ code: "APPLE_INVALID_SIGNER_CERT", field: "signerCert" },
		{ code: "APPLE_INVALID_SIGNER_KEY", field: "signerKey" },
		{ code: "APPLE_INVALID_WWDR", field: "wwdr" },
	] as const)("rejects with $code when $field is not PEM", ({
		code,
		field,
	}) => {
		expect(build({ [field]: "not-pem" })).toThrow(
			expect.objectContaining({ code })
		);
	});

	it("requires signerKey without an external signer", () => {
		expect(build({ signerKey: undefined })).toThrow(
			expect.objectContaining({ code: "APPLE_INVALID_SIGNER_KEY" })
		);
	});

	it("rejects a signerKey that does not match signerCert", () => {
		expect(build({ signerKey: generateTestCerts().signerKey })).toThrow(
			expect.objectContaining({ code: "APPLE_INVALID_SIGNER_KEY" })
		);
	});

	it.each([
		// Same subject as the real issuer, but a different key.
		["a same-named CA with another key", () => generateTestWwdr().cert],
		["a certificate that issued nothing", () => generateTestCerts().signerCert],
	])("rejects %s as wwdr", (_, wwdr) => {
		expect(build({ wwdr: wwdr() })).toThrow(
			expect.objectContaining({ code: "APPLE_INVALID_WWDR" })
		);
	});

	it("checks the WWDR for an external signer too", () => {
		const signer = { sign: () => new Uint8Array(1) };
		expect(
			build({ signerKey: undefined, signer, wwdr: generateTestWwdr().cert })
		).toThrow(expect.objectContaining({ code: "APPLE_INVALID_WWDR" }));
		expect(build({ signerKey: undefined, signer })).not.toThrow();
	});
});

describe("AppleProvider.update", () => {
	const SERIAL = "member-123";
	const item = {
		template: FIXTURES.loyalty.pass,
		content: { serialNumber: SERIAL },
	};
	let apnsOptions: ApnsOptions[] = [];

	function provider(
		send: ApnsSender["send"],
		registrations = memoryRegistrations()
	): AppleProvider {
		apnsOptions = [];
		return new AppleProvider(
			{
				...credentials,
				webService: {
					url: "https://example.com/wallet",
					secret: "s".repeat(32),
					registrations,
				},
			},
			{
				load: () => null,
				resolve: () => item,
				apns: (options) => {
					apnsOptions.push(options);
					return { send, close: () => Promise.resolve() };
				},
			}
		);
	}

	it("pushes to every registered device and drops the ones APNs reports gone", async () => {
		const registrations = memoryRegistrations([
			{
				deviceLibraryIdentifier: "phone",
				pushToken: "aa11",
				serialNumber: SERIAL,
			},
			{
				deviceLibraryIdentifier: "watch",
				pushToken: "bb22",
				serialNumber: SERIAL,
			},
			{
				deviceLibraryIdentifier: "phone",
				pushToken: "aa11",
				serialNumber: "member-456",
			},
		]);
		const send = vi.fn<ApnsSender["send"]>(() =>
			Promise.resolve({
				notified: 1,
				failed: 0,
				unregistered: [{ deviceLibraryIdentifier: "watch", pushToken: "bb22" }],
			})
		);

		await expect(provider(send, registrations).update(item)).resolves.toEqual({
			notified: 1,
			failed: 0,
			removed: 1,
		});
		expect(apnsOptions).toEqual([
			{
				cert: credentials.signerCert,
				key: credentials.signerKey,
				topic: PASS_TYPE_IDENTIFIER,
			},
		]);
		expect(send).toHaveBeenCalledWith([
			{ deviceLibraryIdentifier: "phone", pushToken: "aa11" },
			{ deviceLibraryIdentifier: "watch", pushToken: "bb22" },
		]);
		expect(registrations.rows()).toEqual([
			{
				deviceLibraryIdentifier: "phone",
				pushToken: "aa11",
				serialNumber: SERIAL,
			},
			{
				deviceLibraryIdentifier: "phone",
				pushToken: "aa11",
				serialNumber: "member-456",
			},
		]);
	});

	it("rejects with the push failure", async () => {
		const failure = new WalletError("APPLE_PUSH_FAILED");
		const send = vi.fn(() => Promise.reject(failure));
		await expect(provider(send).update(item)).rejects.toBe(failure);
	});

	it("notifies no one without a web service", async () => {
		const send = vi.fn();
		const plain = new AppleProvider(credentials, {
			resolve: () => item,
			apns: () => ({ send, close: () => Promise.resolve() }),
		});
		await expect(plain.update(item)).resolves.toBeNull();
		expect(send).not.toHaveBeenCalled();
	});
});
