import { X509Certificate } from "node:crypto";
import type * as Http2 from "node:http2";
import type { SecureClientSessionOptions } from "node:http2";
import {
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import type {
	AppleCredentials,
	PassRegistration,
	PassTemplate,
} from "../../../src/index";
import { Wallet } from "../../../src/index";
import { type ApnsStandIn, startApns } from "../../support/apns";
import {
	appleCredentials,
	appleWebService,
	ICON,
	memoryRegistrations,
	PASS_TYPE_IDENTIFIER,
} from "../../support/apple";

const apnsRoute = vi.hoisted(() => ({ ca: "", ciphers: "", origin: "" }));

// Every push goes to the local APNs stand-in.
vi.mock("node:http2", async (importOriginal) => {
	const http2 = await importOriginal<typeof Http2>();
	return {
		...http2,
		connect: (_authority: string, options: SecureClientSessionOptions) =>
			http2.connect(apnsRoute.origin, { ...options, ...apnsRoute }),
	};
});

const SERIAL = "member-123";

let credentials: AppleCredentials & { signerKey: string };
let apns: ApnsStandIn;

beforeAll(() => {
	credentials = appleCredentials();
});

// Like APNs, the stand-in only accepts the Pass Type ID certificate, which
// the test WWDR issued.
beforeEach(async () => {
	apns = await startApns(apnsRoute, credentials.wwdr);
});

afterEach(async () => {
	await apns.close();
});

function registered(
	deviceLibraryIdentifier: string,
	pushToken: string,
	serialNumber = SERIAL
): PassRegistration {
	return { deviceLibraryIdentifier, pushToken, serialNumber };
}

/** A wallet with a web service whose storage holds `rows`. */
function setup(rows: PassRegistration[]) {
	const registrations = memoryRegistrations(rows);
	let template: PassTemplate | undefined;
	const wallet = new Wallet({
		apple: { ...credentials, webService: appleWebService({ registrations }) },
		load: () =>
			template ? { content: {}, template, updatedAt: new Date() } : null,
	});
	template = wallet.loyalty({
		id: "rewards",
		name: "Acme Rewards",
		fields: [],
		apple: { icon: ICON },
	});
	return { registrations, wallet };
}

describe("wallet.update with apple.webService", () => {
	it("pushes every device registered for the pass and drops the ones APNs reports gone", async () => {
		apns.replies.set("bb22", [410, "Unregistered"]);
		const { registrations, wallet } = setup([
			registered("phone", "aa11"),
			registered("watch", "bb22"),
			registered("phone", "aa11", "member-456"),
		]);

		await expect(wallet.update(SERIAL)).resolves.toMatchObject({
			apple: { notified: 1, failed: 0, removed: 1 },
		});

		// The push certificate defaults to the signing certificate.
		const signer = new X509Certificate(credentials.signerCert);
		expect(
			apns.received
				.map((push) => ({
					path: push.headers[":path"],
					topic: push.headers["apns-topic"],
					subject: `CN=${push.clientCertificate}`,
				}))
				.sort((a, b) => String(a.path).localeCompare(String(b.path)))
		).toEqual([
			{
				path: "/3/device/aa11",
				topic: PASS_TYPE_IDENTIFIER,
				subject: signer.subject,
			},
			{
				path: "/3/device/bb22",
				topic: PASS_TYPE_IDENTIFIER,
				subject: signer.subject,
			},
		]);
		expect(registrations.rows()).toEqual([
			registered("phone", "aa11"),
			registered("phone", "aa11", "member-456"),
		]);
	});

	it("pushes a shared token once and drops every device holding it once APNs reports it gone", async () => {
		apns.replies.set("dead", [410, "Unregistered"]);
		const { registrations, wallet } = setup([
			registered("phone", "dead"),
			registered("watch", "dead"),
			registered("tablet", "beef"),
		]);

		await expect(wallet.update(SERIAL)).resolves.toMatchObject({
			apple: { notified: 1, failed: 0, removed: 2 },
		});
		expect(apns.received).toHaveLength(2);
		expect(registrations.rows()).toEqual([registered("tablet", "beef")]);
	});

	it("rejects with APPLE_PUSH_FAILED and keeps every registration when APNs refuses the certificate", async () => {
		apns.replies.set("aa11", [403, "BadCertificate"]);
		const { registrations, wallet } = setup([registered("phone", "aa11")]);

		await expect(wallet.update(SERIAL)).rejects.toMatchObject({
			code: "APPLE_PUSH_FAILED",
		});
		expect(registrations.rows()).toEqual([registered("phone", "aa11")]);
	});
});

describe("wallet.update without apple.webService", () => {
	it("notifies no one", async () => {
		let template: PassTemplate | undefined;
		const wallet = new Wallet({
			apple: credentials,
			load: () =>
				template ? { content: {}, template, updatedAt: new Date() } : null,
		});
		template = wallet.loyalty({
			id: "rewards",
			name: "Acme Rewards",
			fields: [],
			apple: { icon: ICON },
		});

		await expect(wallet.update(SERIAL)).resolves.toMatchObject({
			apple: null,
		});
		expect(apns.sessions).toHaveLength(0);
	});
});
