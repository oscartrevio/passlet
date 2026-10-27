import { once } from "node:events";
import type * as Http2 from "node:http2";
import type {
	SecureClientSessionOptions,
	ServerHttp2Session,
} from "node:http2";
import { createSecureServer } from "node:http2";
import type { AddressInfo } from "node:net";
import { inspect } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApnsClient } from "../../../src/apple/apns";
import { WalletError } from "../../../src/errors";
import { type ApnsStandIn, selfSigned, startApns } from "../../support/apns";

const apnsRoute = vi.hoisted(() => ({ ca: "", ciphers: "", origin: "" }));

// Every connection goes to the local stand-in, whose self-signed certificate
// is trusted explicitly; real APNs presents a publicly trusted one.
vi.mock("node:http2", async (importOriginal) => {
	const http2 = await importOriginal<typeof Http2>();
	return {
		...http2,
		connect: (_authority: string, options: SecureClientSessionOptions) =>
			http2.connect(apnsRoute.origin, { ...options, ...apnsRoute }),
	};
});

const TOPIC = "pass.com.example.loyalty";

const pushIdentity = selfSigned(TOPIC);
let apns: ApnsStandIn;
let client: ApnsClient;

// A server and a client per test, so each test counts only its own
// connections.
beforeEach(async () => {
	apns = await startApns(apnsRoute, pushIdentity.cert);
	client = apnsClient(pushIdentity);
});

afterEach(async () => {
	await apns.close();
});

function apnsClient(identity: { cert: string; key: string }) {
	return new ApnsClient({ ...identity, topic: TOPIC });
}

function send(
	targets: { deviceLibraryIdentifier: string; pushToken: string }[]
) {
	return client.send(targets);
}

