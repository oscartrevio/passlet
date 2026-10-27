// Generates the Apple test certificate chain once per run and hands it to
// tests and benches through `inject("appleCerts")`.
import type { TestProject } from "vitest/node";
import { generateTestCerts, type TestCerts } from "./certs";
import { createIssued, createSelfSigned } from "./x509";

declare module "vitest" {
	export interface ProvidedContext {
		appleCerts: TestCerts;
	}
}

const YEAR_MS = 365 * 24 * 60 * 60 * 1000;
const BENCH_WWDR = "Bench WWDR";

// Benches sign with 2048-bit keys, the size of a real Pass Type ID
// certificate, so they measure real-world signing cost.
function productionSizeCerts(): TestCerts {
	const notBefore = new Date();
	const validity = {
		modulusLength: 2048,
		notBefore,
		notAfter: new Date(notBefore.getTime() + YEAR_MS),
	};
	const wwdr = createSelfSigned({ ...validity, commonName: BENCH_WWDR });
	const signer = createIssued(
		{ ...validity, commonName: "Pass Type ID: bench" },
		{ commonName: BENCH_WWDR, key: wwdr.key }
	);
	return { signerCert: signer.cert, signerKey: signer.key, wwdr: wwdr.cert };
}

export function setup(project: TestProject): void {
	project.provide(
		"appleCerts",
		project.name === "bench" ? productionSizeCerts() : generateTestCerts()
	);
}
