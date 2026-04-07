import JSZip from "jszip";
import { beforeAll, describe, expect, it } from "vitest";
import type { AppleCredentials } from "../../types/credentials";
import { generateApplePass } from "./index";
import { generateTestCerts, type TestCerts } from "./test-certs";

const SHA1_RE = /^[0-9a-f]{40}$/;

let certs: TestCerts;
let credentials: AppleCredentials;
const STUB_ICON = new Uint8Array([1, 2, 3]);

beforeAll(() => {
	certs = generateTestCerts();
	credentials = {
		passTypeIdentifier: "pass.com.test.example",
		teamId: "ABCD1234EF",
		signerCert: certs.signerCert,
		signerKey: certs.signerKey,
		wwdr: certs.wwdr,
	};
}, 30_000);

async function getStringsFile(
	passBytes: Uint8Array,
	language: string
): Promise<string | null> {
	const zip = await JSZip.loadAsync(passBytes);
	return zip.file(`${language}.lproj/pass.strings`)?.async("string") ?? null;
}

describe("Apple locale files", () => {
	it("generates a .lproj/pass.strings file for each locale", async () => {
		const { pass } = await generateApplePass(
			{
				type: "loyalty",
				id: "p1",
				name: "Acme Rewards",
				fields: [field("points", "Points")],
				apple: { icon: STUB_ICON },
				locales: {
					es: { points: "Puntos", name: "Recompensas Acme" },
					fr: { points: "Points FR", name: "Récompenses Acme" },
				},
			},
			{ serialNumber: "s1" },
			credentials
		);

		const es = await getStringsFile(pass, "es");
		const fr = await getStringsFile(pass, "fr");

		expect(es).not.toBeNull();
		expect(fr).not.toBeNull();
	});

	it("formats entries as Apple pass.strings key = value pairs", async () => {
		const { pass } = await generateApplePass(
			{
				type: "loyalty",
				id: "p1",
				name: "Acme Rewards",
				fields: [],
				apple: { icon: STUB_ICON },
				locales: {
					es: { points: "Puntos", name: "Recompensas Acme" },
				},
			},
			{ serialNumber: "s1" },
			credentials
		);

		const es = await getStringsFile(pass, "es");
		expect(es).toContain('"points" = "Puntos";');
		expect(es).toContain('"name" = "Recompensas Acme";');
	});

	it("escapes double quotes in translated values", async () => {
		const { pass } = await generateApplePass(
			{
				type: "loyalty",
				id: "p1",
				name: "Test",
				fields: [],
				apple: { icon: STUB_ICON },
				locales: {
					es: { tagline: 'Say "Hola"' },
				},
			},
			{ serialNumber: "s1" },
			credentials
		);

		const es = await getStringsFile(pass, "es");
		expect(es).toContain('"tagline" = "Say \\"Hola\\"";');
	});

	it("includes lproj files in the manifest SHA1 hashes", async () => {
		const { pass } = await generateApplePass(
			{
				type: "loyalty",
				id: "p1",
				name: "Test",
				fields: [],
				apple: { icon: STUB_ICON },
				locales: { es: { name: "Prueba" } },
			},
			{ serialNumber: "s1" },
			credentials
		);

		const zip = await JSZip.loadAsync(pass);
		const manifestFile = zip.file("manifest.json");
		if (!manifestFile) {
			throw new Error("manifest.json not found");
		}
		const manifest = JSON.parse(await manifestFile.async("string")) as Record<
			string,
			string
		>;

		expect(manifest["es.lproj/pass.strings"]).toMatch(SHA1_RE);
	});

	it("generates no lproj files when locales is not set", async () => {
		const { pass } = await generateApplePass(
			{
				type: "loyalty",
				id: "p1",
				name: "Test",
				fields: [],
				apple: { icon: STUB_ICON },
			},
			{ serialNumber: "s1" },
			credentials
		);

		const zip = await JSZip.loadAsync(pass);
		const lprojFiles = Object.keys(zip.files).filter((f) =>
			f.endsWith(".lproj/pass.strings")
		);
		expect(lprojFiles).toHaveLength(0);
	});

	it("supports _value suffix for translating static field values", async () => {
		const { pass } = await generateApplePass(
			{
				type: "loyalty",
				id: "p1",
				name: "Test",
				fields: [],
				apple: { icon: STUB_ICON },
				locales: { es: { tier_value: "Oro" } },
			},
			{ serialNumber: "s1" },
			credentials
		);

		const es = await getStringsFile(pass, "es");
		expect(es).toContain('"tier_value" = "Oro";');
	});
});

// Inline helper — avoids importing field builder just for a simple FieldDef
function field(key: string, label: string) {
	return { slot: "primary" as const, key, label };
}
