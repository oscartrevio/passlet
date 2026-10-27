import { createSign } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { appleAuthTokens } from "../../../src/apple/auth-token";
import {
	APPLE_PASS_CONTENT_TYPE,
	type AppleCredentials,
	type AppleWebService,
	field,
	type LoadedPass,
	type PassRegistration,
	type PassTemplate,
	Wallet,
} from "../../../src/index";
import {
	appleCredentials,
	applePassAuthorization,
	appleWebService,
	ICON,
	memoryRegistrations,
	PASS_TYPE_IDENTIFIER,
	readPkpass,
	WEB_SERVICE_SECRET,
	WEB_SERVICE_URL,
} from "../../support/apple";

const BASE = `${WEB_SERVICE_URL}/v1`;
const DEVICE = "device-library-id";
const PUSH_TOKEN =
	"a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90";
const OTHER_SECRET = "another-secret-at-least-32-characters-long";

let credentials: AppleCredentials & { signerKey: string };

beforeAll(() => {
	credentials = appleCredentials();
});

afterEach(() => {
	vi.useRealTimers();
});

/** What `load` returns per serial number; tests change it as an app would. */
type Stored = Record<
	string,
	{ updatedAt: Date; content?: LoadedPass["content"] }
>;

/**
 * `wallet.handler` with a web service over memory registrations holding
 * `registered`, and a `load` serving `passes`.
 */
function setup(
	options: {
		apple?: AppleCredentials;
		passes?: Stored;
		registered?: PassRegistration[];
		webService?: Partial<AppleWebService>;
	} = {}
) {
	const passes = options.passes ?? {};
	const registrations = memoryRegistrations(options.registered);
	const onError = vi.fn();
	const onLog = vi.fn();
	let template: PassTemplate | undefined;
	const load = vi.fn((serialNumber: string): LoadedPass | null => {
		const stored = passes[serialNumber];
		return stored && template ? { content: {}, template, ...stored } : null;
	});
	const wallet = new Wallet({
		apple: {
			...(options.apple ?? credentials),
			webService: appleWebService({
				registrations,
				onError,
				onLog,
				...options.webService,
			}),
		},
		load,
	});
	template = wallet.loyalty({
		id: "rewards",
		name: "Acme Rewards",
		fields: [field.primary("points", "Points", "0")],
		apple: { icon: ICON },
	});
	return {
		handler: wallet.handler,
		load,
		onError,
		onLog,
		passes,
		registrations,
	};
}

function registerRequest(
	serialNumber: string,
	headers: Record<string, string>,
	body: BodyInit = JSON.stringify({ pushToken: PUSH_TOKEN })
): Request {
	return new Request(
		`${BASE}/devices/${DEVICE}/registrations/${PASS_TYPE_IDENTIFIER}/${serialNumber}`,
		{
			body,
			headers: { "content-type": "application/json", ...headers },
			method: "POST",
		}
	);
}

function passRequest(
	serialNumber: string,
	headers: Record<string, string> = applePassAuthorization(serialNumber)
): Request {
	return new Request(`${BASE}/passes/${PASS_TYPE_IDENTIFIER}/${serialNumber}`, {
		headers,
	});
}

function expectNoStore(response: Response): void {
	expect(response.headers.get("cache-control")).toBe("no-store, private");
}

