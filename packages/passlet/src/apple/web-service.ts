// biome-ignore lint/performance/noNamespaceImport: the namespace tree-shakes; zod/mini's named `z` export bundles all of zod.
import * as z from "zod/mini";
import type {
	LoadedPass,
	LoadPass,
	PassRegistrations,
} from "../schema/settings";
import { isAppleAuthToken } from "./auth-token";

export interface AppleWebServiceContext {
	load: LoadPass;
	onError?: (error: unknown, request: Request) => void;
	onLog?: (messages: string[]) => void;
	passTypeIdentifier: string;
	registrations: PassRegistrations;
	/** Render the latest .pkpass for a loaded pass. */
	renderPass(
		loaded: LoadedPass,
		serialNumber: string
	): Promise<Uint8Array<ArrayBuffer>>;
	secret: string;
}

// A PushToken body is one short hex string and a LogEntries body a handful of
// messages; anything bigger is not a device talking to us.
const REGISTER_BODY_LIMIT = 4 * 1024;
const LOG_BODY_LIMIT = 16 * 1024;

// Responses carry pass data, device registrations, and tokens: no cache, shared
// or private, may keep them.
const NO_STORE = { "cache-control": "no-store, private" };

// RFC 9110 §11.1: auth schemes are case-insensitive, and 1*SP separates the
// scheme from its credentials. Apple sends exactly "ApplePass <token>".
const AUTHORIZATION = /^ApplePass +(\S+)$/i;

// Apple's PushToken object. APNs device tokens are hex; rejecting anything
// else keeps request input from shaping the `/3/device/{pushToken}` path we
// later push to.
const PushToken = z.object({
	pushToken: z.string().check(z.regex(/^[0-9a-f]+$/i)),
});

// Apple's LogEntries object.
const LogEntries = z.object({ logs: z.array(z.string()) });

const DECIMAL = /^\d+$/;

type Route =
	| {
			kind: "registration";
			deviceLibraryIdentifier: string;
			passTypeIdentifier: string;
			serialNumber: string;
	  }
	| {
			kind: "list";
			deviceLibraryIdentifier: string;
			passTypeIdentifier: string;
	  }
	| { kind: "pass"; passTypeIdentifier: string; serialNumber: string }
	| { kind: "log" };

/**
 * The web service Apple Wallet calls to register devices for a pass and fetch
 * its updates, as documented in "Adding a Web Service to Update Passes" and its
 * five endpoint pages (https://developer.apple.com/documentation/walletpasses).
 *
 * Routes match the path from its last `/v1/...` suffix, so the handler works at
 * any mount point. Unknown routes and methods get 404; thrown errors from your
 * storage, `load`, or rendering go to `onError` and get a bare 500.
 */
