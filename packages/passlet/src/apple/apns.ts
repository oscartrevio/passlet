import { type ClientHttp2Session, connect, constants } from "node:http2";
import { WalletError } from "../errors";

// Pass update pushes only work in production ("Adding a Web Service to Update
// Passes" > Send a Push Notification), so there is no sandbox switch.
const APNS_ORIGIN = "https://api.push.apple.com";
// Apple documents no response time. APNs answers each request once it accepts
// or rejects it; delivery to the device happens later. Ten seconds of silence
// means APNs is unreachable or stalled, and serverless functions (often capped
// at 10-60 s) must still get to return.
const TIMEOUT_MS = 10_000;
// APNs error bodies are a small JSON dictionary; anything larger is not one.
const MAX_ERROR_BODY = 4096;
// Device tokens are hex ("Sending notification requests to APNs" > :path).
// Apple warns not to assume a length, so only the alphabet is checked.
const DEVICE_TOKEN_RE = /^[0-9a-f]+$/i;
const REASON_RE = /^[A-Za-z]{1,64}$/;

export interface ApnsTarget {
	deviceLibraryIdentifier: string;
	pushToken: string;
}

export interface ApnsResult {
	failed: number;
	notified: number;
	/** Devices whose push token APNs reports as invalid; drop their registrations. */
	unregistered: ApnsTarget[];
}

type Outcome = "notified" | "failed" | "unregistered";

/**
 * Tells every device holding a pass to fetch its new version: one empty push
 * per distinct token, as concurrent streams on a single certificate-based
 * HTTP/2 connection that is closed before returning.
 */
export async function sendPassUpdates(
	targets: readonly ApnsTarget[],
	options: { cert: string; key: string; topic: string; origin?: string }
): Promise<ApnsResult> {
	const result: ApnsResult = { failed: 0, notified: 0, unregistered: [] };
	const byToken = new Map<string, ApnsTarget[]>();
	for (const target of targets) {
		// A token that isn't hex is invalid as surely as a BadDeviceToken reply,
		// and must never be spliced into the request path.
		if (!DEVICE_TOKEN_RE.test(target.pushToken)) {
			result.unregistered.push(target);
			continue;
		}
		const devices = byToken.get(target.pushToken);
		if (devices) {
			devices.push(target);
		} else {
			byToken.set(target.pushToken, [target]);
		}
	}
	if (byToken.size === 0) {
		return result;
	}

	const session = await openSession(options);
	let pushes: { devices: ApnsTarget[]; outcome: Outcome }[];
	try {
		pushes = await Promise.all(
			[...byToken].map(async ([token, devices]) => ({
				devices,
				outcome: await push(session, token, options.topic),
			}))
		);
	} catch (error) {
		session.destroy();
		throw error;
	}
	session.close();

	for (const { devices, outcome } of pushes) {
		if (outcome === "unregistered") {
			result.unregistered.push(...devices);
		} else {
			result[outcome] += devices.length;
		}
	}
	return result;
}

async function openSession(options: {
	cert: string;
	key: string;
	origin?: string;
}): Promise<ClientHttp2Session> {
	let session: ClientHttp2Session;
	try {
		// Certificate-based trust: the Pass Type ID certificate is the TLS
		// client certificate, so requests carry no authorization header.
		session = connect(options.origin ?? APNS_ORIGIN, {
			cert: options.cert,
			key: options.key,
		});
	} catch (cause) {
		throw pushFailed(undefined, cause);
	}
	// Promise.withResolvers needs Node 22; passlet supports Node 20.
	return await new Promise((resolve, reject) => {
		// After the session is ready this only tidies up: failures then reach
		// every open stream, and each stream settles its own push.
		const fail = (cause?: unknown) => {
			clearTimeout(timer);
			session.destroy();
			reject(pushFailed(undefined, cause));
		};
		const timer = setTimeout(
			fail,
			TIMEOUT_MS,
			new Error(`APNs did not accept a connection within ${TIMEOUT_MS} ms.`)
		);
		session.on("error", fail);
		session.once("close", () => fail(new Error("APNs closed the connection.")));
		// Wait for APNs's SETTINGS, not just the handshake: its stream limit
		// varies ("don't assume a specific number of streams"), and streams
		// opened before the limit is known get refused once it is.
		session.once("remoteSettings", () => {
			clearTimeout(timer);
			resolve(session);
		});
	});
}

function push(
	session: ClientHttp2Session,
	token: string,
	topic: string
): Promise<Outcome> {
	return new Promise((resolve, reject) => {
		// apns-topic is required ("Sending notification requests to APNs") and,
		// for Wallet, is the pass type identifier. No apns-push-type: Apple
		// defines none for passes and the value must match the payload.
		// Priority and expiration keep APNs defaults; Wallet docs specify none.
		const stream = session.request({
			":method": "POST",
			":path": `/3/device/${token}`,
			"apns-topic": topic,
		});
		let status: number | undefined;
		let body = "";
		let timedOut = false;
		let streamError: unknown;
		stream.setEncoding("utf8");
		stream.setTimeout(TIMEOUT_MS, () => {
			timedOut = true;
			stream.close(constants.NGHTTP2_CANCEL);
		});
		stream.on("response", (headers) => {
			status = headers[":status"];
		});
		stream.on("data", (chunk: string) => {
			if (body.length < MAX_ERROR_BODY) {
				body += chunk;
			}
		});
		stream.on("error", (cause) => {
			streamError = cause;
		});
		stream.on("close", () => {
			if (status === undefined) {
				// A push that APNs never answered is a failed delivery; a stream
				// torn down under us means the connection itself broke.
				if (timedOut) {
					resolve("failed");
				} else {
					reject(pushFailed(undefined, streamError));
				}
				return;
			}
			const reason = errorReason(body);
			if (status === 403) {
				// Certificate errors fail every push alike; surface them.
				reject(
					pushFailed(
						`APNs rejected the push certificate${reason ? ` (${reason})` : ""}.`
					)
				);
				return;
			}
			resolve(classify(status, reason));
		});
		stream.end("{}");
	});
}

// "Handling notification responses from APNs": 410 means the token is no
// longer active for the topic, and BadDeviceToken means it is invalid; Wallet
// says to delete the device for either. Everything else (429, 5xx, other 4xx)
// leaves the registration alone.
function classify(status: number, reason: string | undefined): Outcome {
	if (status === 200) {
		return "notified";
	}
	if (status === 410 || (status === 400 && reason === "BadDeviceToken")) {
		return "unregistered";
	}
	return "failed";
}

function errorReason(body: string): string | undefined {
	try {
		const { reason } = JSON.parse(body) as { reason?: unknown };
		// Only APNs's documented identifier shape reaches an error message.
		return typeof reason === "string" && REASON_RE.test(reason)
			? reason
			: undefined;
	} catch {
		return;
	}
}

function pushFailed(message?: string, cause?: unknown): WalletError {
	return new WalletError("APPLE_PUSH_FAILED", message, {
		cause: cause instanceof Error ? cause : undefined,
	});
}
