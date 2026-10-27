import { defineConfig } from "tsup";

export default defineConfig({
	entry: ["src/index.ts"],
	// ESM only. Every supported Node (^20.19 || >=22.12) can require() it:
	// https://nodejs.org/api/modules.html#loading-ecmascript-modules-using-require
	format: ["esm"],
	// Matches `engines`, so esbuild lowers any syntax newer than Node 20.
	target: "node20",
	// Keep `node:crypto` etc. as written; some bundlers and runtimes resolve a
	// bare `crypto` or `stream` to a polyfill or userland package.
	removeNodeProtocol: false,
	dts: true,
	clean: true,
	treeshake: true,
});
