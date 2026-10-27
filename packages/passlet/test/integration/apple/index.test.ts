import { X509Certificate } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import {
	type AppleCredentials,
	field,
	type LoyaltyTemplateConfig,
	Wallet,
} from "../../../src/index";
import {
	appleCredentials,
	expectSignedBy,
	PASS_TYPE_IDENTIFIER,
	type Pkpass,
	PNG,
	parseSignature,
	readPkpass,
} from "../../support/apple";
import { generateTestCerts, generateTestWwdr } from "../../support/certs";
import {
	FIXTURES,
	type FixtureName,
	walletTemplate,
} from "../../support/fixtures";

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
			const { apple } = await walletTemplate(
				new Wallet({ apple: credentials }),
				pass
			).create(create);
			if (!apple) {
				throw new Error("no .pkpass issued");
			}
			archives[name] = await readPkpass(apple);
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
	it("is a detached PKCS#7 over manifest.json naming the signer, with its WWDR", () => {
		const { manifestSha256, signature } = archives.loyalty;
		const signed = parseSignature(signature);

		expect(signed).toMatchObject({
			detached: true,
			digestAlgorithmOid: SHA256_OID,
			messageDigestHex: manifestSha256,
		});
		expectSignedBy(signed, credentials);
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

	/** es.lproj/pass.strings of a loyalty pass with these fields and values. */
	async function passStrings(
		config: Pick<LoyaltyTemplateConfig, "fields"> & {
			name?: string;
			translations: Record<string, string>;
			values?: Record<string, string | null>;
		}
	): Promise<string> {
		const { apple } = await new Wallet({ apple: credentials })
			.loyalty({
				id: "strings",
				name: config.name ?? "Acme Rewards",
				fields: config.fields,
				apple: { icon: PNG },
				locales: { es: config.translations },
			})
			.create({ serialNumber: "strings-1", values: config.values });
		if (!apple) {
			throw new Error("no .pkpass issued");
		}
		const { files } = await readPkpass(apple);
		return new TextDecoder().decode(files["es.lproj/pass.strings"]);
	}

	it("keys a _value entry by the recipient's value and skips a hidden field", async () => {
		const fields = [field.primary("tier", "Tier", "Gold")];
		const translations = { tier_value: "Plata" };
		expect(
			await passStrings({ fields, translations, values: { tier: "Silver" } })
		).toBe('"Silver" = "Plata";');
		expect(
			await passStrings({ fields, translations, values: { tier: null } })
		).toBe("");
	});

	it("passes unmatched keys through so literals such as logoText can be translated", async () => {
		expect(
			await passStrings({
				fields: [],
				translations: { "Fly Away": "Vuela lejos" },
			})
		).toBe('"Fly Away" = "Vuela lejos";');
	});

	it("skips a field with no label — there is no literal to key on", async () => {
		expect(
			await passStrings({
				fields: [{ slot: "primary", key: "points", value: "500" }],
				translations: { points: "Puntos" },
			})
		).toBe("");
	});

	it("keeps one entry when two fields share a label", async () => {
		expect(
			await passStrings({
				fields: [
					field.primary("points", "Total"),
					field.back("spend", "Total"),
				],
				translations: { points: "Total ES", spend: "Ignored" },
			})
		).toBe('"Total" = "Total ES";');
	});

	// pass.strings is a NeXTSTEP-style strings file, not JSON.
	it("escapes backslashes, quotes and line breaks in both the literal and the translation", async () => {
		expect(
			await passStrings({
				name: 'The "Best" \\ Pass',
				fields: [],
				translations: { name: 'Say "Hola"\nAdiós\r' },
			})
		).toBe('"The \\"Best\\" \\\\ Pass" = "Say \\"Hola\\"\\nAdiós\\r";');
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
		[
			"a same-named CA with another key",
			() =>
				generateTestWwdr(
					new X509Certificate(credentials.wwdr).subject.slice("CN=".length)
				).cert,
		],
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
