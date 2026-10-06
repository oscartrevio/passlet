import { once } from "node:events";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { appleAuthToken } from "../../src/apple/auth-token";
import { createAppleWebService } from "../../src/apple/web-service";
import { toNodeListener } from "../../src/node";
import type { PassTemplate } from "../../src/template";

const PASS_TYPE = "pass.com.example.loyalty";
const SECRET = "current-secret-at-least-32-characters-long";
const PREFIX = "/api/wallet";
const PKPASS = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0xff, 0x00]);

let server: Server | undefined;

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
	strip: boolean
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

function webService() {
	const add = vi.fn(async () => true);
	const handler = createAppleWebService({
		load: () => ({
			content: { values: {} },
			template: {} as PassTemplate,
			updatedAt: new Date("2026-05-01T12:00:00Z"),
		}),
		passTypeIdentifier: PASS_TYPE,
		registrations: {
			add,
			devices: async () => [],
			remove: async () => undefined,
			serialNumbers: async () => [],
		},
		renderPass: async () => PKPASS,
		secret: SECRET,
	});
	return { add, handler };
}

const authorization = `ApplePass ${appleAuthToken(SECRET, PASS_TYPE, "SN-1")}`;

describe("toNodeListener", () => {
	it.each([
		["with the prefix stripped, as Express mounts it", true],
		["with the prefix still in req.url", false],
	])("serves the web service %s", async (_, strip) => {
		const { add, handler } = webService();
		const base = await serve(handler, strip);

		const registered = await fetch(
			`${base}/v1/devices/device-1/registrations/${PASS_TYPE}/SN-1`,
			{
				body: JSON.stringify({ pushToken: "abcdef0123" }),
				headers: { authorization, "content-type": "application/json" },
				method: "POST",
			}
		);
		expect(registered.status).toBe(201);
		expect(add).toHaveBeenCalledWith({
			deviceLibraryIdentifier: "device-1",
			pushToken: "abcdef0123",
			serialNumber: "SN-1",
		});

		const pass = await fetch(`${base}/v1/passes/${PASS_TYPE}/SN-1`, {
			headers: { authorization },
		});
		expect(pass.status).toBe(200);
		expect(pass.headers.get("content-type")).toBe(
			"application/vnd.apple.pkpass"
		);
		expect(pass.headers.get("cache-control")).toBe("no-store, private");
		expect(pass.headers.get("last-modified")).toBe(
			"Fri, 01 May 2026 12:00:00 GMT"
		);
		expect(new Uint8Array(await pass.arrayBuffer())).toEqual(PKPASS);

		const notModified = await fetch(`${base}/v1/passes/${PASS_TYPE}/SN-1`, {
			headers: {
				authorization,
				"if-modified-since": "Fri, 01 May 2026 12:00:00 GMT",
			},
		});
		expect(notModified.status).toBe(304);
	});

	it("passes the request's host and query through", async () => {
		const seen: string[] = [];
		const base = await serve((request) => {
			seen.push(request.url, request.headers.get("x-test") ?? "");
			return Promise.resolve(new Response("ok"));
		}, true);
		const response = await fetch(`${base}/v1/x?passesUpdatedSince=5`, {
			headers: { "x-test": "yes" },
		});
		expect(await response.text()).toBe("ok");
		expect(seen).toEqual([
			`${new URL(base).origin}/v1/x?passesUpdatedSince=5`,
			"yes",
		]);
	});

	it("answers 500 when the handler throws", async () => {
		const base = await serve(
			() => Promise.reject(new Error("secret detail")),
			false
		);
		const response = await fetch(`${base}/v1/log`);
		expect(response.status).toBe(500);
		expect(await response.text()).toBe("");
	});
});