describe("register a pass for update notifications", () => {
	it("creates a registration with 201, then answers 200 when it exists", async () => {
		const { handler, registrations } = setup();
		const first = await handler(
			registerRequest("SN-1", applePassAuthorization("SN-1"))
		);
		expect(first.status).toBe(201);
		expectNoStore(first);
		expect(registrations.rows()).toEqual([
			{
				deviceLibraryIdentifier: DEVICE,
				pushToken: PUSH_TOKEN,
				serialNumber: "SN-1",
			},
		]);
		const again = await handler(
			registerRequest("SN-1", applePassAuthorization("SN-1"))
		);
		expect(again.status).toBe(200);
	});

	it.each([
		["no header", {}],
		["another pass's token", applePassAuthorization("SN-2")],
		["another secret's token", applePassAuthorization("SN-1", OTHER_SECRET)],
		[
			"another scheme",
			{
				authorization: applePassAuthorization("SN-1").authorization.replace(
					"ApplePass",
					"Bearer"
				),
			},
		],
	])("rejects %s with 401 before touching storage", async (_, headers) => {
		const { handler, load, registrations } = setup();
		const response = await handler(registerRequest("SN-1", headers));
		expect(response.status).toBe(401);
		expect(await response.text()).toBe("");
		expect(registrations.add).not.toHaveBeenCalled();
		expect(load).not.toHaveBeenCalled();
	});

	it("rejects bad credentials before reading the body", async () => {
		const { handler } = setup();
		const response = await handler(
			registerRequest("SN-1", {}, "x".repeat(10_000))
		);
		expect(response.status).toBe(401);
	});

	it("rejects a pass type ID other than ours with 401, even with a matching token", async () => {
		const { handler, registrations } = setup();
		const other = "pass.com.example.other";
		const token = appleAuthTokens(WEB_SERVICE_SECRET, other).issue("SN-1");
		const response = await handler(
			new Request(`${BASE}/devices/${DEVICE}/registrations/${other}/SN-1`, {
				body: JSON.stringify({ pushToken: PUSH_TOKEN }),
				headers: { authorization: `ApplePass ${token}` },
				method: "POST",
			})
		);
		expect(response.status).toBe(401);
		expect(registrations.add).not.toHaveBeenCalled();
	});

	it("matches the auth scheme case-insensitively", async () => {
		const { handler } = setup();
		const { authorization } = applePassAuthorization("SN-1");
		const response = await handler(
			registerRequest("SN-1", {
				authorization: authorization.replace("ApplePass", "applepass"),
			})
		);
		expect(response.status).toBe(201);
	});

	it.each([
		["invalid JSON", "{"],
		["a missing push token", "{}"],
		["a non-hex push token", JSON.stringify({ pushToken: "../../evil" })],
		["a non-object body", "null"],
	])("answers 400 to %s", async (_, body) => {
		const { handler, registrations } = setup();
		const response = await handler(
			registerRequest("SN-1", applePassAuthorization("SN-1"), body)
		);
		expect(response.status).toBe(400);
		expect(registrations.add).not.toHaveBeenCalled();
	});

	it("answers 413 to a declared body over 4 KiB", async () => {
		const { handler, registrations } = setup();
		const body = JSON.stringify({ pushToken: "a".repeat(5000) });
		const response = await handler(
			registerRequest("SN-1", applePassAuthorization("SN-1"), body)
		);
		expect(response.status).toBe(413);
		expect(registrations.add).not.toHaveBeenCalled();
	});

	it("answers 413 to a streamed body over 4 KiB without a Content-Length", async () => {
		const { handler } = setup();
		const chunk = new TextEncoder().encode("a".repeat(1024));
		let sent = 0;
		const init: RequestInit & { duplex: "half" } = {
			body: new ReadableStream<Uint8Array>({
				pull(controller) {
					sent += 1;
					if (sent > 10) {
						controller.close();
					} else {
						controller.enqueue(chunk);
					}
				},
			}),
			duplex: "half",
			headers: applePassAuthorization("SN-1"),
			method: "POST",
		};
		const request = new Request(
			`${BASE}/devices/${DEVICE}/registrations/${PASS_TYPE_IDENTIFIER}/SN-1`,
			init
		);
		expect(request.headers.get("content-length")).toBeNull();
		const response = await handler(request);
		expect(response.status).toBe(413);
		// Stopped reading as soon as the cap was passed.
		expect(sent).toBeLessThan(10);
	});

	it("percent-decodes path segments", async () => {
		const { handler, registrations } = setup();
		const serial = "SN 1/é";
		const response = await handler(
			new Request(
				`${BASE}/devices/dev%20ice/registrations/${PASS_TYPE_IDENTIFIER}/${encodeURIComponent(serial)}`,
				{
					body: JSON.stringify({ pushToken: PUSH_TOKEN }),
					headers: applePassAuthorization(serial),
					method: "POST",
				}
			)
		);
		expect(response.status).toBe(201);
		expect(registrations.rows()).toEqual([
			{
				deviceLibraryIdentifier: "dev ice",
				pushToken: PUSH_TOKEN,
				serialNumber: serial,
			},
		]);
	});
});

