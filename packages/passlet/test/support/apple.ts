import { createHash, verify, X509Certificate } from "node:crypto";
import JSZip from "jszip";
import { expect, inject, vi } from "vitest";
import { appleAuthTokens } from "../../src/apple/auth-token";
import type {
	AppleCredentials,
	AppleWebService,
	PassRegistration,
	PassRegistrations,
} from "../../src/config";
import { child, children, decodeOid, type Node, parse } from "./der-reader";

export const PASS_TYPE_IDENTIFIER = "pass.com.test.example";
export const TEAM_ID = "ABCD1234EF";

/** Minimal 1×1 PNG — valid image bytes for archives that reach a device. */
export const PNG = new Uint8Array([
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49,
	0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02,
	0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44,
	0x41, 0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00, 0x00, 0x00, 0x02, 0x00,
	0x01, 0xe2, 0x21, 0xbc, 0x33, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44,
	0xae, 0x42, 0x60, 0x82,
]);

/** Icon with the @2x variant Apple recommends for Retina displays. */
export const ICON = { base: PNG, retina: PNG };

/**
 * Credentials whose PEM fields are placeholders. Only for `buildPassJson`,
 * which never signs — an `AppleProvider` rejects these at construction.
 */
export const UNSIGNED_APPLE_CREDENTIALS: AppleCredentials = {
	passTypeIdentifier: PASS_TYPE_IDENTIFIER,
	teamId: TEAM_ID,
	signerCert: "unused",
	signerKey: "unused",
	wwdr: "unused",
};

/** Signing material generated once per run by `global-setup.ts`. */
export function appleCredentials(): AppleCredentials & { signerKey: string } {
	return {
		passTypeIdentifier: PASS_TYPE_IDENTIFIER,
		teamId: TEAM_ID,
		...inject("appleCerts"),
	};
}

export const WEB_SERVICE_URL = "https://example.com/api/wallet";
export const WEB_SERVICE_SECRET = "s".repeat(32);

/** `apple.webService` at {@link WEB_SERVICE_URL}, with memory registrations. */
export function appleWebService(
	overrides: Partial<AppleWebService> = {}
): AppleWebService {
	return {
		url: WEB_SERVICE_URL,
		secret: WEB_SERVICE_SECRET,
		registrations: memoryRegistrations(),
		...overrides,
	};
}

/** The `authorization` header a device holding pass `serialNumber` sends. */
export function applePassAuthorization(
	serialNumber: string,
	secret = WEB_SERVICE_SECRET
): { authorization: string } {
	const token = appleAuthTokens(secret, PASS_TYPE_IDENTIFIER).issue(
		serialNumber
	);
	return { authorization: `ApplePass ${token}` };
}

export type MemoryRegistrations = PassRegistrations & {
	rows: () => PassRegistration[];
};

/**
 * Registrations kept in memory, with `rows()` to inspect them. Every storage
 * method is a `vi.fn`, so tests can check what reached storage.
 */
export function memoryRegistrations(
	initial: PassRegistration[] = []
): MemoryRegistrations {
	const key = (deviceLibraryIdentifier: string, serialNumber: string) =>
		`${deviceLibraryIdentifier}\0${serialNumber}`;
	const rows = new Map(
		initial.map((row) => [
			key(row.deviceLibraryIdentifier, row.serialNumber),
			row,
		])
	);
	return {
		add: vi.fn((row: PassRegistration) => {
			const id = key(row.deviceLibraryIdentifier, row.serialNumber);
			const created = !rows.has(id);
			rows.set(id, row);
			return Promise.resolve(created);
		}),
		devices: vi.fn((serialNumber: string) =>
			Promise.resolve(
				[...rows.values()]
					.filter((row) => row.serialNumber === serialNumber)
					.map(({ deviceLibraryIdentifier, pushToken }) => ({
						deviceLibraryIdentifier,
						pushToken,
					}))
			)
		),
		remove: vi.fn((deviceLibraryIdentifier: string, serialNumber: string) => {
			rows.delete(key(deviceLibraryIdentifier, serialNumber));
			return Promise.resolve();
		}),
		rows: () => [...rows.values()],
		serialNumbers: vi.fn((deviceLibraryIdentifier: string) =>
			Promise.resolve(
				[...rows.values()]
					.filter(
						(row) => row.deviceLibraryIdentifier === deviceLibraryIdentifier
					)
					.map((row) => row.serialNumber)
			)
		),
	};
}

