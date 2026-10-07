import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

// Three tiers, selected with `--project <name>`:
//   unit         pure functions and Wallet setup — no network, no archives;
//                Apple providers parse the generated test certs at setup
//   integration  signing, archives and the Wallet HTTP flow against stubs
//   e2e          real credentials from .env; skipped when they are absent
export default defineConfig({
	test: {
		projects: [
			{
				test: {
					name: "unit",
					include: ["test/unit/**/*.test.ts"],
					globalSetup: ["test/support/global-setup.ts"],
				},
			},
			{
				test: {
					name: "integration",
					include: ["test/integration/**/*.test.ts"],
					globalSetup: ["test/support/global-setup.ts"],
				},
			},
			{
				test: {
					name: "e2e",
					include: ["test/e2e/**/*.test.ts"],
					env: loadEnv("test", import.meta.dirname, ""),
					testTimeout: 30_000,
				},
			},
		],
	},
});
