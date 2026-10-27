// Fails when the published ESM bundle outgrows its byte budget, so size
// regressions show up in CI. Run `pnpm build` first. Lower the budget when the
// bundle shrinks; raise it only on purpose.
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";

const BUNDLE = new URL("../dist/index.js", import.meta.url);
const BUDGET = { raw: 120 * 1024, gzip: 35 * 1024 };

const bytes = readFileSync(BUNDLE);
const sizes = { raw: bytes.length, gzip: gzipSync(bytes, { level: 9 }).length };

let failed = false;
for (const [kind, size] of Object.entries(sizes)) {
	const over = size > BUDGET[kind];
	failed ||= over;
	console.log(
		`${over ? "✗" : "✓"} dist/index.js ${kind}: ${size} B (budget ${BUDGET[kind]} B)`
	);
}
if (failed) {
	process.exitCode = 1;
}
