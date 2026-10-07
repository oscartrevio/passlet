import { createHash } from "node:crypto";
import { type AppleSigningIdentity, signManifest } from "./signature";
import { createZip } from "./zip";

/**
 * Seal a pass's files into a `.pkpass`: a manifest of every file's SHA-1, its
 * detached signature, and the zip that carries them all.
 */
export async function packagePass(
	files: Record<string, Uint8Array>,
	identity: AppleSigningIdentity
): Promise<Uint8Array<ArrayBuffer>> {
	const manifest: Record<string, string> = {};
	for (const [name, content] of Object.entries(files)) {
		manifest[name] = createHash("sha1").update(content).digest("hex");
	}
	const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest));

	const signature = await signManifest({
		...identity,
		manifest: manifestBytes,
	});

	const entries = Object.entries(files).map(([name, data]) => ({ name, data }));
	entries.push(
		{ name: "manifest.json", data: manifestBytes },
		{ name: "signature", data: signature }
	);
	return createZip(entries);
}

/** Bundle signed `.pkpass` files into one `.pkpasses` archive. */
export function packagePasses(
	passes: readonly Uint8Array[]
): Uint8Array<ArrayBuffer> {
	return createZip(
		passes.map((data, index) => ({ name: `${index}.pkpass`, data }))
	);
}
