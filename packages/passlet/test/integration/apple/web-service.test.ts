import { describe, expect, it, vi } from "vitest";
import { appleAuthToken } from "../../../src/apple/auth-token";
import { createAppleWebService } from "../../../src/apple/web-service";
import type {
	LoadedPass,
	PassRegistration,
	PassRegistrations,
} from "../../../src/schema/settings";
import type { PassTemplate } from "../../../src/template";

const PASS_TYPE = "pass.com.example.loyalty";
const SECRET = "current-secret-at-least-32-characters-long";
const BASE = "https://example.com/api/wallet/v1";
const DEVICE = "device-library-id";
const PUSH_TOKEN =
	"a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90";
const PKPASS = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]);

/** Registrations in memory, with every storage call spied. */
function memoryRegistrations(initial: PassRegistration[] = []) {
	const rows = new Map(
		initial.map((r) => [`${r.deviceLibraryIdentifier}\0${r.serialNumber}`, r])
	);
	return {
		add: vi.fn((r: PassRegistration) => {
			const key = `${r.deviceLibraryIdentifier}\0${r.serialNumber}`;
			const created = !rows.has(key);
			rows.set(key, r);
			return Promise.resolve(created);
		}),
		devices: vi.fn(async (serialNumber: string) =>
			[...rows.values()]
				.filter((r) => r.serialNumber === serialNumber)
				.map(({ deviceLibraryIdentifier, pushToken }) => ({
					deviceLibraryIdentifier,
					pushToken,
				}))
		),
		remove: vi.fn((deviceLibraryIdentifier: string, serialNumber: string) => {
			rows.delete(`${deviceLibraryIdentifier}\0${serialNumber}`);
			return Promise.resolve();
		}),
		rows,
		serialNumbers: vi.fn(async (deviceLibraryIdentifier: string) =>
			[...rows.values()]
				.filter((r) => r.deviceLibraryIdentifier === deviceLibraryIdentifier)
				.map((r) => r.serialNumber)
		),
	} satisfies PassRegistrations & { rows: unknown };
}

function loaded(updatedAt: string): LoadedPass {
	return {
		content: { values: {} } as LoadedPass["content"],
		template: {} as PassTemplate,
		updatedAt: new Date(updatedAt),
	};
}

function setup(
	passes: Record<string, LoadedPass> = {},
	initial: PassRegistration[] = []
) {
	const registrations = memoryRegistrations(initial);
	const load = vi.fn(
		async (serialNumber: string) => passes[serialNumber] ?? null
	);
	const renderPass = vi.fn(async () => PKPASS);
	const onError = vi.fn();
	const onLog = vi.fn();
	const handler = createAppleWebService({
		load,
		onError,
		onLog,
		passTypeIdentifier: PASS_TYPE,
		registrations,
		renderPass,
		secret: SECRET,
	});
	return { handler, load, onError, onLog, registrations, renderPass };
}

function auth(serialNumber: string, secret = SECRET): Record<string, string> {
	return {
		authorization: `ApplePass ${appleAuthToken(secret, PASS_TYPE, serialNumber)}`,
	};
}

function registerRequest(
	serialNumber: string,
	headers: Record<string, string>,
	body: BodyInit = JSON.stringify({ pushToken: PUSH_TOKEN })
): Request {
	return new Request(
		`${BASE}/devices/${DEVICE}/registrations/${PASS_TYPE}/${serialNumber}`,
		{
			body,
			headers: { "content-type": "application/json", ...headers },
			method: "POST",
		}
	);
}

function expectNoStore(response: Response): void {
	expect(response.headers.get("cache-control")).toBe("no-store, private");
}

