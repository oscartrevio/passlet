// Test-only DER reader, deliberately independent of src/apple/der.ts so the
// signature oracle does not share code with the signer under test.

export interface Node {
	/** Content bytes. */
	content: Uint8Array;
	/** The whole TLV, header included. */
	raw: Uint8Array;
	tag: number;
}

function readNode(der: Uint8Array, start: number): Node {
	const tag = der[start];
	const first = der[start + 1];
	if (tag === undefined || first === undefined) {
		throw new Error(`DER truncated at offset ${start}`);
	}
	let length = first;
	let contentStart = start + 2;
	if (first >= 0x80) {
		const lengthBytes = first - 0x80;
		if (lengthBytes === 0 || lengthBytes > 4) {
			throw new Error(`unsupported DER length at offset ${start}`);
		}
		length = 0;
		for (let i = 0; i < lengthBytes; i++) {
			const byte = der[contentStart + i];
			if (byte === undefined) {
				throw new Error(`DER truncated at offset ${start}`);
			}
			length = length * 256 + byte;
		}
		contentStart += lengthBytes;
	}
	const end = contentStart + length;
	if (end > der.length) {
		throw new Error(`DER element at offset ${start} overruns its parent`);
	}
	return {
		content: der.subarray(contentStart, end),
		raw: der.subarray(start, end),
		tag,
	};
}

/** Parses exactly one element spanning all of `der`. */
export function parse(der: Uint8Array): Node {
	const node = readNode(der, 0);
	if (node.raw.length !== der.length) {
		throw new Error("trailing bytes after DER element");
	}
	return node;
}

/** Children of a constructed element. */
export function children(node: Node): Node[] {
	const nodes: Node[] = [];
	for (let offset = 0; offset < node.content.length; ) {
		const child = readNode(node.content, offset);
		nodes.push(child);
		offset += child.raw.length;
	}
	return nodes;
}

export function child(node: Node, index: number): Node {
	const found = children(node)[index];
	if (!found) {
		throw new Error(`DER element has no child ${index}`);
	}
	return found;
}

export function decodeOid(node: Node): string {
	if (node.tag !== 0x06) {
		throw new Error(`expected OID, got tag 0x${node.tag.toString(16)}`);
	}
	const [first = 0, ...rest] = node.content;
	const arcs = [Math.min(Math.floor(first / 40), 2), 0];
	arcs[1] = first - (arcs[0] as number) * 40;
	let value = 0;
	for (const byte of rest) {
		value = value * 128 + (byte % 0x80);
		if (byte < 0x80) {
			arcs.push(value);
			value = 0;
		}
	}
	return arcs.join(".");
}
