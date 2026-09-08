// Generates the self-signed Apple test material once per run and hands it to
// integration tests through `inject("appleCerts")`.
import type { TestProject } from "vitest/node";
import { generateTestCerts, type TestCerts } from "./certs";

declare module "vitest" {
	export interface ProvidedContext {
		appleCerts: TestCerts;
	}
}

export function setup(project: TestProject): void {
	project.provide("appleCerts", generateTestCerts());
}