describe("unregister a pass for update notifications", () => {
	const url = `${BASE}/devices/${DEVICE}/registrations/${PASS_TYPE_IDENTIFIER}/SN-1`;

	it("removes the registration with 200", async () => {
		const { handler, registrations } = setup({
			registered: [
				{
					deviceLibraryIdentifier: DEVICE,
					pushToken: PUSH_TOKEN,
					serialNumber: "SN-1",
				},
			],
		});
		const response = await handler(
			new Request(url, {
				headers: applePassAuthorization("SN-1"),
				method: "DELETE",
			})
		);
		expect(response.status).toBe(200);
		expectNoStore(response);
		expect(registrations.rows()).toEqual([]);
	});

	it("rejects a bad token with 401 before touching storage", async () => {
		const { handler, registrations } = setup();
		const response = await handler(
			new Request(url, {
				headers: applePassAuthorization("SN-2"),
				method: "DELETE",
			})
		);
		expect(response.status).toBe(401);
		expect(registrations.remove).not.toHaveBeenCalled();
	});
});

describe("get the list of updatable passes", () => {
	const NEWEST = new Date("2026-03-01T00:00:00.000Z");
	const stored = (): Stored => ({
		"SN-1": { updatedAt: new Date("2026-01-01T00:00:00.100Z") },
		"SN-2": { updatedAt: NEWEST },
		"SN-3": { updatedAt: new Date("2026-02-01T00:00:00.000Z") },
	});
	const registered = ["SN-1", "SN-2", "SN-3", "SN-gone"].map(
		(serialNumber) => ({
			deviceLibraryIdentifier: DEVICE,
			pushToken: PUSH_TOKEN,
			serialNumber,
		})
	);
	const listUrl = `${BASE}/devices/${DEVICE}/registrations/${PASS_TYPE_IDENTIFIER}`;

	/** The serial numbers and tag the device gets, given the tag it holds. */
	async function list(
		handler: (request: Request) => Promise<Response>,
		tag?: string
	): Promise<{ lastUpdated: string; serialNumbers: string[] } | null> {
		const response = await handler(
			new Request(
				tag === undefined
					? listUrl
					: `${listUrl}?passesUpdatedSince=${encodeURIComponent(tag)}`
			)
		);
		expectNoStore(response);
		if (response.status === 204) {
			expect(await response.text()).toBe("");
			return null;
		}
		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toBe("application/json");
		return await response.json();
	}

	// The tag is opaque: a device only sends back one the server issued.
	it("returns every registered pass with a tag, then only the passes updated since it", async () => {
		const { handler, passes } = setup({ passes: stored(), registered });

		const first = await list(handler);
		expect(first?.serialNumbers).toEqual(["SN-1", "SN-2", "SN-3"]);

		const SN3 = { updatedAt: new Date("2026-04-01T00:00:00.000Z") };
		passes["SN-3"] = SN3;
		const second = await list(handler, first?.lastUpdated);
		expect(second?.serialNumbers).toEqual(["SN-3"]);

		await expect(list(handler, second?.lastUpdated)).resolves.toBeNull();
	});

	it("tells apart updates a millisecond apart", async () => {
		const { handler, passes } = setup({ passes: stored(), registered });
		const first = await list(handler);

		passes["SN-1"] = { updatedAt: new Date(NEWEST.getTime() + 1) };
		await expect(list(handler, first?.lastUpdated)).resolves.toMatchObject({
			serialNumbers: ["SN-1"],
		});
	});

	it("returns everything for a tag it never issued", async () => {
		const { handler } = setup({ passes: stored(), registered });
		await expect(list(handler, "not-a-tag")).resolves.toMatchObject({
			serialNumbers: ["SN-1", "SN-2", "SN-3"],
		});
	});

	it("answers 204 to a device with no registrations", async () => {
		const { handler } = setup({ passes: stored(), registered });
		const response = await handler(
			new Request(
				`${BASE}/devices/other-device/registrations/${PASS_TYPE_IDENTIFIER}`
			)
		);
		expect(response.status).toBe(204);
		expectNoStore(response);
	});

	it("answers 204 to another pass type without touching storage", async () => {
		const { handler, registrations } = setup({ passes: stored(), registered });
		const response = await handler(
			new Request(`${BASE}/devices/${DEVICE}/registrations/pass.com.other`)
		);
		expect(response.status).toBe(204);
		expect(registrations.serialNumbers).not.toHaveBeenCalled();
	});

	it("answers from registrations.updatablePasses without loading any pass", async () => {
		const passes = stored();
		// Unfiltered on purpose: an adapter may skip the date filter.
		const updatablePasses = vi.fn(async () =>
			Object.entries(passes).map(([serialNumber, { updatedAt }]) => ({
				serialNumber,
				updatedAt,
			}))
		);
		const registrations = Object.assign(memoryRegistrations(registered), {
			updatablePasses,
		});
		const { handler, load } = setup({
			passes,
			webService: { registrations },
		});

		const first = await list(handler);
		expect(first?.serialNumbers).toEqual(["SN-1", "SN-2", "SN-3"]);
		// A device's first ask has no date.
		expect(updatablePasses).toHaveBeenLastCalledWith(DEVICE, undefined);

		// The tag it got back stands for the newest update it was sent.
		await expect(list(handler, first?.lastUpdated)).resolves.toBeNull();
		expect(updatablePasses).toHaveBeenLastCalledWith(DEVICE, NEWEST);
		expect(load).not.toHaveBeenCalled();
		expect(registrations.serialNumbers).not.toHaveBeenCalled();
	});
});