describe("register a pass for update notifications", () => {
	it("creates a registration with 201, then answers 200 when it exists", async () => {
		const { handler, registrations } = setup();
		const first = await handler(registerRequest("SN-1", auth("SN-1")));
		expect(first.status).toBe(201);
		expectNoStore(first);
		expect(registrations.add).toHaveBeenCalledWith({
			deviceLibraryIdentifier: DEVICE,
			pushToken: PUSH_TOKEN,
			serialNumber: "SN-1",
		});
		const again = await handler(registerRequest("SN-1", auth("SN-1")));
		expect(again.status).toBe(200);
	});

	it.each([
		["no header", {}],
		["another pass's token", auth("SN-2")],
		[
			"another secret's token",
			auth("SN-1", "another-secret-at-least-32-characters-long"),
		],
		[
			"another scheme",
			{ authorization: `Bearer ${appleAuthToken(SECRET, PASS_TYPE, "SN-1")}` },
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
		const response = await handler(
			new Request(`${BASE}/devices/${DEVICE}/registrations/${other}/SN-1`, {
				body: JSON.stringify({ pushToken: PUSH_TOKEN }),
				headers: {
					authorization: `ApplePass ${appleAuthToken(SECRET, other, "SN-1")}`,
				},
				method: "POST",
			})
		);
		expect(response.status).toBe(401);
		expect(registrations.add).not.toHaveBeenCalled();
	});

	it("matches the auth scheme case-insensitively", async () => {
		const { handler } = setup();
		const token = appleAuthToken(SECRET, PASS_TYPE, "SN-1");
		const response = await handler(
			registerRequest("SN-1", { authorization: `applepass ${token}` })
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
		const response = await handler(registerRequest("SN-1", auth("SN-1"), body));
		expect(response.status).toBe(400);
		expect(registrations.add).not.toHaveBeenCalled();
	});

	it("answers 413 to a declared body over 4 KiB", async () => {
		const { handler, registrations } = setup();
		const body = JSON.stringify({ pushToken: "a".repeat(5000) });
		const response = await handler(registerRequest("SN-1", auth("SN-1"), body));
		expect(response.status).toBe(413);
		expect(registrations.add).not.toHaveBeenCalled();
	});

	it("answers 413 to a streamed body over 4 KiB without a Content-Length", async () => {
		const { handler } = setup();
		const chunk = new TextEncoder().encode("a".repeat(1024));
		let sent = 0;
		const stream = new ReadableStream<Uint8Array>({
			pull(controller) {
				sent += 1;
				if (sent > 10) {
					controller.close();
				} else {
					controller.enqueue(chunk);
				}
			},
		});
		const request = new Request(
			`${BASE}/devices/${DEVICE}/registrations/${PASS_TYPE}/SN-1`,
			{
				body: stream,
				duplex: "half",
				headers: auth("SN-1"),
				method: "POST",
			} as RequestInit
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
				`${BASE}/devices/dev%20ice/registrations/${PASS_TYPE}/${encodeURIComponent(serial)}`,
				{
					body: JSON.stringify({ pushToken: PUSH_TOKEN }),
					headers: auth(serial),
					method: "POST",
				}
			)
		);
		expect(response.status).toBe(201);
		expect(registrations.add).toHaveBeenCalledWith({
			deviceLibraryIdentifier: "dev ice",
			pushToken: PUSH_TOKEN,
			serialNumber: serial,
		});
	});
});

describe("unregister a pass for update notifications", () => {
	const url = `${BASE}/devices/${DEVICE}/registrations/${PASS_TYPE}/SN-1`;

	it("removes the registration with 200", async () => {
		const { handler, registrations } = setup({}, [
			{
				deviceLibraryIdentifier: DEVICE,
				pushToken: PUSH_TOKEN,
				serialNumber: "SN-1",
			},
		]);
		const response = await handler(
			new Request(url, { headers: auth("SN-1"), method: "DELETE" })
		);
		expect(response.status).toBe(200);
		expectNoStore(response);
		expect(registrations.remove).toHaveBeenCalledWith(DEVICE, "SN-1");
		expect(registrations.rows.size).toBe(0);
	});

	it("rejects a bad token with 401 before touching storage", async () => {
		const { handler, registrations } = setup();
		const response = await handler(
			new Request(url, { headers: auth("SN-2"), method: "DELETE" })
		);
		expect(response.status).toBe(401);
		expect(registrations.remove).not.toHaveBeenCalled();
	});
});

describe("get the list of updatable passes", () => {
	const passes = {
		"SN-1": loaded("2026-01-01T00:00:00.100Z"),
		"SN-2": loaded("2026-03-01T00:00:00.000Z"),
		"SN-3": loaded("2026-02-01T00:00:00.000Z"),
	};
	const registered = ["SN-1", "SN-2", "SN-3", "SN-gone"].map(
		(serialNumber) => ({
			deviceLibraryIdentifier: DEVICE,
			pushToken: PUSH_TOKEN,
			serialNumber,
		})
	);
	const listUrl = `${BASE}/devices/${DEVICE}/registrations/${PASS_TYPE}`;

	it("returns every registered pass and the newest tag when no tag is sent", async () => {
		const { handler } = setup(passes, registered);
		const response = await handler(new Request(listUrl));
		expect(response.status).toBe(200);
		expectNoStore(response);
		expect(response.headers.get("content-type")).toBe("application/json");
		expect(await response.json()).toEqual({
			lastUpdated: String(Date.parse("2026-03-01T00:00:00.000Z")),
			serialNumbers: ["SN-1", "SN-2", "SN-3"],
		});
	});

	it("returns only passes updated after the tag", async () => {
		const { handler } = setup(passes, registered);
		const tag = String(Date.parse("2026-01-15T00:00:00.000Z"));
		const response = await handler(
			new Request(`${listUrl}?passesUpdatedSince=${tag}`)
		);
		expect(await response.json()).toEqual({
			lastUpdated: String(Date.parse("2026-03-01T00:00:00.000Z")),
			serialNumbers: ["SN-2", "SN-3"],
		});
	});

	it("treats the tag as exclusive at millisecond precision", async () => {
		const { handler } = setup(passes, registered);
		const tag = String(Date.parse("2026-02-01T00:00:00.000Z"));
		const response = await handler(
			new Request(`${listUrl}?passesUpdatedSince=${tag}`)
		);
		expect(await response.json()).toEqual({
			lastUpdated: String(Date.parse("2026-03-01T00:00:00.000Z")),
			serialNumbers: ["SN-2"],
		});
	});

	it("round-trips its own lastUpdated into 204", async () => {
		const { handler } = setup(passes, registered);
		const first = (await (await handler(new Request(listUrl))).json()) as {
			lastUpdated: string;
		};
		const response = await handler(
			new Request(`${listUrl}?passesUpdatedSince=${first.lastUpdated}`)
		);
		expect(response.status).toBe(204);
		expect(await response.text()).toBe("");
	});

	it("returns everything for a tag it never issued", async () => {
		const { handler } = setup(passes, registered);
		const response = await handler(
			new Request(`${listUrl}?passesUpdatedSince=not-a-tag`)
		);
		expect(
			((await response.json()) as { serialNumbers: string[] }).serialNumbers
		).toEqual(["SN-1", "SN-2", "SN-3"]);
	});

	it("answers 204 to a device with no registrations", async () => {
		const { handler } = setup(passes, registered);
		const response = await handler(
			new Request(`${BASE}/devices/other-device/registrations/${PASS_TYPE}`)
		);
		expect(response.status).toBe(204);
		expectNoStore(response);
	});

	it("answers 204 to another pass type without touching storage", async () => {
		const { handler, registrations } = setup(passes, registered);
		const response = await handler(
			new Request(`${BASE}/devices/${DEVICE}/registrations/pass.com.other`)
		);
		expect(response.status).toBe(204);
		expect(registrations.serialNumbers).not.toHaveBeenCalled();
	});

	describe("with registrations.updatablePasses", () => {
		function withUpdatablePasses() {
			const context = setup(passes, registered);
			// Unfiltered on purpose: an adapter may skip the date filter.
			const updatablePasses = vi.fn(async () =>
				Object.entries(passes).map(([serialNumber, { updatedAt }]) => ({
					serialNumber,
					updatedAt,
				}))
			);
			Object.assign(context.registrations, { updatablePasses });
			return { ...context, updatablePasses };
		}

		it("answers from it without loading any pass", async () => {
			const { handler, load, registrations, updatablePasses } =
				withUpdatablePasses();
			const tag = String(Date.parse("2026-01-15T00:00:00.000Z"));
			const response = await handler(
				new Request(`${listUrl}?passesUpdatedSince=${tag}`)
			);

			expect(await response.json()).toEqual({
				lastUpdated: String(Date.parse("2026-03-01T00:00:00.000Z")),
				serialNumbers: ["SN-2", "SN-3"],
			});
			expect(updatablePasses).toHaveBeenCalledExactlyOnceWith(
				DEVICE,
				new Date(Number(tag))
			);
			expect(load).not.toHaveBeenCalled();
			expect(registrations.serialNumbers).not.toHaveBeenCalled();
		});

		it("passes no date on a device's first ask", async () => {
			const { handler, updatablePasses } = withUpdatablePasses();
			const response = await handler(new Request(listUrl));

			expect(await response.json()).toMatchObject({
				serialNumbers: ["SN-1", "SN-2", "SN-3"],
			});
			expect(updatablePasses).toHaveBeenCalledExactlyOnceWith(
				DEVICE,
				undefined
			);
		});
	});
});

describe("send an updated pass", () => {
	const passUrl = `${BASE}/passes/${PASS_TYPE}/SN-1`;
	const updatedAt = "2026-05-01T12:00:00.750Z";

	it("renders the latest pass", async () => {
		const { handler, renderPass } = setup({ "SN-1": loaded(updatedAt) });
		const response = await handler(
			new Request(passUrl, { headers: auth("SN-1") })
		);
		expect(response.status).toBe(200);
		expectNoStore(response);
		expect(response.headers.get("content-type")).toBe(
			"application/vnd.apple.pkpass"
		);
		expect(response.headers.get("last-modified")).toBe(
			"Fri, 01 May 2026 12:00:00 GMT"
		);
		expect(new Uint8Array(await response.arrayBuffer())).toEqual(PKPASS);
		expect(renderPass).toHaveBeenCalledWith(
			expect.objectContaining({ updatedAt: new Date(updatedAt) }),
			"SN-1"
		);
	});

	it("rejects a bad token with 401 before loading", async () => {
		const { handler, load, renderPass } = setup({ "SN-1": loaded(updatedAt) });
		const response = await handler(
			new Request(passUrl, { headers: auth("SN-2") })
		);
		expect(response.status).toBe(401);
		expect(load).not.toHaveBeenCalled();
		expect(renderPass).not.toHaveBeenCalled();
	});

	it("answers 401 for a pass the app no longer has", async () => {
		const { handler, renderPass } = setup();
		const response = await handler(
			new Request(passUrl, { headers: auth("SN-1") })
		);
		expect(response.status).toBe(401);
		expect(renderPass).not.toHaveBeenCalled();
	});

	it.each([
		["the same second", "Fri, 01 May 2026 12:00:00 GMT"],
		["a later time", "Fri, 01 May 2026 13:00:00 GMT"],
	])("answers 304 to If-Modified-Since at %s", async (_, since) => {
		const { handler, renderPass } = setup({ "SN-1": loaded(updatedAt) });
		const response = await handler(
			new Request(passUrl, {
				headers: { ...auth("SN-1"), "if-modified-since": since },
			})
		);
		expect(response.status).toBe(304);
		expectNoStore(response);
		expect(response.headers.get("last-modified")).toBe(
			"Fri, 01 May 2026 12:00:00 GMT"
		);
		expect(await response.text()).toBe("");
		expect(renderPass).not.toHaveBeenCalled();
	});

	it.each([
		["an earlier second", "Fri, 01 May 2026 11:59:59 GMT"],
		["an unparseable date", "yesterday-ish"],
	])("sends the pass for If-Modified-Since at %s", async (_, since) => {
		const { handler } = setup({ "SN-1": loaded(updatedAt) });
		const response = await handler(
			new Request(passUrl, {
				headers: { ...auth("SN-1"), "if-modified-since": since },
			})
		);
		expect(response.status).toBe(200);
	});

	it("checks the token before If-Modified-Since", async () => {
		const { handler, load } = setup({ "SN-1": loaded(updatedAt) });
		const response = await handler(
			new Request(passUrl, {
				headers: { "if-modified-since": "Fri, 01 May 2026 13:00:00 GMT" },
			})
		);
		expect(response.status).toBe(401);
		expect(load).not.toHaveBeenCalled();
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
		["GET", "https://example.com/api/wallet"],
		["GET", `${BASE}/passes/${PASS_TYPE}`],
		["PUT", `${BASE}/devices/${DEVICE}/registrations/${PASS_TYPE}/SN-1`],
		["POST", `${BASE}/passes/${PASS_TYPE}/SN-1`],
		["DELETE", `${BASE}/devices/${DEVICE}/registrations/${PASS_TYPE}`],
		["GET", `${BASE}/passes/${PASS_TYPE}/SN-1/extra`],
		["GET", `https://example.com/v2/passes/${PASS_TYPE}/SN-1`],
		["GET", `${BASE}/passes/${PASS_TYPE}/%E0%A4%A`],
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
		const { handler } = setup({ "SN-1": loaded("2026-05-01T00:00:00Z") });
		for (const base of ["https://example.com", "https://example.com/a/v1/b"]) {
			const response = await handler(
				new Request(`${base}/v1/passes/${PASS_TYPE}/SN-1`, {
					headers: auth("SN-1"),
				})
			);
			expect(response.status).toBe(200);
		}
	});
});

describe("failures", () => {
	it.each([
		["load", "GET", `${BASE}/passes/${PASS_TYPE}/SN-1`],
		["renderPass", "GET", `${BASE}/passes/${PASS_TYPE}/SN-1`],
		[
			"registrations",
			"POST",
			`${BASE}/devices/${DEVICE}/registrations/${PASS_TYPE}/SN-1`,
		],
		[
			"registrations",
			"GET",
			`${BASE}/devices/${DEVICE}/registrations/${PASS_TYPE}`,
		],
	])("answers a bare 500 when %s throws (%s %s), reporting the error to onError", async (source, method, url) => {
		const { handler, load, onError, registrations, renderPass } = setup({
			"SN-1": loaded("2026-05-01T00:00:00Z"),
		});
		const error = new Error(`database password hunter2 (${source})`);
		load.mockRejectedValue(source === "load" ? error : new Error("unused"));
		if (source !== "load") {
			load.mockResolvedValue(loaded("2026-05-01T00:00:00Z"));
		}
		renderPass.mockRejectedValue(error);
		registrations.add.mockRejectedValue(error);
		registrations.serialNumbers.mockRejectedValue(error);
		const request = new Request(url, {
			body:
				method === "POST" ? JSON.stringify({ pushToken: PUSH_TOKEN }) : null,
			headers: auth("SN-1"),
			method,
		});
		const response = await handler(request);
		expect(response.status).toBe(500);
		expectNoStore(response);
		expect(await response.text()).toBe("");
		expect(onError).toHaveBeenCalledExactlyOnceWith(error, request);
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
		const response = await handler(
			new Request(`${BASE}/passes/${PASS_TYPE}/SN-1`, { headers: auth("SN-1") })
		);
		expect(response.status).toBe(500);
		expect(onError).toHaveBeenCalledOnce();
	});
});
