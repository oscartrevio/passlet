import type { ClientHttp2Session } from "node:http2";
import { WalletError } from "../errors";

// Pass update pushes only work in production ("Adding a Web Service to Update
// Passes" > Send a Push Notification), so there is no sandbox switch.
const APNS_ORIGIN = "https://api.push.apple.com";
// Apple documents no response time. APNs answers each request once it accepts
// or rejects it; delivery to the device happens later. Ten seconds of silence
// means APNs is unreachable or stalled, and serverless functions (often capped
// at 10-60 s) must still get to return.
const TIMEOUT_MS = 10_000;
// "Reuse a connection as long as possible ... If your connection is mostly
// idle, you may send a HTTP2 PING frame after an hour of inactivity."
// https://developer.apple.com/documentation/usernotifications/sending-notification-requests-to-apns
// Closing after that hour instead keeps an unused connection from lingering.
const IDLE_TIMEOUT_MS = 60 * 60 * 1000;
// RFC 9113 §7 CANCEL: the stream is no longer needed. A literal, so loading
// passlet doesn't load node:http2 for its constants.
const NGHTTP2_CANCEL = 0x8;
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

export interface ApnsOptions {
	cert: string;
	key: string;
	origin?: string;
	topic: string;
}

type Outcome = "notified" | "failed" | "unregistered";

/**
 * Sends pass update pushes over one certificate-based HTTP/2 connection to
 * APNs, opened on the first push and kept for later ones. "If your provider
 * server opens and closes its connection to APNs repeatedly, APNs may treat it
 * as a denial-of-service attack and temporarily block your server."
 * https://developer.apple.com/documentation/usernotifications/establishing-a-connection-to-apns
 *
 * An idle connection never keeps the process alive, and closes itself after an
 * hour.
 */
export class ApnsClient {
	readonly #options: ApnsOptions;
	readonly #origin: string;
	// The promise of the current connection; cleared once that connection
	// closes, fails to open, or receives GOAWAY.
	#current: Promise<ClientHttp2Session> | undefined;
	// Pushes in flight per connection, so an old connection still draining
	// keeps its own count.
	readonly #inFlight = new WeakMap<ClientHttp2Session, number>();

	constructor(options: ApnsOptions) {
		this.#options = options;
		this.#origin = options.origin ?? APNS_ORIGIN;
	}

	/**
	 * Tells every device holding a pass to fetch its new version: one empty
	 * push per distinct token, as concurrent streams on the client's connection.
	 *
	 * @throws {WalletError} `APPLE_PUSH_FAILED` when APNs rejects the
	 * certificate, or when no push could be sent at all.
	 */
	async send(targets: readonly ApnsTarget[]): Promise<ApnsResult> {
		const result: ApnsResult = { failed: 0, notified: 0, unregistered: [] };
		const byToken = new Map<string, ApnsTarget[]>();
		for (const target of targets) {
			// A token that isn't hex is invalid as surely as a BadDeviceToken
			// reply, and must never be spliced into the request path.
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

		const outcomes = await this.#deliver([...byToken.keys()]);

		for (const [token, devices] of byToken) {
			const outcome = outcomes.get(token) ?? "failed";
			if (outcome === "unregistered") {
				result.unregistered.push(...devices);
			} else {
				result[outcome] += devices.length;
			}
		}
		return result;
	}

	/**
	 * Each answered push's outcome, by token. If the connection dies
	 * mid-batch, the pushes it took down are retried once on a new connection;
	 * any still unanswered get no outcome, so they count as failed.
	 */
	async #deliver(tokens: string[]): Promise<Map<string, Outcome>> {
		const outcomes = new Map<string, Outcome>();
		const session = await this.#connection();
		const unanswered = await this.#pushAll(session, tokens, outcomes);
		if (unanswered.length === 0 || !isClosed(session)) {
			return outcomes;
		}
		let fresh: ClientHttp2Session;
		try {
			fresh = await this.#connection();
		} catch (error) {
			// With nothing delivered there is no partial result to return.
			if (outcomes.size === 0) {
				throw error;
			}
			return outcomes;
		}
		await this.#pushAll(fresh, unanswered, outcomes);
		return outcomes;
	}

