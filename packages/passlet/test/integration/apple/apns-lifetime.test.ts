import { createHook } from "node:async_hooks";
import type * as Http2 from "node:http2";
import type { SecureClientSessionOptions } from "node:http2";
import { setImmediate } from "node:timers/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApnsClient } from "../../../src/apple/apns";
import { type ApnsStandIn, selfSigned, startApns } from "../../support/apns";

const apnsRoute = vi.hoisted(() => ({ ca: "", ciphers: "", origin: "" }));

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
const target = { deviceLibraryIdentifier: "d1", pushToken: "a1" };

let apns: ApnsStandIn;
let client: ApnsClient;
let passlet: ResourceTracker;

beforeEach(async () => {
	apns = await startApns(apnsRoute, pushIdentity.cert);
	client = new ApnsClient({ ...pushIdentity, topic: TOPIC });
	passlet = trackPassletResources();
});

afterEach(async () => {
	passlet.stop();
	apns.release();
	await apns.close();
});

interface ResourceTracker {
	/** The types of passlet's live resources that keep the process alive. */
	keepingAlive(): Promise<string[]>;
	stop(): void;
}

/**
 * Tracks every timer and handle created with `src/apple/apns.ts` on the
 * stack: its own timers and, through `node:http2`, its connection's socket.
 * `process.getActiveResourcesInfo()` can't tell those from the test runner's
 * own timers.
 */
function trackPassletResources(): ResourceTracker {
	const live = new Map<number, { type: string; resource: object }>();
	const stackTraceLimit = Error.stackTraceLimit;
	// The connection's socket is created many frames below passlet's call.
	Error.stackTraceLimit = Number.POSITIVE_INFINITY;
	const hook = createHook({
		init(asyncId, type, _triggerAsyncId, resource: object) {
			if (new Error("init").stack?.includes("src/apple/apns.ts")) {
				live.set(asyncId, { type, resource });
			}
		},
		destroy(asyncId) {
			live.delete(asyncId);
		},
	}).enable();
	return {
		async keepingAlive() {
			// A cleared timer still reports hasRef(); Node queues its destroy
			// hook for the next check phase, which this waits out.
			await setImmediate();
			return [...live.values()]
				.filter(
					({ resource }) =>
						"hasRef" in resource &&
						typeof resource.hasRef === "function" &&
						resource.hasRef()
				)
				.map(({ type }) => type);
		},
		stop() {
			hook.disable();
			Error.stackTraceLimit = stackTraceLimit;
		},
	};
}

describe("ApnsClient process lifetime", () => {
	it("keeps nothing alive once APNs has answered", async () => {
		await expect(client.send([target])).resolves.toMatchObject({
			notified: 1,
		});

		// The connection stays open for the next push, unref'd.
		expect(apns.sessions).toHaveLength(1);
		expect(apns.sessions[0]?.closed).toBe(false);
		await expect(passlet.keepingAlive()).resolves.toEqual([]);
	});

	it("keeps the process alive while APNs has yet to answer", async () => {
		apns.replies.set(target.pushToken, "hold");

		const sending = client.send([target]);
		await vi.waitFor(() => expect(apns.received).toHaveLength(1));

		await expect(passlet.keepingAlive()).resolves.not.toEqual([]);

		apns.release();
		await expect(sending).resolves.toMatchObject({ notified: 1 });
		await expect(passlet.keepingAlive()).resolves.toEqual([]);
	});
});
