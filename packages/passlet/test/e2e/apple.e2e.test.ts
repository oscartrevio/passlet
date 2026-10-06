// Signs every fixture with the real pass type certificate from .env and checks
// what a device would: the signature verifies, the signer chains to the
// supplied WWDR certificate and pass.json carries the certificate's
// identifiers. Skips cleanly when APPLE_SIGNER_CERT is absent.
import { spawnSync } from "node:child_process";
import { X509Certificate } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";
import { beforeAll, describe, expect, it, onTestFinished } from "vitest";
import { Wallet, type WalletConfig } from "../../src/index";
import { parseSignature, readPkpass } from "../support/apple";
import {
	FIXTURES,
	type FixtureName,
	walletTemplate,
} from "../support/fixtures";

const OUT_DIR = fileURLToPath(new URL("out/", import.meta.url));
const NAMES = Object.keys(FIXTURES) as FixtureName[];

const APPLE_ROOT_CA_URL =
	"https://www.apple.com/appleca/AppleIncRootCertificate.cer";

function requireEnv(name: string): string {
	const value = process.env[name];
	if (!value) {
		throw new Error(`${name} is not set`);
	}
	return value;
}

// Node renders the subject one `SHORTNAME=value` per line; Apple puts the pass
// type identifier in UID and the team in OU.
function subjectField(cert: X509Certificate, field: "OU" | "UID"): string {
	for (const line of cert.subject.split("\n")) {
		const separator = line.indexOf("=");
		if (line.slice(0, separator) === field) {
			return line.slice(separator + 1);
		}
	}
	throw new Error(`signer certificate subject has no ${field} attribute`);
}

describe.skipIf(!process.env.APPLE_SIGNER_CERT)(
	"Apple Wallet with real signing credentials",
	() => {
		let credentials: WalletConfig;
		let signerCertPem: string;
		let signerCert: X509Certificate;
		let wwdrCert: X509Certificate;

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
			signerCert = new X509Certificate(signerCertPem);
			wwdrCert = new X509Certificate(wwdr);
			mkdirSync(OUT_DIR, { recursive: true });
			console.log(`.pkpass files written to ${OUT_DIR}`);
		});

		it("signer certificate is issued by the supplied WWDR and is still valid", () => {
			// checkIssued compares names; verify checks the signature, so a
			// WWDR from the wrong generation fails either way.
			expect(signerCert.checkIssued(wwdrCert)).toBe(true);
			expect(signerCert.verify(wwdrCert.publicKey)).toBe(true);
			expect(new Date(signerCert.validTo).getTime()).toBeGreaterThan(
				Date.now()
			);
		});

		it.each(
			NAMES
		)("%s: issues a .pkpass whose signature and identifiers match the certificate", async (name) => {
			const { pass, create } = FIXTURES[name];
			const issued = await walletTemplate(new Wallet(credentials), pass).create(
				{
					...create,
					serialNumber: `e2e-${create.serialNumber}`,
				}
			);
			const bytes = issued.apple;
			if (!bytes) {
				throw new Error("no Apple pass was issued");
			}
			writeFileSync(`${OUT_DIR}${name}.pkpass`, bytes);

			const { passJson, signature } = await readPkpass(bytes);
			const parsed = parseSignature(signature);
			expect(parsed.certificateCount).toBe(2);
			expect(parsed.verifies(signerCertPem)).toBe(true);
			expect(passJson).toMatchObject({
				passTypeIdentifier: subjectField(signerCert, "UID"),
				teamIdentifier: subjectField(signerCert, "OU"),
			});
		});

		// openssl, not passlet's own parser, checks each inner pass the way
		// Wallet does: the detached CMS signature over manifest.json chains
		// through the WWDR to Apple's root.
		it("issues a two-pass .pkpasses whose inner passes verify with openssl against Apple Root CA", async () => {
			const response = await fetch(APPLE_ROOT_CA_URL);
			expect(response.ok).toBe(true);
			const root = new X509Certificate(
				new Uint8Array(await response.arrayBuffer())
			);
			const dir = mkdtempSync(join(tmpdir(), "passlet-bundle-"));
			onTestFinished(() => {
				rmSync(dir, { recursive: true, force: true });
			});
			writeFileSync(join(dir, "root.pem"), root.toString());
			writeFileSync(join(dir, "wwdr.pem"), requireEnv("APPLE_WWDR"));

			const wallet = new Wallet(credentials);
			const { apple: bytes } = await wallet.createBundle([
				{
					template: walletTemplate(wallet, FIXTURES.eventTicket.pass),
					content: {
						...FIXTURES.eventTicket.create,
						serialNumber: "e2e-bundle-1",
					},
				},
				{
					template: walletTemplate(wallet, FIXTURES.boardingPass.pass),
					content: {
						...FIXTURES.boardingPass.create,
						serialNumber: "e2e-bundle-2",
					},
				},
			]);
			if (!bytes) {
				throw new Error("no Apple bundle was issued");
			}
			writeFileSync(`${OUT_DIR}bundle.pkpasses`, bytes);

			const zip = await JSZip.loadAsync(bytes);
			expect(Object.keys(zip.files).sort()).toEqual(["0.pkpass", "1.pkpass"]);
			for (const [name, entry] of Object.entries(zip.files)) {
				const { files, passJson } = await readPkpass(
					await entry.async("uint8array")
				);
				const manifest = files["manifest.json"];
				const signature = files.signature;
				if (!(manifest && signature)) {
					throw new Error(`${name} is missing manifest.json or signature`);
				}
				writeFileSync(join(dir, `${name}.manifest.json`), manifest);
				writeFileSync(join(dir, `${name}.signature`), signature);
				// The pass type certificate carries no S/MIME usage, so any
				// purpose is accepted; the chain itself must still verify.
				const result = spawnSync(
					"openssl",
					[
						"cms",
						"-verify",
						"-binary",
						"-inform",
						"DER",
						"-in",
						join(dir, `${name}.signature`),
						"-content",
						join(dir, `${name}.manifest.json`),
						"-CAfile",
						join(dir, "root.pem"),
						"-certfile",
						join(dir, "wwdr.pem"),
						"-purpose",
						"any",
						"-out",
						join(dir, `${name}.out`),
					],
					{ encoding: "utf8" }
				);
				expect(result.stderr).toContain("Verification successful");
				expect(result.status).toBe(0);
				expect(passJson.passTypeIdentifier).toBe(
					subjectField(signerCert, "UID")
				);
			}
		});
	}
);
