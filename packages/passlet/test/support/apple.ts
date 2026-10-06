import { createHash, verify } from "node:crypto";
import JSZip from "jszip";
import { inject } from "vitest";
import { AppleProvider } from "../../src/apple/index";
import type { ParsedContent } from "../../src/schema/content";
import type {
	AppleCredentials,
	PassRegistration,
	PassRegistrations,
} from "../../src/schema/settings";
import type { ParsedTemplate } from "../../src/schema/template";
import { child, children, decodeOid, parse } from "./der-reader";

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
 * Credentials whose PEM fields are placeholders. Only for unit tests that
 * exercise `buildPassJson` and never sign — signing with these throws.
 */
export const UNSIGNED_APPLE_CREDENTIALS: AppleCredentials = {
	passTypeIdentifier: PASS_TYPE_IDENTIFIER,
	teamId: TEAM_ID,
	signerCert: "unused",
	signerKey: "unused",
	wwdr: "unused",
};

/** Self-signed material generated once per run by `global-setup.ts`. */
export function appleCredentials(): AppleCredentials & { signerKey: string } {
	return {
		passTypeIdentifier: PASS_TYPE_IDENTIFIER,
		teamId: TEAM_ID,
		...inject("appleCerts"),
	};
}

/** Sign one `.pkpass` through the Apple provider, without a web service. */
export function issueApplePass(
	template: ParsedTemplate,
	content: ParsedContent,
	credentials: AppleCredentials
): Promise<Uint8Array> {
	const provider = new AppleProvider(credentials, {
		resolve: () => {
			throw new Error("no web service to render for");
		},
	});
	return provider.issue({ template, content });
}

export type MemoryRegistrations = PassRegistrations & {
	rows: () => PassRegistration[];
};

/** Registrations kept in memory, with `rows()` to inspect them. */
export function memoryRegistrations(
	initial: PassRegistration[] = []
): MemoryRegistrations {
	const rows = new Map(
		initial.map((row) => [
			`${row.deviceLibraryIdentifier}\0${row.serialNumber}`,
			row,
		])
	);
	return {
		add: (row) => {
			const key = `${row.deviceLibraryIdentifier}\0${row.serialNumber}`;
			const created = !rows.has(key);
			rows.set(key, row);
			return Promise.resolve(created);
		},
		devices: (serialNumber) =>
			Promise.resolve(
				[...rows.values()]
					.filter((row) => row.serialNumber === serialNumber)
					.map(({ deviceLibraryIdentifier, pushToken }) => ({
						deviceLibraryIdentifier,
						pushToken,
					}))
			),
		remove: (deviceLibraryIdentifier, serialNumber) => {
			rows.delete(`${deviceLibraryIdentifier}\0${serialNumber}`);
			return Promise.resolve();
		},
		rows: () => [...rows.values()],
		serialNumbers: (deviceLibraryIdentifier) =>
			Promise.resolve(
				[...rows.values()]
					.filter(
						(row) => row.deviceLibraryIdentifier === deviceLibraryIdentifier
					)
					.map((row) => row.serialNumber)
			),
	};
}

export interface Pkpass {
	/** Names of the real (non-directory) archive members. */
	entries: string[];
	files: Record<string, Uint8Array>;
	manifest: Record<string, string>;
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
		passJson: JSON.parse(text("pass.json")) as Record<string, unknown>,
		sha1,
		signature,
	};
}

export interface ParsedSignature {
	certificateCount: number;
	/** True when SignedData carries no encapsulated content (detached). */
	detached: boolean;
	digestAlgorithmOid: string;
	/** Digest bytes from the message-digest signed attribute, hex. */
	messageDigestHex: string | undefined;
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
const MESSAGE_DIGEST_OID = "1.2.840.113549.1.9.4";

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
	const [, , digestAlgorithm, attributes, , signature] = children(signerInfo);
	if (!(digestAlgorithm && attributes?.tag === 0xa0 && signature)) {
		throw new Error("SignerInfo has no signed attributes");
	}
	const digestOid = decodeOid(child(digestAlgorithm, 0));
	const digestName = DIGEST_NAMES[digestOid];

	// Signed attributes are verified as a SET (RFC 5652 §5.4), not the
	// implicit [0] tag they carry inside SignerInfo.
	const signedAttributes = Uint8Array.from(attributes.raw);
	signedAttributes[0] = 0x31;

	let messageDigestHex: string | undefined;
	for (const attribute of children(attributes)) {
		if (decodeOid(child(attribute, 0)) === MESSAGE_DIGEST_OID) {
			const digest = child(child(attribute, 1), 0);
			messageDigestHex = Buffer.from(digest.content).toString("hex");
		}
	}

	return {
		certificateCount: certificates ? children(certificates).length : 0,
		detached: children(encapsulated).length === 1,
		digestAlgorithmOid: digestOid,
		messageDigestHex,
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
