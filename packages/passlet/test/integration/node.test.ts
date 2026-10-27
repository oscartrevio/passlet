import { once } from "node:events";
import {
	type ClientRequest,
	createServer,
	request as httpRequest,
	type IncomingMessage,
	type Server,
	type ServerResponse,
} from "node:http";
import {
	createServer as createHttpsServer,
	request as httpsRequest,
} from "node:https";
import type { AddressInfo } from "node:net";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
	APPLE_PASS_CONTENT_TYPE,
	type AppleCredentials,
	type PassTemplate,
	Wallet,
} from "../../src/index";
import { toNodeListener } from "../../src/node";
import { selfSigned } from "../support/apns";
import {
	appleCredentials,
	applePassAuthorization,
	appleWebService,
	ICON,
	memoryRegistrations,
	PASS_TYPE_IDENTIFIER,
	readPkpass,
} from "../support/apple";

const PREFIX = "/api/wallet";

let credentials: AppleCredentials;
let server: Server | undefined;

beforeAll(() => {
	credentials = appleCredentials();
});

afterEach(async () => {
	server?.close();
	await (server && once(server, "close"));
	server = undefined;
});

/**
 * Serves the handler under PREFIX, stripping it from `req.url` like Express's
 * `app.use(prefix, listener)` does when `strip` is set.
 */
async function serve(
	handler: (request: Request) => Promise<Response>,
	strip = false
): Promise<string> {
	const listener = toNodeListener(handler);
	server = createServer((req, res) => {
		if (strip && req.url?.startsWith(PREFIX)) {
			req.url = req.url.slice(PREFIX.length) || "/";
		}
		listener(req, res);
	});
	server.listen(0, "127.0.0.1");
	await once(server, "listening");
	const { port } = server.address() as AddressInfo;
	return `http://127.0.0.1:${port}${PREFIX}`;
}

function responseOf(request: ClientRequest): Promise<IncomingMessage> {
	return new Promise((resolve, reject) => {
		request.once("response", resolve);
		request.once("error", reject);
	});
}

/** Sends raw header lines and body chunks, which `fetch` would normalize. */
async function send(
	url: string,
	options: {
		headers?: Record<string, string[]>;
		method?: string;
		chunks?: string[];
	}
): Promise<string> {
	const request = httpRequest(url, {
		method: options.method ?? "GET",
		headers: options.headers,
	});
	for (const chunk of options.chunks ?? []) {
		request.write(chunk);
		// Let each chunk leave on its own.
		await new Promise((resolve) => setImmediate(resolve));
	}
	request.end();
	const response = await responseOf(request);
	let body = "";
	for await (const chunk of response) {
		body += chunk;
	}
	return body;
}

describe("toNodeListener", () => {
	it.each([
		["with the prefix stripped, as Express mounts it", true],
		["with the prefix still in req.url", false],
	])("serves wallet.handler %s", async (_, strip) => {
		const registrations = memoryRegistrations();
		let template: PassTemplate | undefined;
		const wallet = new Wallet({
			apple: { ...credentials, webService: appleWebService({ registrations }) },
			load: () =>
				template
					? {
							content: {},
							template,
							updatedAt: new Date("2026-05-01T12:00:00Z"),
						}
					: null,
		});
		template = wallet.loyalty({
			id: "rewards",
			name: "Acme Rewards",
			fields: [],
			apple: { icon: ICON },
		});
		const base = await serve(wallet.handler, strip);
		const authorization = applePassAuthorization("SN-1");

		const registered = await fetch(
			`${base}/v1/devices/device-1/registrations/${PASS_TYPE_IDENTIFIER}/SN-1`,
			{
				body: JSON.stringify({ pushToken: "abcdef0123" }),
				headers: { ...authorization, "content-type": "application/json" },
				method: "POST",
			}
		);
		expect(registered.status).toBe(201);
		expect(registrations.rows()).toHaveLength(1);

		const pass = await fetch(`${base}/v1/passes/${PASS_TYPE_IDENTIFIER}/SN-1`, {
			headers: authorization,
		});
		expect(pass.status).toBe(200);
		expect(pass.headers.get("content-type")).toBe(APPLE_PASS_CONTENT_TYPE);
		const body = new Uint8Array(await pass.arrayBuffer());
		expect(pass.headers.get("content-length")).toBe(String(body.byteLength));
		expect((await readPkpass(body)).passJson.serialNumber).toBe("SN-1");
	});

	it("passes the request's host and query through", async () => {
		const seen: string[] = [];
		const base = await serve((request) => {
			seen.push(request.url);
			return Promise.resolve(new Response("ok"));
		}, true);
		const response = await fetch(`${base}/v1/x?passesUpdatedSince=5`);
		expect(await response.text()).toBe("ok");
		expect(seen).toEqual([`${new URL(base).origin}/v1/x?passesUpdatedSince=5`]);
	});

	// node:http joins most repeated headers but keeps only the first `From`.
	it("hands the handler every value of a repeated header", async () => {
		const base = await serve((request) =>
			Promise.resolve(
				Response.json([
					request.headers.get("from"),
					request.headers.get("x-test"),
				])
			)
		);
		const body = await send(`${base}/v1/x`, {
			// An array value goes out as one header line per entry.
			headers: {
				from: ["a@example.com", "b@example.com"],
				"x-test": ["1", "2"],
			},
		});
		expect(JSON.parse(body)).toEqual(["a@example.com, b@example.com", "1, 2"]);
	});

	it("streams the request body to the handler", async () => {
		const base = await serve(
			async (request) =>
				new Response(`${request.method} ${await request.text()}`)
		);
		const body = await send(`${base}/v1/log`, {
			method: "POST",
			chunks: ["first,", "second,", "third"],
		});
		expect(body).toBe("POST first,second,third");
	});

	it("answers 500 when the handler throws", async () => {
		const base = await serve(() => Promise.reject(new Error("secret detail")));
		const response = await fetch(`${base}/v1/log`);
		expect(response.status).toBe(500);
		expect(await response.text()).toBe("");
	});

	it("cuts the response off when its body fails after the headers went out", async () => {
		const base = await serve(() =>
			Promise.resolve(
				new Response(
					new ReadableStream({
						start(controller) {
							controller.enqueue(new TextEncoder().encode("partial"));
						},
						async pull(controller) {
							// Fails once "partial" and the headers are on the wire.
							await new Promise((resolve) => setTimeout(resolve, 20));
							controller.error(new Error("storage went away"));
						},
					})
				)
			)
		);
		const response = await fetch(`${base}/v1/x`);
		expect(response.status).toBe(200);
		await expect(response.text()).rejects.toThrow();
	});

	it("sees an https URL behind TLS", async () => {
		const identity = selfSigned("127.0.0.1");
		const seen: string[] = [];
		const listener = toNodeListener((request) => {
			seen.push(new URL(request.url).protocol);
			return Promise.resolve(new Response(null, { status: 204 }));
		});
		const tls = createHttpsServer(
			identity,
			(req: IncomingMessage, res: ServerResponse) => listener(req, res)
		);
		tls.listen(0, "127.0.0.1");
		await once(tls, "listening");
		const { port } = tls.address() as AddressInfo;
		const request = httpsRequest(`https://127.0.0.1:${port}/v1/x`, {
			ca: identity.cert,
		});
		request.end();
		const response = await responseOf(request);
		response.resume();
		tls.close();
		await once(tls, "close");

		expect(response.statusCode).toBe(204);
		expect(seen).toEqual(["https:"]);
	});
});
