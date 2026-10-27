import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

// Four projects, selected with `--project <name>`:
//   unit         pure functions and Wallet setup — no network, no archives;
//                Apple providers parse the generated test certs at setup
//   integration  signing, archives and the Wallet HTTP flow against stubs and
//                local HTTP/HTTP2 servers
//   e2e          real credentials from .env; skipped when they are absent
//   bench        `vitest bench` through the public API; not part of `test`
export default defineConfig({
	test: {
		unstubGlobals: true,
		restoreMocks: true,
		projects: [
			{
				extends: true,
				test: {
					name: "unit",
					include: ["test/unit/**/*.test.ts"],
					globalSetup: ["test/support/global-setup.ts"],
				},
			},
			{
				extends: true,
				test: {
					name: "integration",
					include: ["test/integration/**/*.test.ts"],
					globalSetup: ["test/support/global-setup.ts"],
				},
			},
			{
				extends: true,
				test: {
					name: "e2e",
					include: ["test/e2e/**/*.test.ts"],
					env: loadEnv("test", import.meta.dirname, ""),
					testTimeout: 30_000,
				},
			},
			{
				extends: true,
				test: {
					name: "bench",
					include: [],
					benchmark: { include: ["test/bench/**/*.bench.ts"] },
					globalSetup: ["test/support/global-setup.ts"],
				},
			},
		],
	},
});