export interface Pkpass {
	/** Names of the real (non-directory) archive members. */
	entries: string[];
	files: Record<string, Uint8Array>;
	manifest: Record<string, string>;
	/** SHA-256 of manifest.json, the digest the signature is made over. */
	manifestSha256: string;
	passJson: Record<string, unknown>;
	/** SHA-1 of each member's bytes, recomputed here. */
	sha1: Record<string, string>;
	signature: Uint8Array;
}

export async function readPkpass(bytes: Uint8Array): Promise<Pkpass> {
	const zip = await JSZip.loadAsync(bytes);
	const files: Record<string, Uint8Array> = {};
	const sha1: Record<string, string> = {};
	for (const [name, entry] of Object.entries(zip.files)) {
		if (entry.dir) {
			continue;
		}
		const content = await entry.async("uint8array");
		files[name] = content;
		sha1[name] = createHash("sha1").update(content).digest("hex");
	}

	const decoder = new TextDecoder();
	const text = (name: string): string => {
		const content = files[name];
		if (!content) {
			throw new Error(`${name} missing from .pkpass`);
		}
		return decoder.decode(content);
	};
	const signature = files.signature;
	if (!signature) {
		throw new Error("signature missing from .pkpass");
	}

	return {
		entries: Object.keys(files).sort(),
		files,
		manifest: JSON.parse(text("manifest.json")) as Record<string, string>,
		manifestSha256: createHash("sha256")
			.update(text("manifest.json"))
			.digest("hex"),
		passJson: JSON.parse(text("pass.json")) as Record<string, unknown>,
		sha1,
		signature,
	};
}

export interface ParsedSignature {
	certificateCount: number;
	/** DER of each certificate SignedData carries, in order. */
	certificates: Uint8Array[];
	/** The value of the contentType signed attribute. */
	contentTypeOid: string | undefined;
	/** True when SignedData carries no encapsulated content (detached). */
	detached: boolean;
	digestAlgorithmOid: string;
	/** Digest bytes from the message-digest signed attribute, hex. */
	messageDigestHex: string | undefined;
	/** OIDs of the signed attributes, in the order they are encoded. */
	signedAttributeOids: string[];
	/** Whether the signed attributes are in DER SET OF order (X.690 §11.6). */
	signedAttributesSorted: boolean;
	/** The issuer Name DER that SignerInfo names its signer by. */
	signerIssuer: Uint8Array;
	/** The serial number SignerInfo names its signer by. */
	signerSerial: bigint;
	/** Whether the signature verifies against `signerCertPem` over the signed attributes. */
	verifies(signerCertPem: string): boolean;
}

const DIGEST_NAMES: Record<string, string> = {
	"1.3.14.3.2.26": "sha1",
	"2.16.840.1.101.3.4.2.1": "sha256",
	"2.16.840.1.101.3.4.2.2": "sha384",
	"2.16.840.1.101.3.4.2.3": "sha512",
};
const SIGNED_DATA_OID = "1.2.840.113549.1.7.2";
const CONTENT_TYPE_OID = "1.2.840.113549.1.9.3";
const MESSAGE_DIGEST_OID = "1.2.840.113549.1.9.4";

function integer(node: Node): bigint {
	if (node.tag !== 0x02) {
		throw new Error(`expected INTEGER, got tag 0x${node.tag.toString(16)}`);
	}
	return BigInt(`0x${Buffer.from(node.content).toString("hex")}`);
}

