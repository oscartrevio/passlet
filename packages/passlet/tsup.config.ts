import { defineConfig } from "tsup";

export default defineConfig({
	entry: ["src/index.ts"],
	format: ["esm", "cjs"],
	dts: true,
	clean: true,
	treeshake: true,
	// zod is bundled so passlet installs with no runtime dependencies.
	noExternal: ["zod"],
	banner: {
		js: "/*! Bundles zod (https://zod.dev) — Copyright (c) 2025 Colin McDonnell — MIT License */",
	},
});