describe("ApnsClient", () => {
	it("sends Apple's documented Wallet push: POST /3/device/<token>, apns-topic, {} body", async () => {
		await expect(
			send([{ deviceLibraryIdentifier: "d1", pushToken: "a1b2" }])
		).resolves.toEqual({ notified: 1, failed: 0, unregistered: [] });

		expect(apns.received).toEqual([
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
		expect(apns.received[0]?.headers).not.toHaveProperty("apns-push-type");
		expect(apns.received[0]?.headers).not.toHaveProperty("authorization");
	});

	it("classifies every documented response", async () => {
		apns.replies.set("02", [410, "Unregistered"]);
		apns.replies.set("03", [410, "ExpiredToken"]);
		apns.replies.set("04", [400, "BadDeviceToken"]);
		apns.replies.set("05", [400, "DeviceTokenNotForTopic"]);
		apns.replies.set("06", [429, "TooManyRequests"]);
		apns.replies.set("07", [413, "PayloadTooLarge"]);
		apns.replies.set("08", [500, "InternalServerError"]);
		apns.replies.set("09", [503, "ServiceUnavailable"]);
		apns.replies.set("0a", [400]);

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
		expect(apns.received).toHaveLength(10);
		// All pushes share one connection.
		expect(apns.sessions).toHaveLength(1);
	});

	it("pushes each token once, even when several devices share it", async () => {
		apns.replies.set("dead", [410, "Unregistered"]);
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
		expect(apns.received.map((push) => push.headers[":path"]).sort()).toEqual([
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
		expect(apns.sessions).toHaveLength(0);
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
		expect(apns.sessions).toHaveLength(0);
	});

	it("throws APPLE_PUSH_FAILED on 403 without exposing key material", async () => {
		apns.replies.set("bad", [403, "BadCertificate"]);
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
		const error = await apnsClient(stranger)
			.send([{ deviceLibraryIdentifier: "d1", pushToken: "a1" }])
			.catch((e: unknown) => e);

		expect(error).toBeInstanceOf(WalletError);
		expect(error).toMatchObject({ code: "APPLE_PUSH_FAILED" });
		expect(inspect(error, { depth: null })).not.toContain(
			stranger.key.split("\n")[1]
		);
		expect(apns.received).toHaveLength(0);
	});

	it("throws APPLE_PUSH_FAILED when APNs is unreachable", async () => {
		const closed = createSecureServer();
		closed.listen(0, "127.0.0.1");
		await once(closed, "listening");
		const { port } = closed.address() as AddressInfo;
		closed.close();
		await once(closed, "close");
		apnsRoute.origin = `https://127.0.0.1:${port}`;

		await expect(
			send([{ deviceLibraryIdentifier: "d1", pushToken: "a1" }])
		).rejects.toMatchObject({ code: "APPLE_PUSH_FAILED" });
	});

	// "Reuse a connection as long as possible." (Sending notification
	// requests to APNs)
	it("keeps one connection open across sends", async () => {
		await send([{ deviceLibraryIdentifier: "d1", pushToken: "a1" }]);
		await expect(
			send([{ deviceLibraryIdentifier: "d2", pushToken: "b2" }])
		).resolves.toEqual({ notified: 1, failed: 0, unregistered: [] });

		expect(apns.received.map((push) => push.headers[":path"])).toEqual([
			"/3/device/a1",
			"/3/device/b2",
		]);
		expect(apns.sessions).toHaveLength(1);
	});

	it("opens a new connection once APNs closes the old one", async () => {
		await send([{ deviceLibraryIdentifier: "d1", pushToken: "a1" }]);
		// Graceful close: GOAWAY, as APNs ends connections.
		apns.sessions[0]?.close();
		await once(apns.sessions[0] as ServerHttp2Session, "close");

		await expect(
			send([{ deviceLibraryIdentifier: "d2", pushToken: "b2" }])
		).resolves.toEqual({ notified: 1, failed: 0, unregistered: [] });
		expect(apns.sessions).toHaveLength(2);
	});

	it("keeps every answer when the connection drops mid-send, retrying the rest once", async () => {
		apns.replies.set("dead", [410, "Unregistered"]);
		apns.replies.set("ee", "drop");
		const result = await send([
			{ deviceLibraryIdentifier: "d1", pushToken: "01" },
			{ deviceLibraryIdentifier: "d2", pushToken: "dead" },
			{ deviceLibraryIdentifier: "d3", pushToken: "ee" },
		]);

		expect(result).toEqual({
			notified: 1,
			failed: 1,
			unregistered: [{ deviceLibraryIdentifier: "d2", pushToken: "dead" }],
		});
		// Retried once, on a second connection.
		expect(
			apns.received.filter((push) => push.headers[":path"] === "/3/device/ee")
		).toHaveLength(2);
		expect(apns.sessions).toHaveLength(2);
	});

	it("retries on a new connection the pushes APNs refused after its GOAWAY", async () => {
		apns.replies.set("aa", "goaway");
		const result = await send([
			{ deviceLibraryIdentifier: "d1", pushToken: "aa" },
			{ deviceLibraryIdentifier: "d2", pushToken: "bb" },
			{ deviceLibraryIdentifier: "d3", pushToken: "cc" },
		]);

		expect(result).toEqual({ notified: 3, failed: 0, unregistered: [] });
		expect(apns.sessions).toHaveLength(2);
	});

	it("shares one new connection between sends that start together after a close", async () => {
		// A 403 retires the connection at once; sends that start before the new
		// one is ready share its opening.
		apns.replies.set("bad", [403, "BadCertificate"]);
		await send([{ deviceLibraryIdentifier: "d1", pushToken: "bad" }]).catch(
			() => undefined
		);

		const results = await Promise.all([
			send([{ deviceLibraryIdentifier: "d2", pushToken: "b2" }]),
			send([{ deviceLibraryIdentifier: "d3", pushToken: "c3" }]),
			send([{ deviceLibraryIdentifier: "d4", pushToken: "d4" }]),
		]);

		expect(results.map((r) => r.notified)).toEqual([1, 1, 1]);
		expect(apns.sessions).toHaveLength(2);
	});
});