/** Parses a detached PKCS#7 signature as produced for `.pkpass` files. */
export function parseSignature(der: Uint8Array): ParsedSignature {
	const contentInfo = parse(der);
	if (decodeOid(child(contentInfo, 0)) !== SIGNED_DATA_OID) {
		throw new Error("not a PKCS#7 SignedData");
	}
	// SignedData: version, digestAlgorithms, contentInfo, [0] certificates,
	// [1] crls, signerInfos.
	const signedData = children(child(child(contentInfo, 1), 0));
	const encapsulated = signedData[2];
	const signerInfoSet = signedData.at(-1);
	if (!(encapsulated && signerInfoSet)) {
		throw new Error("SignedData is missing fields");
	}
	const certificates = signedData.find((node) => node.tag === 0xa0);
	const signerInfos = children(signerInfoSet);
	const signerInfo = signerInfos[0];
	if (signerInfos.length !== 1 || !signerInfo) {
		throw new Error(`expected one SignerInfo, got ${signerInfos.length}`);
	}
	// SignerInfo: version, issuerAndSerialNumber, digestAlgorithm,
	// [0] signedAttributes, signatureAlgorithm, signature.
	const [, signerId, digestAlgorithm, attributes, , signature] =
		children(signerInfo);
	if (!(signerId && digestAlgorithm && attributes?.tag === 0xa0 && signature)) {
		throw new Error("SignerInfo has no signed attributes");
	}
	const digestOid = decodeOid(child(digestAlgorithm, 0));
	const digestName = DIGEST_NAMES[digestOid];

	// Signed attributes are verified as a SET (RFC 5652 §5.4), not the
	// implicit [0] tag they carry inside SignerInfo.
	const signedAttributes = Uint8Array.from(attributes.raw);
	signedAttributes[0] = 0x31;

	const attributeNodes = children(attributes);
	const attributeValue = (oid: string): Node | undefined => {
		const attribute = attributeNodes.find(
			(node) => decodeOid(child(node, 0)) === oid
		);
		return attribute && child(child(attribute, 1), 0);
	};
	const messageDigest = attributeValue(MESSAGE_DIGEST_OID);
	const contentType = attributeValue(CONTENT_TYPE_OID);
	const encodedAttributes = attributeNodes.map((node) => node.raw);

	return {
		certificates: certificates
			? children(certificates).map((node) => node.raw)
			: [],
		certificateCount: certificates ? children(certificates).length : 0,
		contentTypeOid: contentType && decodeOid(contentType),
		detached: children(encapsulated).length === 1,
		digestAlgorithmOid: digestOid,
		messageDigestHex:
			messageDigest && Buffer.from(messageDigest.content).toString("hex"),
		signedAttributeOids: attributeNodes.map((node) =>
			decodeOid(child(node, 0))
		),
		signedAttributesSorted: Buffer.concat(encodedAttributes).equals(
			Buffer.concat(encodedAttributes.toSorted(Buffer.compare))
		),
		signerIssuer: child(signerId, 0).raw,
		signerSerial: integer(child(signerId, 1)),
		verifies(signerCertPem) {
			if (!digestName) {
				return false;
			}
			try {
				return verify(
					digestName,
					signedAttributes,
					signerCertPem,
					signature.content
				);
			} catch {
				return false;
			}
		},
	};
}

/** The parts of a certificate's TBSCertificate a signer is identified by. */
function certificateNames(pem: string): {
	issuer: Uint8Array;
	subject: Uint8Array;
} {
	// TBSCertificate: [0] version, serialNumber, signature, issuer, validity,
	// subject, ...
	const [, , , issuer, , subject] = children(
		child(parse(new X509Certificate(pem).raw), 0)
	);
	if (!(issuer && subject)) {
		throw new Error("certificate has no issuer or subject");
	}
	return { issuer: issuer.raw, subject: subject.raw };
}

/**
 * Asserts what Wallet checks before trusting a `.pkpass`: the signature
 * verifies against `signerCert`, names it as its signer by issuer and serial,
 * and carries it with the `wwdr` that issued it. The certificates are read by
 * Node's X509Certificate, independently of passlet's DER code.
 * https://developer.apple.com/documentation/walletpasses/building-a-pass
 */
export function expectSignedBy(
	signed: ParsedSignature,
	{ signerCert, wwdr }: { signerCert: string; wwdr: string }
): void {
	const signer = new X509Certificate(signerCert);
	const intermediate = new X509Certificate(wwdr);
	expect(signed.verifies(signerCert)).toBe(true);
	expect(signed.signerSerial).toBe(BigInt(`0x${signer.serialNumber}`));
	const issuer = Buffer.from(signed.signerIssuer);
	expect(issuer.equals(Buffer.from(certificateNames(signerCert).issuer))).toBe(
		true
	);
	expect(issuer.equals(Buffer.from(certificateNames(wwdr).subject))).toBe(true);
	expect(
		signed.certificates.map((der) => new X509Certificate(der).fingerprint256)
	).toEqual([signer.fingerprint256, intermediate.fingerprint256]);
	// id-data: the signature covers plain bytes, the manifest.
	expect(signed.contentTypeOid).toBe("1.2.840.113549.1.7.1");
	expect(signed.signedAttributesSorted).toBe(true);
}