export function createAppleWebService(
	context: AppleWebServiceContext
): (request: Request) => Promise<Response> {
	/** Whether the request's token authorizes this pass. */
	function authorize(
		request: Request,
		passTypeIdentifier: string,
		serialNumber: string
	): boolean {
		// Tokens are derived from our own pass type ID, so a pass of any other
		// type can't be ours and no token authorizes it.
		if (passTypeIdentifier !== context.passTypeIdentifier) {
			return false;
		}
		const token = AUTHORIZATION.exec(
			request.headers.get("authorization") ?? ""
		)?.[1];
		return (
			token !== undefined &&
			isAppleAuthToken(context.secret, passTypeIdentifier, serialNumber, token)
		);
	}

	async function register(
		request: Request,
		route: Extract<Route, { kind: "registration" }>
	): Promise<Response> {
		// Apple: check the token first; on mismatch return 401 and disregard
		// the request, so nothing reaches storage or even parses the body.
		if (!authorize(request, route.passTypeIdentifier, route.serialNumber)) {
			return respond(401);
		}
		const body = await readJson(request, REGISTER_BODY_LIMIT);
		if (body instanceof Response) {
			return body;
		}
		const parsed = PushToken.safeParse(body);
		if (!parsed.success) {
			return respond(400);
		}
		const created = await context.registrations.add({
			deviceLibraryIdentifier: route.deviceLibraryIdentifier,
			pushToken: parsed.data.pushToken,
			serialNumber: route.serialNumber,
		});
		return respond(created ? 201 : 200);
	}

	async function unregister(
		request: Request,
		route: Extract<Route, { kind: "registration" }>
	): Promise<Response> {
		if (!authorize(request, route.passTypeIdentifier, route.serialNumber)) {
			return respond(401);
		}
		await context.registrations.remove(
			route.deviceLibraryIdentifier,
			route.serialNumber
		);
		return respond(200);
	}

	async function list(
		url: URL,
		route: Extract<Route, { kind: "list" }>
	): Promise<Response> {
		// No token here: the device library ID is the shared secret (Apple).
		// We register no passes of any other type, so none of them can match.
		if (route.passTypeIdentifier !== context.passTypeIdentifier) {
			return respond(204);
		}
		// Our tags are `updatedAt` in epoch milliseconds. A missing tag, or one
		// we never issued, means "send everything", as on a device's first ask.
		const tag = url.searchParams.get("passesUpdatedSince");
		const since = tag !== null && DECIMAL.test(tag) ? Number(tag) : -1;
		const { registrations } = context;
		const device = route.deviceLibraryIdentifier;
		const passes: { serialNumber: string; updatedAt: Date | undefined }[] =
			registrations.updatablePasses
				? await registrations.updatablePasses(
						device,
						since < 0 ? undefined : new Date(since)
					)
				: await Promise.all(
						(await registrations.serialNumbers(device)).map(
							async (serialNumber) => ({
								serialNumber,
								updatedAt: (await context.load(serialNumber))?.updatedAt,
							})
						)
					);
		const serialNumbers: string[] = [];
		let lastUpdated = -1;
		// Filtered here too: an adapter may return every registered pass.
		for (const { serialNumber, updatedAt } of passes) {
			const updated = updatedAt?.getTime();
			if (updated !== undefined && updated > since) {
				serialNumbers.push(serialNumber);
				lastUpdated = Math.max(lastUpdated, updated);
			}
		}
		if (serialNumbers.length === 0) {
			return respond(204);
		}
		return respond(
			200,
			JSON.stringify({ lastUpdated: String(lastUpdated), serialNumbers }),
			{ "content-type": "application/json" }
		);
	}

	async function pass(
		request: Request,
		route: Extract<Route, { kind: "pass" }>
	): Promise<Response> {
		if (!authorize(request, route.passTypeIdentifier, route.serialNumber)) {
			return respond(401);
		}
		const loaded = await context.load(route.serialNumber);
		// Apple documents only 200 and 401 here. A pass your app no longer has
		// is one the token no longer authorizes, and 401 makes Wallet keep the
		// copy it holds.
		if (!loaded) {
			return respond(401);
		}
		const lastModified = loaded.updatedAt.toUTCString();
		// Archived Wallet Developer Guide ("Updating a Pass"; the current pages
		// are silent): support If-Modified-Since and answer 304 when unchanged.
		// HTTP dates have whole seconds, so compare at that precision.
		const since = Date.parse(request.headers.get("if-modified-since") ?? "");
		if (
			!Number.isNaN(since) &&
			Math.floor(loaded.updatedAt.getTime() / 1000) * 1000 <= since
		) {
			return respond(304, null, { "last-modified": lastModified });
		}
		const pkpass = await context.renderPass(loaded, route.serialNumber);
		return respond(200, pkpass, {
			"content-type": "application/vnd.apple.pkpass",
			"last-modified": lastModified,
		});
	}

	async function log(request: Request): Promise<Response> {
		const body = await readJson(request, LOG_BODY_LIMIT);
		if (body instanceof Response) {
			return body;
		}
		const parsed = LogEntries.safeParse(body);
		if (!parsed.success) {
			return respond(400);
		}
		context.onLog?.(parsed.data.logs);
		return respond(200);
	}

	async function dispatch(request: Request): Promise<Response> {
		const url = new URL(request.url);
		const route = matchRoute(url.pathname);
		const method = request.method;
		if (route?.kind === "registration" && method === "POST") {
			return await register(request, route);
		}
		if (route?.kind === "registration" && method === "DELETE") {
			return await unregister(request, route);
		}
		if (route?.kind === "list" && method === "GET") {
			return await list(url, route);
		}
		if (route?.kind === "pass" && method === "GET") {
			return await pass(request, route);
		}
		if (route?.kind === "log" && method === "POST") {
			return await log(request);
		}
		return respond(404);
	}

	return async (request) => {
		try {
			return await dispatch(request);
		} catch (error) {
			try {
				const reported: unknown = context.onError?.(error, request);
				// An async reporter's rejection must not go unhandled either.
				if (reported instanceof Promise) {
					reported.catch(() => undefined);
				}
			} catch {
				// Reporting must not change what the device gets.
			}
			// Error details can name storage internals; devices need none.
			return respond(500);
		}
	};
}

