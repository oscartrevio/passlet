// Self-signed 1024-bit RSA keys keep test fixtures fast; never use in production.
import { createSelfSigned } from "./x509";

export interface TestCerts {
	signerCert: string;
	signerKey: string;
	/** Reuses the signer cert as WWDR for simplicity. */
	wwdr: string;
}

export function generateTestCerts(): TestCerts {
	const { cert, key } = createSelfSigned({
		commonName: "Test",
		modulusLength: 1024,
		notBefore: new Date(),
		notAfter: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
	});
	return { signerCert: cert, signerKey: key, wwdr: cert };
}