describe("send an updated pass", () => {
	const updatedAt = new Date("2026-05-01T12:00:00.750Z");
	const LAST_MODIFIED = "Fri, 01 May 2026 12:00:00 GMT";

	it("sends the pass as load describes it now, with the token it was issued", async () => {
		const { handler } = setup({
			passes: { "SN-1": { updatedAt, content: { values: { points: "250" } } } },
		});
		const response = await handler(passRequest("SN-1"));
		expect(response.status).toBe(200);
		expectNoStore(response);
		expect(response.headers.get("content-type")).toBe(APPLE_PASS_CONTENT_TYPE);
		expect(response.headers.get("last-modified")).toBe(LAST_MODIFIED);
		const body = new Uint8Array(await response.arrayBuffer());
		expect(response.headers.get("content-length")).toBe(
			String(body.byteLength)
		);
		const { passJson } = await readPkpass(body);
		expect(passJson).toMatchObject({
			serialNumber: "SN-1",
			authenticationToken: applePassAuthorization("SN-1").authorization.slice(
				"ApplePass ".length
			),
			storeCard: { primaryFields: [{ key: "points", value: "250" }] },
		});
	});

	it("rejects a bad token with 401 before loading", async () => {
		const { handler, load } = setup({ passes: { "SN-1": { updatedAt } } });
		const response = await handler(
			passRequest("SN-1", applePassAuthorization("SN-2"))
		);
		expect(response.status).toBe(401);
		expect(load).not.toHaveBeenCalled();
	});

	it("answers 401 for a pass the app no longer has", async () => {
		const { handler } = setup();
		const response = await handler(passRequest("SN-1"));
		expect(response.status).toBe(401);
		expect(await response.text()).toBe("");
	});

	it.each([
		["the same second", LAST_MODIFIED],
		["a later time", "Fri, 01 May 2026 13:00:00 GMT"],
	])("answers 304 to If-Modified-Since at %s", async (_, since) => {
		const { handler } = setup({ passes: { "SN-1": { updatedAt } } });
		const response = await handler(
			passRequest("SN-1", {
				...applePassAuthorization("SN-1"),
				"if-modified-since": since,
			})
		);
		expect(response.status).toBe(304);
		expectNoStore(response);
		expect(response.headers.get("last-modified")).toBe(LAST_MODIFIED);
		expect(await response.text()).toBe("");
	});

	it.each([
		["an earlier second", "Fri, 01 May 2026 11:59:59 GMT"],
		["an unparseable date", "yesterday-ish"],
	])("sends the pass for If-Modified-Since at %s", async (_, since) => {
		const { handler } = setup({ passes: { "SN-1": { updatedAt } } });
		const response = await handler(
			passRequest("SN-1", {
				...applePassAuthorization("SN-1"),
				"if-modified-since": since,
			})
		);
		expect(response.status).toBe(200);
	});

	it("checks the token before If-Modified-Since", async () => {
		const { handler, load } = setup({ passes: { "SN-1": { updatedAt } } });
		const response = await handler(
			passRequest("SN-1", {
				"if-modified-since": "Fri, 01 May 2026 13:00:00 GMT",
			})
		);
		expect(response.status).toBe(401);
		expect(load).not.toHaveBeenCalled();
	});

	// HTTP dates have whole seconds, so a date names every version stamped
	// within its second (RFC 9110 §8.8.2.2).
	it("sends no Last-Modified until its second is over, so a later change in that second still reaches the device", async () => {
		vi.useFakeTimers({ toFake: ["Date"] });
		const second = Date.parse("2026-05-01T12:00:10.000Z");
		const ifModifiedSince = {
			...applePassAuthorization("SN-1"),
			"if-modified-since": new Date(second).toUTCString(),
		};
		vi.setSystemTime(second + 100);
		const { handler, passes } = setup({
			passes: {
				"SN-1": {
					updatedAt: new Date(second + 100),
					content: { values: { points: "1" } },
				},
			},
		});

		const first = await handler(passRequest("SN-1"));
		expect(first.status).toBe(200);
		expect(first.headers.get("last-modified")).toBeNull();

		passes["SN-1"] = {
			updatedAt: new Date(second + 900),
			content: { values: { points: "2" } },
		};
		vi.setSystemTime(second + 950);
		const changed = await handler(passRequest("SN-1", ifModifiedSince));
		expect(changed.status).toBe(200);
		const { passJson } = await readPkpass(
			new Uint8Array(await changed.arrayBuffer())
		);
		expect(passJson).toMatchObject({
			storeCard: { primaryFields: [{ key: "points", value: "2" }] },
		});

		vi.setSystemTime(second + 1000);
		const settled = await handler(passRequest("SN-1", ifModifiedSince));
		expect(settled.status).toBe(304);
		expect(settled.headers.get("last-modified")).toBe(
			new Date(second).toUTCString()
		);
	});

	it("renders once for devices asking for the same version at once", async () => {
		const sign = vi.fn((signedAttributes: Uint8Array) =>
			createSign("sha256").update(signedAttributes).sign(credentials.signerKey)
		);
		const { signerKey: _, ...certificates } = credentials;
		const { handler } = setup({
			apple: { ...certificates, signer: { sign } },
			passes: { "SN-1": { updatedAt } },
			webService: {
				push: { cert: credentials.signerCert, key: credentials.signerKey },
			},
		});

		const [phone, watch] = await Promise.all([
			handler(passRequest("SN-1")),
			handler(passRequest("SN-1")),
		]);
		expect(sign).toHaveBeenCalledOnce();
		expect(
			Buffer.from(await phone.arrayBuffer()).equals(
				Buffer.from(await watch.arrayBuffer())
			)
		).toBe(true);

		// Nothing is kept once no request waits on it.
		await handler(passRequest("SN-1"));
		expect(sign).toHaveBeenCalledTimes(2);
	});
});

