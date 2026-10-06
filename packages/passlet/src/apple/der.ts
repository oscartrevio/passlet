// Just enough DER to emit a PKCS#7 SignedData and pull the issuer and serial
// out of an X.509 certificate.

export function tlv(tag: number, ...contents: Uint8Array[]): Uint8Array {
	const body = Buffer.concat(contents);
	return Buffer.concat([Uint8Array.of(tag), encodeLength(body.length), body]);
}

function encodeLength(length: number): Uint8Array {
	if (length < 0x80) {
		return Uint8Array.of(length);
	}
	const bytes: number[] = [];
	for (let rest = length; rest > 0; rest = Math.floor(rest / 256)) {
		bytes.unshift(rest % 256);
	}
	return Uint8Array.of(0x80 + bytes.length, ...bytes);
}

export const sequence = (...contents: Uint8Array[]) => tlv(0x30, ...contents);
export const set = (...contents: Uint8Array[]) => tlv(0x31, ...contents);
/** Context-specific constructed [0]: EXPLICIT wrapper or IMPLICIT SET OF. */
export const context0 = (...contents: Uint8Array[]) => tlv(0xa0, ...contents);
export const OCTET_STRING = 0x04;
export const NULL = Uint8Array.of(0x05, 0x00);

export function oid(dotted: string): Uint8Array {
	const [first = 0, second = 0, ...arcs] = dotted.split(".").map(Number);
	const bytes = [first * 40 + second];
	for (const arc of arcs) {
		const encoded = [arc % 128];
		for (
			let rest = Math.floor(arc / 128);
			rest > 0;
			rest = Math.floor(rest / 128)
		) {
			encoded.unshift(0x80 + (rest % 128));
		}
		bytes.push(...encoded);
	}
	return tlv(0x06, Uint8Array.from(bytes));
}

// RFC 5652 §11.3: UTCTime through 2049, GeneralizedTime from 2050 on.
export function time(date: Date): Uint8Array {
	const digits = date.toISOString().replace(/[-:T]|\.\d+/g, "");
	return date.getUTCFullYear() < 2050
		? tlv(0x17, new TextEncoder().encode(digits.slice(2)))
		: tlv(0x18, new TextEncoder().encode(digits));
}

interface Element {
	contentStart: number;
	end: number;
	start: number;
	tag: number;
}

// Callers only read DER that node:crypto already parsed, so no bounds checks.
function readElement(der: Uint8Array, start: number): Element {
	const tag = der[start] as number;
	let length = der[start + 1] as number;
	let contentStart = start + 2;
	if (length >= 0x80) {
		const lengthBytes = length - 0x80;
		length = 0;
		for (let i = 0; i < lengthBytes; i++) {
			length = length * 256 + (der[contentStart + i] as number);
		}
		contentStart += lengthBytes;
	}
	return { contentStart, end: contentStart + length, start, tag };
}

/**
 * PKCS#7 IssuerAndSerialNumber for a DER certificate, copied byte-for-byte
 * from its TBSCertificate so the signer is matched exactly.
 */
export function issuerAndSerialNumber(certificate: Uint8Array): Uint8Array {
	const tbs = readElement(
		certificate,
		readElement(certificate, 0).contentStart
	);
	let serial = readElement(certificate, tbs.contentStart);
	// Skip the optional `[0] EXPLICIT Version`.
	if (serial.tag === 0xa0) {
		serial = readElement(certificate, serial.end);
	}
	const signatureAlgorithm = readElement(certificate, serial.end);
	const issuer = readElement(certificate, signatureAlgorithm.end);
	return sequence(
		certificate.subarray(issuer.start, issuer.end),
		certificate.subarray(serial.start, serial.end)
	);
}