	/**
	 * Push to every token on one connection, recording each answered push in
	 * `outcomes`. Resolves the tokens whose stream broke before APNs answered.
	 */
	async #pushAll(
		session: ClientHttp2Session,
		tokens: string[],
		outcomes: Map<string, Outcome>
	): Promise<string[]> {
		this.#hold(session);
		let settled: PromiseSettledResult<Outcome>[];
		try {
			settled = await Promise.allSettled(
				tokens.map((token) => push(session, token, this.#options.topic))
			);
		} finally {
			this.#release(session);
		}
		const unanswered: string[] = [];
		for (const [index, push] of settled.entries()) {
			const token = tokens[index] as string;
			if (push.status === "fulfilled") {
				outcomes.set(token, push.value);
			} else if (push.reason instanceof WalletError) {
				// A rejected certificate fails every push alike; surface it.
				throw push.reason;
			} else {
				unanswered.push(token);
			}
		}
		return unanswered;
	}

	/** The open connection, opening one if there is none. */
	async #connection(): Promise<ClientHttp2Session> {
		// The current connection can be closing (closed is set at once, its
		// "close" event fires later). Re-read it after every await: another
		// caller may already have replaced it, and that replacement is the one
		// to share.
		for (let cached = this.#current; cached; cached = this.#current) {
			const session = await cached;
			if (!isClosed(session)) {
				return session;
			}
			if (this.#current === cached) {
				this.#current = undefined;
			}
		}
		const opening = openSession(this.#origin, this.#options);
		this.#current = opening;
		const forget = () => {
			if (this.#current === opening) {
				this.#current = undefined;
			}
		};
		opening.then((session) => {
			session.once("close", forget);
			// APNs ends connections with GOAWAY; no new stream may use it.
			session.once("goaway", forget);
		}, forget);
		return await opening;
	}

	#hold(session: ClientHttp2Session): void {
		const count = this.#inFlight.get(session) ?? 0;
		if (count === 0) {
			session.ref();
		}
		this.#inFlight.set(session, count + 1);
	}

	#release(session: ClientHttp2Session): void {
		const count = (this.#inFlight.get(session) ?? 1) - 1;
		this.#inFlight.set(session, count);
		if (count === 0) {
			session.unref();
		}
	}
}

function isClosed(session: ClientHttp2Session): boolean {
	return session.closed || session.destroyed;
}

async function openSession(
	origin: string,
	options: { cert: string; key: string }
): Promise<ClientHttp2Session> {
	let session: ClientHttp2Session;
	try {
		// Loaded on first push, so importing passlet works on runtimes without
		// node:http2 for everything except pushes.
		const { connect } = await import("node:http2");
		// Certificate-based trust: the Pass Type ID certificate is the TLS
		// client certificate, so requests carry no authorization header.
		session = connect(origin, { cert: options.cert, key: options.key });
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
			session.setTimeout(IDLE_TIMEOUT_MS, () => session.close());
			// Idle until a push holds it.
			session.unref();
			resolve(session);
		});
	});
}

/**
 * One push. Rejects with `APPLE_PUSH_FAILED` when APNs refuses the
 * certificate, and with the stream's own error when the stream broke before
 * APNs answered.
 */
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
			stream.close(NGHTTP2_CANCEL);
			// A stalled connection would stall every later update too; let the
			// streams still on it finish, and open a new one next time.
			session.close();
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
				// torn down under us means the connection itself may have broken.
				if (timedOut) {
					resolve("failed");
				} else {
					reject(
						streamError ?? new Error("APNs closed the stream unanswered.")
					);
				}
				return;
			}
			const reason = errorReason(body);
			if (status === 403) {
				// "If you experience a revoked provider certificate ... close all
				// connections to APNs, fix the problem, and then open new
				// connections." (Sending notification requests to APNs)
				session.close();
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
// https://developer.apple.com/documentation/usernotifications/handling-notification-responses-from-apns
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
