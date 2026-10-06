// Self-signed X.509 v3 certificates for tests. Encoding reuses the library's
// DER writer; Node's X509Certificate and TLS parse and verify the result
// independently.
import { generateKeyPairSync, sign } from "node:crypto";
import { isIPv4 } from "node:net";
import {
	context0,
	NULL,
	OCTET_STRING,
	oid,
	sequence,
	set,
	time,
	tlv,
} from "../../src/apple/der";

export interface SelfSignedOptions {
	commonName: string;
	/** RSA modulus size; defaults to 2048. */
	modulusLength?: number;
	notAfter: Date;
	notBefore: Date;
	/** IPv4 address for a subjectAltName extension. */
	subjectAltNameIp?: string;
}

export interface SelfSigned {
	cert: string;
	key: string;
}

const SHA256_WITH_RSA = sequence(oid("1.2.840.113549.1.1.11"), NULL);
const INTEGER = 0x02;
const BIT_STRING = 0x03;
const UTF8_STRING = 0x0c;

function name(commonName: string): Uint8Array {
	return sequence(
		set(
			sequence(
				oid("2.5.4.3"),
				tlv(UTF8_STRING, new TextEncoder().encode(commonName))
			)
		)
	);
}

function subjectAltNameIp(ip: string): Uint8Array {
	if (!isIPv4(ip)) {
		throw new Error(`not an IPv4 address: ${ip}`);
	}
	const address = Uint8Array.from(ip.split(".").map(Number));
	// GeneralName iPAddress is [7] IMPLICIT OCTET STRING.
	return sequence(
		oid("2.5.29.17"),
		tlv(OCTET_STRING, sequence(tlv(0x87, address)))
	);
}

export function createSelfSigned(options: SelfSignedOptions): SelfSigned {
	const { privateKey, publicKey } = generateKeyPairSync("rsa", {
		modulusLength: options.modulusLength ?? 2048,
	});
	const subject = name(options.commonName);
	const extensions = options.subjectAltNameIp
		? [tlv(0xa3, sequence(subjectAltNameIp(options.subjectAltNameIp)))]
		: [];
	const tbs = sequence(
		context0(tlv(INTEGER, Uint8Array.of(2))),
		tlv(INTEGER, Uint8Array.of(1)),
		SHA256_WITH_RSA,
		subject,
		sequence(time(options.notBefore), time(options.notAfter)),
		subject,
		publicKey.export({ type: "spki", format: "der" }),
		...extensions
	);
	const signature = sign("sha256", tbs, privateKey);
	const der = sequence(
		tbs,
		SHA256_WITH_RSA,
		tlv(BIT_STRING, Uint8Array.of(0), signature)
	);
	const base64 = Buffer.from(der).toString("base64").replace(/.{64}/g, "$&\n");
	return {
		cert: `-----BEGIN CERTIFICATE-----\n${base64.trimEnd()}\n-----END CERTIFICATE-----\n`,
		key: privateKey.export({ type: "pkcs8", format: "pem" }) as string,
	};
}
