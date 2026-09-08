// Self-signed 1024-bit RSA keys keep test fixtures fast; never use in production.
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
	const signerCert = forge.pki.certificateToPem(cert);

	return {
		signerCert,
		signerKey: forge.pki.privateKeyToPem(keypair.privateKey),
		wwdr: signerCert,
	};
}
