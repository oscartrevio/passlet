// Signs every fixture with the real pass type certificate from .env and checks
// what a device would: the signature verifies, the signer chains to the
// supplied WWDR certificate and pass.json carries the certificate's
// identifiers. Skips cleanly when APPLE_SIGNER_CERT is absent.
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import forge from "node-forge";
import { beforeAll, describe, expect, it } from "vitest";
import { Pass, type WalletCredentials } from "../../src/index";
import { parseSignature, readPkpass } from "../support/apple";
import { FIXTURES, type FixtureName } from "../support/fixtures";

const OUT_DIR = fileURLToPath(new URL("out/", import.meta.url));
const NAMES = Object.keys(FIXTURES) as FixtureName[];

// Apple puts the pass type identifier in the subject's UID attribute, which
// node-forge has no short name for.
const UID_OID = "0.9.2342.19200300.100.1.1";

function requireEnv(name: string): string {
	const value = process.env[name];
	if (!value) {
		throw new Error(`${name} is not set`);
	}
	return value;
}

function subjectField(
	cert: forge.pki.Certificate,
	field: string | { type: string }
): string {
	const value = cert.subject.getField(field)?.value;
	if (typeof value !== "string") {
		throw new Error(
			`signer certificate subject has no ${JSON.stringify(field)} attribute`
		);
	}
	return value;
}

describe.skipIf(!process.env.APPLE_SIGNER_CERT)(
	"Apple Wallet with real signing credentials",
	() => {
		let credentials: WalletCredentials;
		let signerCertPem: string;
		let signerCert: forge.pki.Certificate;
		let wwdrCert: forge.pki.Certificate;

		beforeAll(() => {
			signerCertPem = requireEnv("APPLE_SIGNER_CERT");
			const wwdr = requireEnv("APPLE_WWDR");
			credentials = {
				apple: {
					passTypeIdentifier: requireEnv("APPLE_PASS_TYPE_IDENTIFIER"),
					teamId: requireEnv("APPLE_TEAM_ID"),
					signerCert: signerCertPem,
					signerKey: requireEnv("APPLE_SIGNER_KEY"),
					wwdr,
				},
			};
			signerCert = forge.pki.certificateFromPem(signerCertPem);
			wwdrCert = forge.pki.certificateFromPem(wwdr);
			mkdirSync(OUT_DIR, { recursive: true });
			console.log(`.pkpass files written to ${OUT_DIR}`);
		});

		it("signer certificate is issued by the supplied WWDR and is still valid", () => {
			// forge throws when the issuer does not match, so a WWDR from the
			// wrong generation fails with its own message.
			expect(wwdrCert.verify(signerCert)).toBe(true);
			expect(signerCert.validity.notAfter.getTime()).toBeGreaterThan(
				Date.now()
			);
		});

		it.each(
			NAMES
		)("%s: issues a .pkpass whose signature and identifiers match the certificate", async (name) => {
			const { pass, create } = FIXTURES[name];
			const issued = await new Pass(pass, credentials).create({
				...create,
				serialNumber: `e2e-${create.serialNumber}`,
			});
			const bytes = issued.apple;
			if (!bytes) {
				throw new Error("no Apple pass was issued");
			}
			writeFileSync(`${OUT_DIR}${name}.pkpass`, bytes);
			expect(issued.warnings).toEqual([]);

			const { passJson, signature } = await readPkpass(bytes);
			const parsed = parseSignature(signature);
			expect(parsed.certificateCount).toBe(2);
			expect(parsed.verifies(signerCertPem)).toBe(true);
			expect(passJson).toMatchObject({
				passTypeIdentifier: subjectField(signerCert, { type: UID_OID }),
				teamIdentifier: subjectField(signerCert, "OU"),
			});
		});
	}
);