/**
 * Matches the path's `/v1/...` suffix, longest route first, decoding each
 * segment after splitting so an encoded `/` stays inside its segment.
 */
function matchRoute(pathname: string): Route | undefined {
	const parts = pathname.split("/");
	for (const length of [6, 5, 4, 2]) {
		// `>` keeps the leading empty segment out of the tail, so the suffix
		// always begins right after a "/".
		if (parts.length <= length) {
			continue;
		}
		const tail = decodeSegments(parts.slice(-length));
		if (tail?.[0] !== "v1") {
			continue;
		}
		const route = toRoute(tail);
		if (route) {
			return route;
		}
	}
}

function toRoute(tail: string[]): Route | undefined {
	const [, resource, a, b, c, d] = tail;
	if (tail.length === 2) {
		return resource === "log" ? { kind: "log" } : undefined;
	}
	if (tail.some((segment) => segment === "")) {
		return;
	}
	if (tail.length === 4 && resource === "passes" && a && b) {
		return { kind: "pass", passTypeIdentifier: a, serialNumber: b };
	}
	if (resource !== "devices" || b !== "registrations" || !a || !c) {
		return;
	}
	if (tail.length === 5) {
		return { deviceLibraryIdentifier: a, kind: "list", passTypeIdentifier: c };
	}
	if (tail.length === 6 && d) {
		// Same path for POST (register) and DELETE (unregister).
		return {
			deviceLibraryIdentifier: a,
			kind: "registration",
			passTypeIdentifier: c,
			serialNumber: d,
		};
	}
}

function decodeSegments(segments: string[]): string[] | undefined {
	try {
		return segments.map(decodeURIComponent);
	} catch {
		// Malformed percent-encoding names no route.
		return;
	}
}

function respond(
	status: number,
	body: BodyInit | null = null,
	headers: Record<string, string> = {}
): Response {
	return new Response(body, { headers: { ...NO_STORE, ...headers }, status });
}

/**
 * The parsed JSON body, or the response to send instead: 413 past `limit`
 * bytes, 400 when it isn't JSON. Apple documents neither (devices never send
 * such bodies), so these are plain HTTP semantics.
 */
async function readJson(
	request: Request,
	limit: number
): Promise<unknown | Response> {
	const declared = Number(request.headers.get("content-length"));
	if (declared > limit) {
		request.body?.cancel().catch(() => undefined);
		return respond(413);
	}
	const chunks: Uint8Array[] = [];
	let size = 0;
	if (request.body) {
		// Count streamed bytes too: Content-Length can be absent or a lie.
		for await (const chunk of request.body) {
			size += chunk.byteLength;
			if (size > limit) {
				return respond(413);
			}
			chunks.push(chunk);
		}
	}
	try {
		return JSON.parse(Buffer.concat(chunks).toString("utf8"));
	} catch {
		return respond(400);
	}
}
