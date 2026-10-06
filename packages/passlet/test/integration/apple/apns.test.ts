import { generateKeyPairSync } from "node:crypto";
import { once } from "node:events";
import type * as Http2 from "node:http2";
import {
	createSecureServer,
	type Http2SecureServer,
	type IncomingHttpHeaders,
	type SecureClientSessionOptions,
} from "node:http2";
import type { AddressInfo } from "node:net";
import type { TLSSocket } from "node:tls";
import { inspect } from "node:util";
import forge from "node-forge";
import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import { sendPassUpdates } from "../../../src/apple/apns";
import { WalletError } from "../../../src/errors";

const trust = vi.hoisted(() => ({ ca: "" }));

// Real APNs presents a publicly trusted certificate; the local stand-in's
// self-signed one has to be trusted explicitly.
vi.mock("node:http2", async (importOriginal) => {
	const http2 = await importOriginal<typeof Http2>();
	return {
		...http2,
		connect: (authority: string, options: SecureClientSessionOptions) =>
			http2.connect(authority, { ...options, ca: trust.ca }),
	};
});

const TOPIC = "pass.com.example.loyalty";

interface Identity {
	cert: string;
	key: string;
}

function selfSigned(commonName: string): Identity {
	const { privateKey, publicKey } = generateKeyPairSync("rsa", {
		modulusLength: 2048,
		privateKeyEncoding: { type: "pkcs8", format: "pem" },
		publicKeyEncoding: { type: "spki", format: "pem" },
	});
	const cert = forge.pki.createCertificate();
	cert.publicKey = forge.pki.publicKeyFromPem(publicKey);
	cert.serialNumber = "01";
	cert.validity.notBefore = new Date(Date.now() - 60_000);
	cert.validity.notAfter = new Date(Date.now() + 24 * 60 * 60 * 1000);
	const attrs = [{ name: "commonName", value: commonName }];
	cert.setSubject(attrs);
	cert.setIssuer(attrs);
	cert.setExtensions([
		{ name: "subjectAltName", altNames: [{ type: 7, ip: "127.0.0.1" }] },
	]);
	cert.sign(forge.pki.privateKeyFromPem(privateKey), forge.md.sha256.create());
	return { cert: forge.pki.certificateToPem(cert), key: privateKey };
}

interface ReceivedPush {
	body: string;
	clientCertificate: string;
	headers: IncomingHttpHeaders;
}

/** APNs reply per device token: status plus the error `reason`, if any. */
type Reply = [status: number, reason?: string];

const pushIdentity = selfSigned(TOPIC);
const serverIdentity = selfSigned("apns.test");
const replies = new Map<string, Reply>();
let received: ReceivedPush[] = [];
let sessions = 0;
let server: Http2SecureServer;
let origin: string;

