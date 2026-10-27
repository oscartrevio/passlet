import { hash } from "node:crypto";
import { crc32 } from "node:zlib";
import type { AppleSigningIdentity } from "./signature";
import { createZip } from "./zip";

/**
 * One member of a `.pkpass` with the digests sealing it needs: its SHA-1 for
 * manifest.json and its CRC-32 for the zip. A template's images are hashed
 * once and reused by every pass; only pass.json and pass.strings vary.
 */
export interface PassFile {
	readonly crc: number;
	readonly data: Uint8Array;
	readonly name: string;
	readonly sha1: string;
}

export const encoder = new TextEncoder();

export function passFile(name: string, data: Uint8Array): PassFile {
	return { name, data, sha1: hash("sha1", data), crc: crc32(data) };
}

/**
 * Seal a pass's files into a `.pkpass`: a manifest of every file's SHA-1, its
 * detached signature, and the zip that carries them all.
 */
export async function packagePass(
	files: readonly PassFile[],
	identity: AppleSigningIdentity
): Promise<Uint8Array<ArrayBuffer>> {
	const manifest = encoder.encode(
		JSON.stringify(Object.fromEntries(files.map((f) => [f.name, f.sha1])))
	);
	const signature = await identity.sign(manifest);
	return createZip([
		...files,
		{ name: "manifest.json", data: manifest, crc: crc32(manifest) },
		{ name: "signature", data: signature, crc: crc32(signature) },
	]);
}

/** Bundle signed `.pkpass` files into one `.pkpasses` archive. */
export function packagePasses(
	passes: readonly Uint8Array[]
): Uint8Array<ArrayBuffer> {
	return createZip(
		passes.map((data, index) => ({
			name: `${index}.pkpass`,
			data,
			crc: crc32(data),
		}))
	);
}
