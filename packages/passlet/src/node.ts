import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";

/**
 * Adapts `wallet.handler` to `node:http`, Express, and anything else that
 * takes `(req, res)`. Response headers are copied one value per name, which is
 * all `wallet.handler` sends; it never sets cookies.
 *
 * Under Express `app.use("/api/wallet", ...)`, `req.url` arrives without the
 * mount prefix; passlet routes by the path's suffix, so either form works.
 */
export function toNodeListener(
	handler: (request: Request) => Promise<Response>
): (req: IncomingMessage, res: ServerResponse) => void {
	return (req, res) => {
		respond(handler, req, res).catch(() => {
			// Headers already sent mid-body: all that's left is to cut it off.
			if (res.headersSent) {
				res.destroy();
				return;
			}
			res.statusCode = 500;
			res.end();
		});
	};
}

async function respond(
	handler: (request: Request) => Promise<Response>,
	req: IncomingMessage,
	res: ServerResponse
): Promise<void> {
	// Only a TLS socket has `encrypted`.
	const protocol = "encrypted" in req.socket ? "https" : "http";
	const url = new URL(
		req.url ?? "/",
		`${protocol}://${req.headers.host ?? "localhost"}`
	);
	const headers = new Headers();
	// rawHeaders keeps repeated headers that `req.headers` would merge or drop.
	for (let i = 0; i < req.rawHeaders.length; i += 2) {
		headers.append(
			req.rawHeaders[i] as string,
			req.rawHeaders[i + 1] as string
		);
	}
	const hasBody = req.method !== "GET" && req.method !== "HEAD";
	// The casts bridge node:stream/web's stream types and the DOM's, which
	// describe the same streams.
	const response = await handler(
		new Request(url, {
			body: hasBody
				? (Readable.toWeb(req) as ReadableStream<Uint8Array>)
				: null,
			// Required by Node's fetch for a streamed request body.
			duplex: "half",
			headers,
			method: req.method,
		} as RequestInit)
	);
	res.statusCode = response.status;
	for (const [name, value] of response.headers) {
		res.setHeader(name, value);
	}
	if (!response.body) {
		res.end();
		return;
	}
	// pipeline honours backpressure and ends `res` when the body is done.
	await pipeline(Readable.fromWeb(response.body as NodeReadableStream), res);
}
