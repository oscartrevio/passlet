import forge from "node-forge";
import { WalletError } from "../../errors";

interface SignManifestOptions {
	manifest: Uint8Array;
	signerCert: string; // PEM
	signerKey: string; // PEM
	wwdr: string; // PEM
}

// Sign manifest.json with a PKCS#7 detached signature — required by Apple to
// validate the integrity of a .pkpass file.
export function signManifest(options: SignManifestOptions): Uint8Array {
	const { manifest, signerCert, signerKey, wwdr } = options;

	let cert: forge.pki.Certificate;
	let key: forge.pki.PrivateKey;
	let wwdrCert: forge.pki.Certificate;

	try {
		cert = forge.pki.certificateFromPem(signerCert);
	} catch (cause) {
		throw new WalletError("APPLE_INVALID_SIGNER_CERT", undefined, { cause });
	}
	try {
		key = forge.pki.privateKeyFromPem(signerKey);
	} catch (cause) {
		throw new WalletError("APPLE_INVALID_SIGNER_KEY", undefined, { cause });
	}
	try {
		wwdrCert = forge.pki.certificateFromPem(wwdr);
	} catch (cause) {
		throw new WalletError("APPLE_INVALID_WWDR", undefined, { cause });
	}

	try {
		// forge requires a binary string — decode the Uint8Array as latin1
		const binaryStr = new TextDecoder("latin1").decode(manifest);

		const p7 = forge.pkcs7.createSignedData();
		p7.content = forge.util.createBuffer(binaryStr);
		p7.addCertificate(cert);
		p7.addCertificate(wwdrCert);
		p7.addSigner({
			key,
			certificate: cert,
			digestAlgorithm: forge.pki.oids.sha1 as string,
			authenticatedAttributes: [
				{
					type: forge.pki.oids.contentType as string,
					value: forge.pki.oids.data as string,
				},
				{ type: forge.pki.oids.messageDigest as string },
				{ type: forge.pki.oids.signingTime as string },
			],
		});

		p7.sign({ detached: true });

		const der = forge.asn1.toDer(p7.toAsn1()).getBytes();
		return Uint8Array.from(der, (c) => c.charCodeAt(0));
	} catch (cause) {
		throw new WalletError("APPLE_SIGNING_FAILED", undefined, { cause });
	}
}
