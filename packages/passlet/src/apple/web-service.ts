import type { LoadedPass, LoadPass, PassRegistrations } from "../config";
import { APPLE_PASS_CONTENT_TYPE } from "../output";
import { array, type Check, object, pattern, string } from "../schema/check";
import { PUSH_TOKEN } from "./apns";
import type { AppleAuthTokens } from "./auth-token";

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
	tokens: AppleAuthTokens;
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

// Apple's PushToken object. Rejecting a token APNs can't have issued keeps
// request input from shaping the `/3/device/{pushToken}` path we push to.
const PushToken = object<{ pushToken: string }>({
	pushToken: pattern(PUSH_TOKEN, "must be an APNs device token"),
});

// Apple's LogEntries object.
const LogEntries = object<{ logs: string[] }>({ logs: array(string) });

const DECIMAL = /^\d+$/;

// Apple's endpoint paths, matched at the end of the request path so the
// handler works at any mount point. Each group is one non-empty segment.
// "/v1/devices/{deviceLibraryIdentifier}/registrations/{passTypeIdentifier}/{serialNumber}"
const REGISTRATION = /\/v1\/devices\/([^/]+)\/registrations\/([^/]+)\/([^/]+)$/;
// "/v1/devices/{deviceLibraryIdentifier}/registrations/{passTypeIdentifier}"
const LIST = /\/v1\/devices\/([^/]+)\/registrations\/([^/]+)$/;
// "/v1/passes/{passTypeIdentifier}/{serialNumber}"
const PASS = /\/v1\/passes\/([^/]+)\/([^/]+)$/;
const LOG = /\/v1\/log$/;

/** Answers one route, given the request and its decoded path segments. */
type Handle = (request: Request, ...segments: string[]) => Promise<Response>;

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
	// Concurrent requests for one version of a pass, like a holder's iPhone and
	// Watch fetching it right after a push, share one render.
	const rendering = new Map<string, Promise<Uint8Array<ArrayBuffer>>>();

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
		return token !== undefined && context.tokens.verifies(serialNumber, token);
	}

	async function register(
		request: Request,
		deviceLibraryIdentifier: string,
		passTypeIdentifier: string,
		serialNumber: string
	): Promise<Response> {
		// Apple: check the token first; on mismatch return 401 and disregard
		// the request, so nothing reaches storage or even parses the body.
		if (!authorize(request, passTypeIdentifier, serialNumber)) {
			return respond(401);
		}
		const body = await readBody(request, REGISTER_BODY_LIMIT, PushToken);
		if (body instanceof Response) {
			return body;
		}
		const created = await context.registrations.add({
			deviceLibraryIdentifier,
			pushToken: body.pushToken,
			serialNumber,
		});
		return respond(created ? 201 : 200);
	}

	async function unregister(
		request: Request,
		deviceLibraryIdentifier: string,
		passTypeIdentifier: string,
		serialNumber: string
	): Promise<Response> {
		if (!authorize(request, passTypeIdentifier, serialNumber)) {
			return respond(401);
		}
		await context.registrations.remove(deviceLibraryIdentifier, serialNumber);
		return respond(200);
	}

	async function list(
		request: Request,
		deviceLibraryIdentifier: string,
		passTypeIdentifier: string
	): Promise<Response> {
		// No token here: the device library ID is the shared secret (Apple).
		// We register no passes of any other type, so none of them can match.
		if (passTypeIdentifier !== context.passTypeIdentifier) {
			return respond(204);
		}
		// Our tags are `updatedAt` in epoch milliseconds. A missing tag, or one
		// we never issued, means "send everything", as on a device's first ask.
		const tag = new URL(request.url).searchParams.get("passesUpdatedSince");
		const since = tag !== null && DECIMAL.test(tag) ? Number(tag) : -1;
		const { registrations } = context;
		const passes: { serialNumber: string; updatedAt: Date | undefined }[] =
			registrations.updatablePasses
				? await registrations.updatablePasses(
						deviceLibraryIdentifier,
						since < 0 ? undefined : new Date(since)
					)
				: await Promise.all(
						(await registrations.serialNumbers(deviceLibraryIdentifier)).map(
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
		passTypeIdentifier: string,
		serialNumber: string
	): Promise<Response> {
		if (!authorize(request, passTypeIdentifier, serialNumber)) {
			return respond(401);
		}
		const loaded = await context.load(serialNumber);
		// Apple documents only 200 and 401 here. A pass your app no longer has
		// is one the token no longer authorizes, and 401 makes Wallet keep the
		// copy it holds.
		if (!loaded) {
			return respond(401);
		}
		// Archived Wallet Developer Guide ("Updating a Pass"; the current pages
		// are silent): support If-Modified-Since and answer 304 when unchanged.
		// HTTP dates have whole seconds, so a date is only a validator once its
		// second is over: a change later in that second would carry the same
		// date and be answered 304 (RFC 9110 §8.8.2.2).
		const second = Math.floor(loaded.updatedAt.getTime() / 1000) * 1000;
		const validator =
			Date.now() >= second + 1000
				? { "last-modified": loaded.updatedAt.toUTCString() }
				: undefined;
		const since = Date.parse(request.headers.get("if-modified-since") ?? "");
		if (validator && second <= since) {
			return respond(304, null, validator);
		}
		const key = `${serialNumber}\0${loaded.updatedAt.getTime()}`;
		let pkpass = rendering.get(key);
		if (!pkpass) {
			pkpass = context
				.renderPass(loaded, serialNumber)
				.finally(() => rendering.delete(key));
			rendering.set(key, pkpass);
		}
		const bytes = await pkpass;
		return respond(200, bytes, {
			"content-type": APPLE_PASS_CONTENT_TYPE,
			"content-length": String(bytes.byteLength),
			...validator,
		});
	}

	async function log(request: Request): Promise<Response> {
		const body = await readBody(request, LOG_BODY_LIMIT, LogEntries);
		if (body instanceof Response) {
			return body;
		}
		context.onLog?.(body.logs);
		return respond(200);
	}

	// Segments are decoded after matching, so an encoded `/` stays inside one.
	const routes: [method: string, pattern: RegExp, handle: Handle][] = [
		["POST", REGISTRATION, register],
		["DELETE", REGISTRATION, unregister],
		["GET", LIST, list],
		["GET", PASS, pass],
		["POST", LOG, log],
	];

	async function dispatch(request: Request): Promise<Response> {
		const { pathname } = new URL(request.url);
		for (const [method, pattern, handle] of routes) {
			const match = request.method === method && pattern.exec(pathname);
			if (!match) {
				continue;
			}
			let segments: string[];
			try {
				segments = match.slice(1).map(decodeURIComponent);
			} catch {
				// Malformed percent-encoding names no pass or device.
				return respond(404);
			}
			return await handle(request, ...segments);
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

function respond(
	status: number,
	body: BodyInit | null = null,
	headers: Record<string, string> = {}
): Response {
	return new Response(body, { headers: { ...NO_STORE, ...headers }, status });
}

/**
 * The body parsed as JSON against `check`, or the response to send instead:
 * 413 past `limit` bytes, 400 when it isn't such JSON. Apple documents neither
 * (devices never send such bodies), so these are plain HTTP semantics.
 */
async function readBody<T>(
	request: Request,
	limit: number,
	check: Check<T>
): Promise<T | Response> {
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
	let json: unknown;
	try {
		json = JSON.parse(Buffer.concat(chunks).toString("utf8"));
	} catch {
		return respond(400);
	}
	const parsed = check(json);
	return parsed.ok ? parsed.value : respond(400);
}
