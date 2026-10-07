import { crc32 } from "node:zlib";

export interface ZipEntry {
	data: Uint8Array;
	name: string;
}

const LOCAL_HEADER_SIZE = 30;
const CENTRAL_HEADER_SIZE = 46;
const END_OF_CENTRAL_DIRECTORY_SIZE = 22;
// Bit 11: file names are UTF-8. Always set so localized names like
// `de.lproj/pass.strings` (or non-ASCII locale folders) decode the same everywhere.
const UTF8_FLAG = 0x08_00;
// 1980-01-01 00:00 in DOS format (date = year-1980 << 9 | month << 5 | day).
// A fixed timestamp keeps output deterministic; Wallet ignores entry times.
const DOS_TIME = 0;
const DOS_DATE = 0x00_21;

/**
 * Writes an uncompressed (stored) zip archive.
 *
 * Entries are stored rather than deflated: pass assets are PNGs and small JSON
 * files, so compression gains little. No zip64 support — a pass is far below
 * the 4 GiB / 65535-entry limits of the classic format.
 */
export function createZip(entries: ZipEntry[]): Uint8Array<ArrayBuffer> {
	const encoder = new TextEncoder();
	const records = entries.map((entry) => ({
		name: encoder.encode(entry.name),
		data: entry.data,
		crc: crc32(entry.data),
	}));

	const localSize = records.reduce(
		(sum, r) => sum + LOCAL_HEADER_SIZE + r.name.length + r.data.length,
		0
	);
	const centralSize = records.reduce(
		(sum, r) => sum + CENTRAL_HEADER_SIZE + r.name.length,
		0
	);
	const out = Buffer.alloc(
		localSize + centralSize + END_OF_CENTRAL_DIRECTORY_SIZE
	);

	let offset = 0;
	const localOffsets: number[] = [];
	for (const r of records) {
		localOffsets.push(offset);
		out.writeUInt32LE(0x04_03_4b_50, offset);
		out.writeUInt16LE(10, offset + 4); // version needed: 1.0 (stored)
		out.writeUInt16LE(UTF8_FLAG, offset + 6);
		out.writeUInt16LE(0, offset + 8); // method: stored
		out.writeUInt16LE(DOS_TIME, offset + 10);
		out.writeUInt16LE(DOS_DATE, offset + 12);
		out.writeUInt32LE(r.crc, offset + 14);
		out.writeUInt32LE(r.data.length, offset + 18);
		out.writeUInt32LE(r.data.length, offset + 22);
		out.writeUInt16LE(r.name.length, offset + 26);
		out.writeUInt16LE(0, offset + 28); // extra field length
		offset += LOCAL_HEADER_SIZE;
		out.set(r.name, offset);
		offset += r.name.length;
		out.set(r.data, offset);
		offset += r.data.length;
	}

	const centralOffset = offset;
	for (const [i, r] of records.entries()) {
		out.writeUInt32LE(0x02_01_4b_50, offset);
		out.writeUInt16LE(20, offset + 4); // version made by
		out.writeUInt16LE(10, offset + 6); // version needed
		out.writeUInt16LE(UTF8_FLAG, offset + 8);
		out.writeUInt16LE(0, offset + 10); // method: stored
		out.writeUInt16LE(DOS_TIME, offset + 12);
		out.writeUInt16LE(DOS_DATE, offset + 14);
		out.writeUInt32LE(r.crc, offset + 16);
		out.writeUInt32LE(r.data.length, offset + 20);
		out.writeUInt32LE(r.data.length, offset + 24);
		out.writeUInt16LE(r.name.length, offset + 28);
		// Extra, comment, disk number, internal and external attributes stay 0.
		out.writeUInt32LE(localOffsets[i] as number, offset + 42);
		offset += CENTRAL_HEADER_SIZE;
		out.set(r.name, offset);
		offset += r.name.length;
	}

	out.writeUInt32LE(0x06_05_4b_50, offset);
	out.writeUInt16LE(records.length, offset + 8); // entries on this disk
	out.writeUInt16LE(records.length, offset + 10); // total entries
	out.writeUInt32LE(centralSize, offset + 12);
	out.writeUInt32LE(centralOffset, offset + 16);

	return new Uint8Array(out.buffer, out.byteOffset, out.byteLength);
}
