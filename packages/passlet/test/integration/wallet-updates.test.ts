import { beforeAll, describe, expect, it, vi } from "vitest";
import {
	APPLE_PASS_CONTENT_TYPE,
	type AppleCredentials,
	field,
	type LoadedPass,
	type PassTemplate,
	Wallet,
	type WalletConfig,
} from "../../src/index";
import {
	appleCredentials,
	ICON,
	type MemoryRegistrations,
	memoryRegistrations,
	PASS_TYPE_IDENTIFIER,
	readPkpass,
} from "../support/apple";
import {
	existingClasses,
	googleCredentials,
	ISSUER_ID,
	LOGO_URL,
	stubGoogleFetch,
} from "../support/google";

const URL_BASE = "https://example.com/api/wallet";
const SECRET = "s".repeat(32);
const SERIAL = "member-123";
const TEMPLATE = {
	id: "rewards",
	name: "Acme Rewards",
	fields: [field.primary("points", "Points")],
	apple: { icon: ICON },
	google: { logo: LOGO_URL },
};

let apple: AppleCredentials & { signerKey: string };

beforeAll(() => {
	apple = appleCredentials();
});

/**
 * A wallet whose load serves one member whose points live in `points`, so a
 * test can change them the way an app would change its database.
 */
function setup(
	options: { google?: boolean; registrations?: MemoryRegistrations } = {}
) {
	const registrations = options.registrations ?? memoryRegistrations();
	const state = { points: "100", updatedAt: new Date("2026-01-01T00:00:00Z") };
	let template: PassTemplate | undefined;
	const config: WalletConfig = {
		apple: {
			...apple,
			webService: {
				url: URL_BASE,
				secret: SECRET,
				registrations,
			},
		},
		...(options.google && { google: googleCredentials() }),
		load: (serialNumber): LoadedPass | null =>
			serialNumber === SERIAL && template
				? {
						content: { values: { points: state.points } },
						template,
						updatedAt: state.updatedAt,
					}
				: null,
	};
	const wallet = new Wallet(config);
	template = wallet.loyalty(TEMPLATE);
	return { registrations, state, template, wallet };
}

function passRequest(token: string, serialNumber = SERIAL): Request {
	return new Request(
		`${URL_BASE}/v1/passes/${PASS_TYPE_IDENTIFIER}/${serialNumber}`,
		{ headers: { authorization: `ApplePass ${token}` } }
	);
}

function registerRequest(token: string, serialNumber = SERIAL): Request {
	return new Request(
		`${URL_BASE}/v1/devices/device-1/registrations/${PASS_TYPE_IDENTIFIER}/${serialNumber}`,
		{
			method: "POST",
			headers: {
				authorization: `ApplePass ${token}`,
				"content-type": "application/json",
			},
			body: JSON.stringify({ pushToken: "abcdef0123" }),
		}
	);
}

async function issuedPassJson(
	template: PassTemplate
): Promise<{ authenticationToken: string; webServiceURL: string }> {
	const issued = await template.create({
		serialNumber: SERIAL,
		values: { points: "100" },
	});
	if (!issued.apple) {
		throw new Error("no .pkpass issued");
	}
	const { passJson } = await readPkpass(issued.apple);
	return passJson as { authenticationToken: string; webServiceURL: string };
}

describe("create() with apple.webService", () => {
	it("embeds a per-pass token that the handler accepts end to end", async () => {
		const { registrations, state, template, wallet } = setup();
		const { authenticationToken, webServiceURL } =
			await issuedPassJson(template);
		expect(webServiceURL).toBe(URL_BASE);

		const register = await wallet.handler(registerRequest(authenticationToken));
		expect(register.status).toBe(201);
		expect(registrations.rows()).toEqual([
			{
				deviceLibraryIdentifier: "device-1",
				pushToken: "abcdef0123",
				serialNumber: SERIAL,
			},
		]);

		// The device downloads the pass as load describes it now, under the
		// same token it already holds.
		state.points = "250";
		const response = await wallet.handler(passRequest(authenticationToken));
		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toBe(APPLE_PASS_CONTENT_TYPE);
		const { passJson } = await readPkpass(
			new Uint8Array(await response.arrayBuffer())
		);
		expect(passJson).toMatchObject({
			serialNumber: SERIAL,
			authenticationToken,
			webServiceURL: URL_BASE,
			storeCard: { primaryFields: [{ key: "points", value: "250" }] },
		});
	});

	it("gives every pass its own token", async () => {
		const { registrations, template, wallet } = setup();
		const { authenticationToken } = await issuedPassJson(template);
		const other = await wallet.handler(
			registerRequest(authenticationToken, "member-456")
		);
		expect(other.status).toBe(401);
		expect(registrations.rows()).toEqual([]);
	});

	it("re-renders a pass with the token it was issued with", async () => {
		const { template, wallet } = setup();
		const { authenticationToken } = await issuedPassJson(template);

		const response = await wallet.handler(passRequest(authenticationToken));
		expect(response.status).toBe(200);
		// Apple forbids changing the token in an update.
		const { passJson } = await readPkpass(
			new Uint8Array(await response.arrayBuffer())
		);
		expect(passJson.authenticationToken).toBe(authenticationToken);
	});
});

