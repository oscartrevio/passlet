// A local stand-in for APNs over HTTP/2 with TLS client certificates. Tests
// redirect `node:http2`'s `connect` to it with:
//
//   const apnsRoute = vi.hoisted(() => ({ ca: "", ciphers: "", origin: "" }));
//   vi.mock("node:http2", async (importOriginal) => {
//     const http2 = await importOriginal<typeof Http2>();
//     return { ...http2, connect: (_: string, options: SecureClientSessionOptions) =>
//       http2.connect(apnsRoute.origin, { ...options, ...apnsRoute }) };
//   });
//
// and point `apnsRoute` at a server from `startApns`.
import { once } from "node:events";
import {
	createSecureServer,
	type IncomingHttpHeaders,
	type ServerHttp2Session,
	type ServerHttp2Stream,
} from "node:http2";
import type { AddressInfo } from "node:net";
import type { TLSSocket } from "node:tls";
import { createSelfSigned, type SelfSigned } from "./x509";

export interface ReceivedPush {
	body: string;
	/** Common name of the TLS client certificate the push came with. */
	clientCertificate: string;
	headers: IncomingHttpHeaders;
}

/**
 * APNs reply per device token: status plus the error `reason`, if any,
 * `"drop"` to tear down the connection without answering, `"goaway"` to
 * answer and then end the connection the way APNs does, or `"hold"` to leave
 * the push unanswered until `release()`.
 */
export type Reply =
	| [status: number, reason?: string]
	| "drop"
	| "goaway"
	| "hold";

/** Where the redirected `connect` goes, and the TLS settings it needs there. */
export interface ApnsRoute {
	ca: string;
	ciphers: string;
	origin: string;
}

// The generated Pass Type ID chain uses 1024-bit keys, which OpenSSL's default
// security level refuses for TLS.
const CIPHERS = "DEFAULT@SECLEVEL=0";

export interface ApnsStandIn {
	close(): Promise<void>;
	origin: string;
	received: ReceivedPush[];
	/** Answers every push held so far with 200. */
	release(): void;
	/** Replies by device token; unlisted tokens get 200. */
	replies: Map<string, Reply>;
	/** Every connection the stand-in accepted. */
	sessions: ServerHttp2Session[];
}

/** A certificate valid for a server or client at 127.0.0.1. */
export function selfSigned(commonName: string): SelfSigned {
	return createSelfSigned({
		commonName,
		notBefore: new Date(Date.now() - 60_000),
		notAfter: new Date(Date.now() + 24 * 60 * 60 * 1000),
		subjectAltNameIp: "127.0.0.1",
	});
}

const serverIdentity = selfSigned("apns.test");

/**
 * Starts a stand-in that, like APNs, refuses any client whose certificate
 * `clientCa` didn't issue, and points `route` at it. Its listening and
 * accepted sockets never keep the process alive, so whatever does belongs to
 * the client.
 */
export async function startApns(
	route: ApnsRoute,
	clientCa: string
): Promise<ApnsStandIn> {
	const replies = new Map<string, Reply>();
	const received: ReceivedPush[] = [];
	const sessions: ServerHttp2Session[] = [];
	const held: ServerHttp2Stream[] = [];
	const server = createSecureServer({
		...serverIdentity,
		ca: clientCa,
		ciphers: CIPHERS,
		requestCert: true,
		rejectUnauthorized: true,
		// Apple: "don't assume a specific number of streams". A limit of one
		// makes every multi-token push queue behind it.
		settings: { maxConcurrentStreams: 1 },
	});
	server.on("secureConnection", (socket) => {
		socket.unref();
	});
	server.on("session", (session) => {
		sessions.push(session);
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
			const reply = replies.get(token) ?? [200];
			if (reply === "hold") {
				held.push(stream);
				return;
			}
			if (reply === "drop") {
				stream.session?.destroy();
				return;
			}
			if (reply === "goaway") {
				// Streams already open finish, new ones are refused.
				stream.respond({ ":status": 200 }, { endStream: true });
				stream.session?.close();
				return;
			}
			const [status, reason] = reply;
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
	server.unref();
	const { port } = server.address() as AddressInfo;
	const origin = `https://127.0.0.1:${port}`;
	route.ca = serverIdentity.cert;
	route.ciphers = CIPHERS;
	route.origin = origin;
	return {
		async close() {
			for (const session of sessions) {
				session.destroy();
			}
			server.close();
			await once(server, "close");
		},
		origin,
		received,
		release() {
			for (const stream of held.splice(0)) {
				stream.respond({ ":status": 200 }, { endStream: true });
			}
		},
		replies,
		sessions,
	};
}
