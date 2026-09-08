import { beforeAll, describe, expect, it } from "vitest";
import {
	type AppleCredentials,
	type LoyaltyPassConfig,
	Wallet,
} from "../../../src/index";
import { generateApplePass } from "../../../src/providers/apple/index";
import {
	appleCredentials,
	PASS_TYPE_IDENTIFIER,
	type Pkpass,
	PNG,
	parseSignature,
	readPkpass,
} from "../../support/apple";
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
	event: ["icon.png", "icon@2x.png", "pass.json"],
	flight: ["icon.png", "icon@2x.png", "pass.json"],
	transit: ["icon.png", "icon@2x.png", "pass.json"],
	coupon: ["icon.png", "icon@2x.png", "pass.json", "strip.png"],
	giftCard: ["icon.png", "icon@2x.png", "pass.json"],
	generic: ["icon.png", "icon@2x.png", "pass.json"],
};

// id-sha1: the digest Apple expects from an in-memory signing key.
const SHA1_OID = "1.3.14.3.2.26";

interface Archive extends Pkpass {
	warnings: string[];
}

const NAMES = Object.keys(FIXTURES) as FixtureName[];
const archives = {} as Record<FixtureName, Archive>;
let credentials: AppleCredentials;

beforeAll(async () => {
	credentials = appleCredentials();
	await Promise.all(
		NAMES.map(async (name) => {
			const { pass, create } = FIXTURES[name];
			const { pass: bytes, warnings } = await generateApplePass(
				pass,
				create,
				credentials
			);
			archives[name] = { ...(await readPkpass(bytes)), warnings };
		})
	);
});

describe.each(NAMES)("%s .pkpass", (name) => {
	it("contains exactly the expected members and generates without warnings", () => {
		const { entries, warnings } = archives[name];
		expect(entries).toEqual(
			[...MEMBERS[name], "manifest.json", "signature"].sort()
		);
		expect(warnings).toEqual([]);
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
		const { sha1, signature } = archives.loyalty;
		const signed = parseSignature(signature);

		expect(signed).toMatchObject({
			certificateCount: 2,
			detached: true,
			digestAlgorithmOid: SHA1_OID,
			messageDigestHex: sha1["manifest.json"],
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
	// No retina icon, so the archive carries a warning.
	const LOYALTY: Omit<LoyaltyPassConfig, "type"> = {
		id: "api-loyalty",
		name: "Acme Rewards",
		fields: [],
		apple: { icon: PNG },
	};

	it("issues a readable .pkpass, no Google JWT, and surfaces image warnings", async () => {
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
		expect(issued.warnings).toEqual([expect.stringContaining("icon@2x")]);
	});

	it("rejects with the Apple provider's error when signing fails", async () => {
		const wallet = new Wallet({
			apple: { ...credentials, signerCert: "not-a-cert" },
		});

		await expect(
			wallet.loyalty(LOYALTY).create({ serialNumber: "api-002" })
		).rejects.toThrow(
			expect.objectContaining({ code: "APPLE_INVALID_SIGNER_CERT" })
		);
	});
});