describe("wallet.update", () => {
	// With no device registered, no push is sent; Apple's push itself is
	// covered by the Apple provider's tests.
	it("updates Google with notify and reports the Apple devices notified", async () => {
		const stub = stubGoogleFetch(existingClasses);
		const { state, wallet } = setup({ google: true });
		state.points = "250";

		await expect(wallet.update(SERIAL, { notify: true })).resolves.toEqual({
			apple: { notified: 0, failed: 0, removed: 0 },
			google: "updated",
		});

		expect(stub.requests).toEqual([
			expect.objectContaining({
				method: "GET",
				path: `/loyaltyClass/${ISSUER_ID}.${TEMPLATE.id}`,
			}),
			expect.objectContaining({
				method: "PATCH",
				path: `/loyaltyObject/${ISSUER_ID}.${SERIAL}`,
				body: expect.objectContaining({
					notifyPreference: "NOTIFY_ON_UPDATE",
					loyaltyPoints: expect.objectContaining({
						balance: { string: "250" },
					}),
				}),
			}),
		]);
	});

	// update() may run before any pass was issued from the template, so
	// neither the class nor the object exists on Google yet.
	it("creates the missing Google class, then inserts the object", async () => {
		const stub = stubGoogleFetch((request) =>
			request.method === "PATCH" ? new Response("", { status: 404 }) : undefined
		);
		const { wallet } = setup({ google: true });
		const classId = `${ISSUER_ID}.${TEMPLATE.id}`;
		const objectId = `${ISSUER_ID}.${SERIAL}`;

		await expect(wallet.update(SERIAL)).resolves.toEqual({
			apple: { notified: 0, failed: 0, removed: 0 },
			google: "created",
		});
		expect(stub.requests.map((r) => [r.method, r.path])).toEqual([
			["GET", `/loyaltyClass/${classId}`],
			["POST", "/loyaltyClass"],
			["PATCH", `/loyaltyObject/${objectId}`],
			["POST", "/loyaltyObject"],
		]);
		expect(stub.body("POST", "/loyaltyClass")).toMatchObject({ id: classId });
		expect(stub.requests.at(-1)?.body).toMatchObject({
			id: objectId,
			classId,
			loyaltyPoints: { balance: { string: "100" } },
		});
	});

	// Google merges a PATCH into the stored object, so a value that is gone
	// must be sent as null; leaving it out would keep the old one on the pass.
	it("clears Google values that became null, and sends them again once set", async () => {
		const stub = stubGoogleFetch(existingClasses);
		let values: Record<string, string | null> = {
			points: "100",
			tier: "Gold",
		};
		let template: PassTemplate | undefined;
		const wallet = new Wallet({
			google: googleCredentials(),
			load: (): LoadedPass | null =>
				template
					? { content: { values }, template, updatedAt: new Date() }
					: null,
		});
		template = wallet.loyalty({
			...TEMPLATE,
			fields: [...TEMPLATE.fields, field.secondary("tier", "Tier")],
		});

		await template.create({ serialNumber: SERIAL, values });
		values = { points: null, tier: null };
		await wallet.update(SERIAL);
		values = { points: "250", tier: "Silver" };
		await wallet.update(SERIAL);

		const objectId = `${ISSUER_ID}.${SERIAL}`;
		expect(
			stub.requests
				.filter((r) => r.path.startsWith("/loyaltyObject"))
				.map((r) => [r.method, r.body])
		).toEqual([
			[
				"POST",
				expect.objectContaining({
					id: objectId,
					state: "ACTIVE",
					loyaltyPoints: { balance: { string: "100" } },
					textModulesData: [{ header: "Tier", body: "Gold", id: "tier" }],
				}),
			],
			[
				"PATCH",
				expect.objectContaining({
					loyaltyPoints: null,
					textModulesData: null,
				}),
			],
			[
				"PATCH",
				expect.objectContaining({
					loyaltyPoints: { balance: { string: "250" } },
					textModulesData: [{ header: "Tier", body: "Silver", id: "tier" }],
				}),
			],
		]);
		// Insert leaves empty fields out instead of sending null.
		expect(Object.values(stub.body("POST", "/loyaltyObject"))).not.toContain(
			null
		);
	});

	// expire() moves the object to EXPIRED; a later content update must not
	// bring it back, so only the insert ever sends a state.
	it("keeps an expired Google pass expired across updates", async () => {
		const stub = stubGoogleFetch(existingClasses);
		let values: Record<string, string | null> = { points: "100" };
		let template: PassTemplate | undefined;
		const wallet = new Wallet({
			google: googleCredentials(),
			load: (): LoadedPass | null =>
				template
					? { content: { values }, template, updatedAt: new Date() }
					: null,
		});
		template = wallet.loyalty(TEMPLATE);

		await template.create({ serialNumber: SERIAL, values });
		await template.expire(SERIAL);
		values = { points: "250" };
		await wallet.update(SERIAL);

		const writes = stub.requests.filter((r) =>
			r.path.startsWith("/loyaltyObject")
		);
		expect(writes.map((r) => [r.method, r.body?.state])).toEqual([
			["POST", "ACTIVE"],
			["PATCH", "EXPIRED"],
			["PATCH", undefined],
		]);
		expect(writes[2]?.body).toMatchObject({
			loyaltyPoints: { balance: { string: "250" } },
		});
		expect(writes[2]?.body).not.toHaveProperty("state");
	});

	it("still updates Google when Apple fails, then reports the Apple failure", async () => {
		const failure = new Error("registrations unavailable");
		const registrations = memoryRegistrations();
		registrations.devices = () => Promise.reject(failure);
		const stub = stubGoogleFetch(existingClasses);
		const { wallet } = setup({ google: true, registrations });

		await expect(wallet.update(SERIAL)).rejects.toBe(failure);
		expect(stub.requests.map((r) => r.method)).toEqual(["GET", "PATCH"]);
	});

	it("reports Google's failure after Apple succeeds, with both outcomes", async () => {
		stubGoogleFetch((request) =>
			request.method === "PATCH"
				? new Response("", { status: 429, headers: { "retry-after": "30" } })
				: existingClasses(request)
		);
		const { wallet } = setup({ google: true });

		await expect(wallet.update(SERIAL)).rejects.toMatchObject({
			code: "GOOGLE_RATE_LIMITED",
			status: 429,
			retryAfter: 30,
			results: {
				apple: {
					status: "fulfilled",
					value: { notified: 0, failed: 0, removed: 0 },
				},
				google: {
					status: "rejected",
					reason: expect.objectContaining({ code: "GOOGLE_RATE_LIMITED" }),
				},
			},
		});
	});

	it("validates the loaded content before notifying anyone", async () => {
		const stub = stubGoogleFetch();
		const { template } = setup();
		const registrations = memoryRegistrations([
			{
				deviceLibraryIdentifier: "phone",
				pushToken: "aa11",
				serialNumber: SERIAL,
			},
		]);
		const devices = vi.spyOn(registrations, "devices");
		const invalid = new Wallet({
			apple: {
				...apple,
				webService: { url: URL_BASE, secret: SECRET, registrations },
			},
			google: googleCredentials(),
			load: () => ({
				content: { barcode: { format: "QR", value: "" } },
				template,
				updatedAt: new Date(),
			}),
		});
		await expect(invalid.update(SERIAL)).rejects.toMatchObject({
			code: "CREATE_CONFIG_INVALID",
		});
		expect(devices).not.toHaveBeenCalled();
		expect(stub.requests).toEqual([]);
	});
});

describe("create() when one wallet fails", () => {
	const template = {
		...TEMPLATE,
		id: "unreachable-icon",
		apple: { icon: "https://example.com/icon.png" },
	};

	it("reports Apple's failure with the save link Google already issued", async () => {
		stubGoogleFetch(existingClasses);
		const wallet = new Wallet({ apple, google: googleCredentials() });

		await expect(
			wallet.loyalty(template).create({ serialNumber: SERIAL })
		).rejects.toMatchObject({
			code: "IMAGE_FETCH_NETWORK_ERROR",
			cause: expect.objectContaining({
				message: "unexpected fetch: https://example.com/icon.png",
			}),
			results: {
				apple: {
					status: "rejected",
					reason: expect.objectContaining({
						code: "IMAGE_FETCH_NETWORK_ERROR",
					}),
				},
				google: { status: "fulfilled", value: expect.any(String) },
			},
		});
	});

	it("reports no results when only Apple is configured", async () => {
		stubGoogleFetch();
		const wallet = new Wallet({ apple });

		await expect(
			wallet.loyalty(template).create({ serialNumber: SERIAL })
		).rejects.toMatchObject({
			code: "IMAGE_FETCH_NETWORK_ERROR",
			results: undefined,
		});
	});
});