beforeAll(async () => {
	trust.ca = serverIdentity.cert;
	server = createSecureServer({
		...serverIdentity,
		// Like APNs, refuse any client that doesn't present the push certificate.
		ca: pushIdentity.cert,
		requestCert: true,
		rejectUnauthorized: true,
		// Apple: "don't assume a specific number of streams". A limit of one
		// makes every multi-token test queue behind it.
		settings: { maxConcurrentStreams: 1 },
	});
	server.on("session", () => {
		sessions++;
	});
	server.on("stream", (stream, headers) => {
		let body = "";
		stream.setEncoding("utf8");
		stream.on("data", (chunk: string) => {
			body += chunk;
		});
		stream.on("end", () => {
			const socket = stream.session?.socket as TLSSocket;
			received.push({
				body,
				clientCertificate: String(socket.getPeerCertificate().subject.CN),
				headers,
			});
			const token = String(headers[":path"]).replace("/3/device/", "");
			const [status, reason] = replies.get(token) ?? [200];
			if (reason === undefined) {
				stream.respond({ ":status": status }, { endStream: true });
				return;
			}
			stream.respond({ ":status": status, "content-type": "application/json" });
			stream.end(
				JSON.stringify(
					status === 410 ? { reason, timestamp: Date.now() } : { reason }
				)
			);
		});
	});
	server.listen(0, "127.0.0.1");
	await once(server, "listening");
	origin = `https://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
	server.close();
	await once(server, "close");
});

beforeEach(() => {
	replies.clear();
	received = [];
	sessions = 0;
});

function send(
	targets: { deviceLibraryIdentifier: string; pushToken: string }[]
) {
	return sendPassUpdates(targets, { ...pushIdentity, topic: TOPIC, origin });
}

describe("sendPassUpdates", () => {
	it("sends Apple's documented Wallet push: POST /3/device/<token>, apns-topic, {} body", async () => {
		await expect(
			send([{ deviceLibraryIdentifier: "d1", pushToken: "a1b2" }])
		).resolves.toEqual({ notified: 1, failed: 0, unregistered: [] });

		expect(received).toEqual([
			{
				body: "{}",
				clientCertificate: TOPIC,
				headers: expect.objectContaining({
					":method": "POST",
					":path": "/3/device/a1b2",
					"apns-topic": TOPIC,
				}),
			},
		]);
		expect(received[0]?.headers).not.toHaveProperty("apns-push-type");
		expect(received[0]?.headers).not.toHaveProperty("authorization");
	});

	it("classifies every documented response", async () => {
		replies.set("02", [410, "Unregistered"]);
		replies.set("03", [410, "ExpiredToken"]);
		replies.set("04", [400, "BadDeviceToken"]);
		replies.set("05", [400, "DeviceTokenNotForTopic"]);
		replies.set("06", [429, "TooManyRequests"]);
		replies.set("07", [413, "PayloadTooLarge"]);
		replies.set("08", [500, "InternalServerError"]);
		replies.set("09", [503, "ServiceUnavailable"]);
		replies.set("0a", [400]);

		const targets = [
			"01",
			"02",
			"03",
			"04",
			"05",
			"06",
			"07",
			"08",
			"09",
			"0a",
		].map((pushToken) => ({
			deviceLibraryIdentifier: `device-${pushToken}`,
			pushToken,
		}));
		const result = await send(targets);

		expect(result.notified).toBe(1);
		expect(result.failed).toBe(6);
		expect(result.unregistered).toEqual([
			{ deviceLibraryIdentifier: "device-02", pushToken: "02" },
			{ deviceLibraryIdentifier: "device-03", pushToken: "03" },
			{ deviceLibraryIdentifier: "device-04", pushToken: "04" },
		]);
		expect(received).toHaveLength(10);
		// All pushes share one connection.
		expect(sessions).toBe(1);
	});

	it("pushes each token once, even when several devices share it", async () => {
		replies.set("dead", [410, "Unregistered"]);
		const result = await send([
			{ deviceLibraryIdentifier: "d1", pushToken: "beef" },
			{ deviceLibraryIdentifier: "d2", pushToken: "beef" },
			{ deviceLibraryIdentifier: "d3", pushToken: "dead" },
			{ deviceLibraryIdentifier: "d4", pushToken: "dead" },
		]);

		expect(result).toEqual({
			notified: 2,
			failed: 0,
			unregistered: [
				{ deviceLibraryIdentifier: "d3", pushToken: "dead" },
				{ deviceLibraryIdentifier: "d4", pushToken: "dead" },
			],
		});
		expect(received.map((push) => push.headers[":path"]).sort()).toEqual([
			"/3/device/beef",
			"/3/device/dead",
		]);
	});

	it("opens no connection when there is nobody to notify", async () => {
		await expect(send([])).resolves.toEqual({
			notified: 0,
			failed: 0,
			unregistered: [],
		});
		expect(sessions).toBe(0);
	});

	it("never sends a token that isn't hex, and reports it as unregistered", async () => {
		const target = {
			deviceLibraryIdentifier: "d1",
			pushToken: "../../3/device/abc",
		};
		await expect(send([target])).resolves.toEqual({
			notified: 0,
			failed: 0,
			unregistered: [target],
		});
		expect(sessions).toBe(0);
	});

	it("throws APPLE_PUSH_FAILED on 403 without exposing key material", async () => {
		replies.set("bad", [403, "BadCertificate"]);
		const error = await send([
			{ deviceLibraryIdentifier: "d1", pushToken: "a1" },
			{ deviceLibraryIdentifier: "d2", pushToken: "bad" },
		]).catch((e: unknown) => e);

		expect(error).toBeInstanceOf(WalletError);
		expect(error).toMatchObject({
			code: "APPLE_PUSH_FAILED",
			message: "APNs rejected the push certificate (BadCertificate).",
		});
		const keyBody = pushIdentity.key.split("\n")[1];
		const certBody = pushIdentity.cert.split("\n")[1];
		const exposed = `${inspect(error, { depth: null })}${JSON.stringify(error)}`;
		expect(exposed).not.toContain(keyBody);
		expect(exposed).not.toContain(certBody);
	});

	it("throws APPLE_PUSH_FAILED when APNs refuses the client certificate", async () => {
		const stranger = selfSigned(TOPIC);
		const error = await sendPassUpdates(
			[{ deviceLibraryIdentifier: "d1", pushToken: "a1" }],
			{
				...stranger,
				topic: TOPIC,
				origin,
			}
		).catch((e: unknown) => e);

		expect(error).toBeInstanceOf(WalletError);
		expect(error).toMatchObject({ code: "APPLE_PUSH_FAILED" });
		expect(inspect(error, { depth: null })).not.toContain(
			stranger.key.split("\n")[1]
		);
		expect(received).toHaveLength(0);
	});

	it("throws APPLE_PUSH_FAILED when APNs is unreachable", async () => {
		const closed = createSecureServer(serverIdentity);
		closed.listen(0, "127.0.0.1");
		await once(closed, "listening");
		const { port } = closed.address() as AddressInfo;
		closed.close();
		await once(closed, "close");

		await expect(
			sendPassUpdates([{ deviceLibraryIdentifier: "d1", pushToken: "a1" }], {
				...pushIdentity,
				topic: TOPIC,
				origin: `https://127.0.0.1:${port}`,
			})
		).rejects.toMatchObject({ code: "APPLE_PUSH_FAILED" });
	});
});