describe("log a message", () => {
	it("hands the messages to onLog", async () => {
		const { handler, onLog } = setup();
		const logs = [
			"Web service error for pass.com.example.loyalty (https://example.com): boom",
		];
		const response = await handler(
			new Request(`${BASE}/log`, {
				body: JSON.stringify({ logs }),
				method: "POST",
			})
		);
		expect(response.status).toBe(200);
		expectNoStore(response);
		expect(onLog).toHaveBeenCalledWith(logs);
	});

	it.each([
		["a missing logs array", "{}"],
		["non-string messages", JSON.stringify({ logs: [1] })],
	])("answers 400 to %s", async (_, body) => {
		const { handler, onLog } = setup();
		const response = await handler(
			new Request(`${BASE}/log`, { body, method: "POST" })
		);
		expect(response.status).toBe(400);
		expect(onLog).not.toHaveBeenCalled();
	});

	it("answers 413 past 16 KiB", async () => {
		const { handler, onLog } = setup();
		const response = await handler(
			new Request(`${BASE}/log`, {
				body: JSON.stringify({ logs: ["x".repeat(17 * 1024)] }),
				method: "POST",
			})
		);
		expect(response.status).toBe(413);
		expect(onLog).not.toHaveBeenCalled();
	});
});

describe("routing", () => {
	it.each([
		["GET", `${BASE}/log`],
		["GET", WEB_SERVICE_URL],
		["GET", `${BASE}/passes/${PASS_TYPE_IDENTIFIER}`],
		[
			"PUT",
			`${BASE}/devices/${DEVICE}/registrations/${PASS_TYPE_IDENTIFIER}/SN-1`,
		],
		["POST", `${BASE}/passes/${PASS_TYPE_IDENTIFIER}/SN-1`],
		[
			"DELETE",
			`${BASE}/devices/${DEVICE}/registrations/${PASS_TYPE_IDENTIFIER}`,
		],
		["GET", `${BASE}/passes/${PASS_TYPE_IDENTIFIER}/SN-1/extra`],
		["GET", `https://example.com/v2/passes/${PASS_TYPE_IDENTIFIER}/SN-1`],
		["GET", `${BASE}/passes/${PASS_TYPE_IDENTIFIER}/%E0%A4%A`],
		["GET", `${BASE}/passes//SN-1`],
	])("answers 404 to %s %s", async (method, url) => {
		const { handler, load, registrations } = setup();
		const response = await handler(new Request(url, { method }));
		expect(response.status).toBe(404);
		expectNoStore(response);
		expect(load).not.toHaveBeenCalled();
		expect(registrations.serialNumbers).not.toHaveBeenCalled();
	});

	it("routes at the root and under any prefix", async () => {
		const { handler } = setup({
			passes: { "SN-1": { updatedAt: new Date("2026-05-01T00:00:00Z") } },
		});
		for (const base of ["https://example.com", "https://example.com/a/v1/b"]) {
			const response = await handler(
				new Request(`${base}/v1/passes/${PASS_TYPE_IDENTIFIER}/SN-1`, {
					headers: applePassAuthorization("SN-1"),
				})
			);
			expect(response.status).toBe(200);
		}
	});
});

