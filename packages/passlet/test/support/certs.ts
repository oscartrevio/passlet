// 1024-bit RSA keys keep test fixtures fast; never use in production.
import { randomUUID } from "node:crypto";
import {
	createIssued,
	createSelfSigned,
	type SelfSigned,
	type SelfSignedOptions,
} from "./x509";

export interface TestCerts {
	/** Pass Type ID certificate issued by `wwdr`. */
	signerCert: string;
	signerKey: string;
	/** Stand-in for Apple's WWDR intermediate. */
	wwdr: string;
}

const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

function options(commonName: string): SelfSignedOptions {
	const notBefore = new Date();
	return {
		commonName,
		modulusLength: 1024,
		notBefore,
		notAfter: new Date(notBefore.getTime() + YEAR_MS),
	};
}

/**
 * A stand-in for Apple's WWDR intermediate, with its key. Every chain gets a
 * name of its own unless `commonName` imitates another's.
 */
export function generateTestWwdr(
	commonName = `Test WWDR ${randomUUID()}`
): SelfSigned & { commonName: string } {
	return {
		...createSelfSigned({ ...options(commonName), ca: true }),
		commonName,
	};
}

/** A signer certificate issued by a fresh test WWDR, mirroring Apple's chain. */
export function generateTestCerts(): TestCerts {
	const wwdr = generateTestWwdr();
	const signer = createIssued(options(`Pass Type ID ${randomUUID()}`), wwdr);
	return { signerCert: signer.cert, signerKey: signer.key, wwdr: wwdr.cert };
}
