/**
 * Generates a self-signed certificate pair for use in tests.
 * Uses 1024-bit keys for speed — security is not a concern for test fixtures.
 */
import forge from "node-forge";

export interface TestCerts {
	signerCert: string;
	signerKey: string;
	/** Reuses the signer cert as WWDR for simplicity. */
	wwdr: string;
}

export function generateTestCerts(): TestCerts {
	const keypair = forge.pki.rsa.generateKeyPair({ bits: 1024 });

	const cert = forge.pki.createCertificate();
	cert.publicKey = keypair.publicKey;
	cert.serialNumber = "01";
	cert.validity.notBefore = new Date();
	cert.validity.notAfter = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
	const attrs = [{ name: "commonName", value: "Test" }];
	cert.setSubject(attrs);
	cert.setIssuer(attrs);
	cert.sign(keypair.privateKey, forge.md.sha256.create());

	return {
		signerCert: forge.pki.certificateToPem(cert),
		signerKey: forge.pki.privateKeyToPem(keypair.privateKey),
		wwdr: forge.pki.certificateToPem(cert),
	};
}