describe("failures", () => {
	const storage = new Error("database password hunter2");

	it.each([
		["load", "GET", `${BASE}/passes/${PASS_TYPE_IDENTIFIER}/SN-1`],
		[
			"registrations.add",
			"POST",
			`${BASE}/devices/${DEVICE}/registrations/${PASS_TYPE_IDENTIFIER}/SN-1`,
		],
		[
			"registrations.serialNumbers",
			"GET",
			`${BASE}/devices/${DEVICE}/registrations/${PASS_TYPE_IDENTIFIER}`,
		],
	])("answers a bare 500 when %s throws (%s %s), reporting the error to onError", async (_, method, url) => {
		const { handler, load, onError, registrations } = setup({
			passes: { "SN-1": { updatedAt: new Date("2026-05-01T00:00:00Z") } },
		});
		load.mockRejectedValue(storage);
		vi.mocked(registrations.add).mockRejectedValue(storage);
		vi.mocked(registrations.serialNumbers).mockRejectedValue(storage);
		const request = new Request(url, {
			body:
				method === "POST" ? JSON.stringify({ pushToken: PUSH_TOKEN }) : null,
			headers: applePassAuthorization("SN-1"),
			method,
		});
		const response = await handler(request);
		expect(response.status).toBe(500);
		expectNoStore(response);
		expect(await response.text()).toBe("");
		expect(onError).toHaveBeenCalledExactlyOnceWith(storage, request);
	});

	it("answers a bare 500 when the loaded content can't be rendered", async () => {
		const { handler, onError } = setup({
			passes: {
				"SN-1": {
					updatedAt: new Date("2026-05-01T00:00:00Z"),
					content: { expiresAt: "not-a-date" },
				},
			},
		});
		const response = await handler(passRequest("SN-1"));
		expect(response.status).toBe(500);
		expect(await response.text()).toBe("");
		expect(onError).toHaveBeenCalledExactlyOnceWith(
			expect.objectContaining({ code: "CREATE_CONFIG_INVALID" }),
			expect.any(Request)
		);
	});

	it.each([
		[
			"throws",
			() => {
				throw new Error("reporter down");
			},
		],
		["rejects", () => Promise.reject(new Error("reporter down"))],
	])("still answers 500 when onError %s", async (_, reporter) => {
		const { handler, load, onError } = setup();
		load.mockRejectedValue(new Error("database down"));
		onError.mockImplementation(reporter);
		const response = await handler(passRequest("SN-1"));
		expect(response.status).toBe(500);
		expect(onError).toHaveBeenCalledOnce();
	});
});
