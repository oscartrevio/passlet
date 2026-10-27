import type { ClientHttp2Session } from "node:http2";
import type { PassRegistration } from "../config";
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
export const PUSH_TOKEN = /^[0-9a-f]+$/i;
const REASON_RE = /^[A-Za-z]{1,64}$/;

export type ApnsTarget = Omit<PassRegistration, "serialNumber">;

export interface ApnsResult {
	failed: number;
	notified: number;
	/** Devices whose push token APNs reports as invalid; drop their registrations. */
	unregistered: ApnsTarget[];
}

export interface ApnsOptions {
	cert: string;
	key: string;
	topic: string;
}

type Outcome = "notified" | "failed" | "unregistered";

interface Connection {
	/** Close the connection now, so later pushes open a new one. */
	retire(): void;
	session: ClientHttp2Session;
}

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
	// The current connection; cleared once it closes, fails to open, receives
	// GOAWAY or is retired by a push.
	#current: Promise<ClientHttp2Session> | undefined;

	constructor(options: ApnsOptions) {
		this.#options = options;
	}

	/**
	 * Tells every device holding a pass to fetch its new version: one empty
	 * push per distinct token, as concurrent streams on the client's connection.
	 * Every device holding a token APNs no longer accepts is `unregistered`.
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
			if (!PUSH_TOKEN.test(target.pushToken)) {
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
		const unanswered = await this.#pushAll(
			await this.#connect(),
			tokens,
			outcomes
		);
		if (unanswered.length === 0) {
			return outcomes;
		}
		let fresh: Connection;
		try {
			fresh = await this.#connect();
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
	 * `outcomes`. Resolves the tokens whose stream broke along with the
	 * connection before APNs answered, after retiring that connection.
	 */
	async #pushAll(
		{ session, retire }: Connection,
		tokens: string[],
		outcomes: Map<string, Outcome>
	): Promise<string[]> {
		const unanswered: string[] = [];
		let refused: unknown;
		await Promise.all(
			tokens.map(async (token) => {
				try {
					outcomes.set(
						token,
						await push(session, token, this.#options.topic, retire)
					);
				} catch (error) {
					if (error instanceof WalletError) {
						// A rejected certificate fails every push alike; surface it.
						refused = error;
					} else {
						unanswered.push(token);
					}
				}
			})
		);
		if (refused) {
			throw refused;
		}
		// A stream reset on a live connection is that push's failure alone.
		if (!(session.closed || session.destroyed)) {
			return [];
		}
		retire();
		return unanswered;
	}

	async #connect(): Promise<Connection> {
		this.#current ??= this.#open();
		const opening = this.#current;
		const session = await opening;
		return {
			session,
			// Synchronous, so the next push already opens a new connection
			// though the old one's "close" event comes later.
			retire: () => {
				if (this.#current === opening) {
					this.#current = undefined;
				}
				session.close();
			},
		};
	}

	#open(): Promise<ClientHttp2Session> {
		const opening = openSession(this.#options);
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
		return opening;
	}
}

async function openSession(options: {
	cert: string;
	key: string;
}): Promise<ClientHttp2Session> {
	let session: ClientHttp2Session;
	try {
		// Loaded on first push, so importing passlet works on runtimes without
		// node:http2 for everything except pushes.
		const { connect } = await import("node:http2");
		// Certificate-based trust: the Pass Type ID certificate is the TLS
		// client certificate, so requests carry no authorization header.
		session = connect(APNS_ORIGIN, { cert: options.cert, key: options.key });
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
			// Never keeps the process alive; each push's own timer does while
			// it is in flight.
			session.unref();
			resolve(session);
		});
	});
}

/**
 * One push. Rejects with `APPLE_PUSH_FAILED` when APNs refuses the
 * certificate, and with the stream's own error when the stream broke before
 * APNs answered. `retire` closes the connection for every later push.
 */
function push(
	session: ClientHttp2Session,
	token: string,
	topic: string,
	retire: () => void
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
		// A ref'd timer, unlike stream.setTimeout's: it also keeps the process
		// alive until APNs answers, while the idle connection itself doesn't.
		const timer = setTimeout(() => {
			timedOut = true;
			stream.close(NGHTTP2_CANCEL);
			// A stalled connection would stall every later update too; let the
			// streams still on it finish, and open a new one next time.
			retire();
		}, TIMEOUT_MS);
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
			clearTimeout(timer);
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
				retire();
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
