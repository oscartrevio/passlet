// Google Wallet through `new Wallet({ google })` against a stand-in for the
// Wallet REST API and Google's OAuth token endpoint. Request bodies are
// checked against Google's discovery document by the stub; full bodies are
// pinned by the builder goldens in test/unit/google.
import { describe, expect, it, onTestFinished, vi } from "vitest";
import type { GoogleCredentials } from "../../../src/config";
import { WalletError } from "../../../src/errors";
import { Wallet } from "../../../src/wallet";
import { FIXTURES, type Fixture, walletTemplate } from "../../support/fixtures";
import {
	applyGooglePatch,
	CLIENT_EMAIL,
	decodeJwt,
	decodeJwtObject,
	existingClasses,
	type GoogleFetchStub,
	googleCredentials,
	googlePublicKey,
	ISSUER_ID,
	LOGO_URL,
	stubGoogleFetch,
	verifyJwt,
	type WalletResponder,
} from "../../support/google";

const credentials = googleCredentials();
const { loyalty, eventTicket, boardingPass, transit, giftCard, generic } =
	FIXTURES;
const SECRET = "private-key-or-signed-image-url";
const POST_RE = /^POST /;

function wallet(overrides?: Partial<GoogleCredentials>): Wallet {
	return new Wallet({ google: { ...credentials, ...overrides } });
}

/** A Wallet whose `load` serves each fixture under its serial number. */
function walletServing(passes: Record<string, Fixture>): Wallet {
	const served: Wallet = new Wallet({
		google: credentials,
		load: (serialNumber) => {
			const pass = passes[serialNumber];
			return pass
				? {
						template: walletTemplate(served, pass.pass),
						content: pass.create,
						updatedAt: new Date(0),
					}
				: null;
		},
	});
	return served;
}

function googleError(status: number, message: string): Response {
	return Response.json({ error: { code: status, message } }, { status });
}

/** `METHOD /path` of every Wallet request, in call order. */
function sent(stub: GoogleFetchStub): string[] {
	return stub.requests.map((r) => `${r.method} ${r.path}`);
}

function expectRedacted(error: unknown, secret: string): void {
	expect(error).toBeInstanceOf(WalletError);
	expect(error).not.toHaveProperty("cause");
	expect(String(error)).not.toContain(secret);
	expect(JSON.stringify(error)).not.toContain(secret);
}

/**
 * One class kept by the stand-in the way Google keeps it: GET reads it, PUT
 * replaces it, PATCH merges into it.
 */
function storedClass(path: string, initial: Record<string, unknown>) {
	const store = { current: initial };
	const respond: WalletResponder = ({ method, path: requested, body }) => {
		if (requested !== path) {
			return;
		}
		if (method === "PUT" && body) {
			store.current = body;
		} else if (method === "PATCH" && body) {
			store.current = applyGooglePatch(store.current, body);
		}
		return Response.json(store.current);
	};
	return { store, respond };
}

const LOYALTY_CLASS = `${ISSUER_ID}.${loyalty.pass.id}`;
const LOYALTY_OBJECT = `${ISSUER_ID}.${loyalty.create.serialNumber}`;

describe("create", () => {
	it("creates the missing class and the object, then signs a save JWT naming the object", async () => {
		const stub = stubGoogleFetch();
		const origins = ["https://example.com"];

		const { google: jwt } = await walletTemplate(
			wallet({ origins }),
			loyalty.pass
		).create(loyalty.create);

		expect(sent(stub)).toEqual([
			`GET /loyaltyClass/${LOYALTY_CLASS}`,
			"POST /loyaltyClass",
			"POST /loyaltyObject",
		]);
		expect(stub.body("POST", "/loyaltyClass")).toMatchObject({
			id: LOYALTY_CLASS,
			programName: loyalty.pass.name,
		});
		expect(stub.body("POST", "/loyaltyObject")).toMatchObject({
			id: LOYALTY_OBJECT,
			classId: LOYALTY_CLASS,
			state: "ACTIVE",
		});

		// Google verifies the JWT against the service account's public key and
		// rejects an iat in the future, which a millisecond timestamp would be.
		const { header, claims } = verifyJwt(jwt ?? "", googlePublicKey());
		expect(header.alg).toBe("RS256");
		const nowSeconds = Date.now() / 1000;
		expect(claims.iat).toBeLessThanOrEqual(nowSeconds);
		expect(claims.iat).toBeGreaterThan(nowSeconds - 5 * 60);
		expect(claims).toEqual({
			iss: CLIENT_EMAIL,
			aud: "google",
			typ: "savetowallet",
			iat: expect.any(Number),
			origins,
			payload: {
				loyaltyObjects: [{ id: LOYALTY_OBJECT, classId: LOYALTY_CLASS }],
			},
		});
	});

	// The token request carries an RS256 assertion for the Wallet scope.
	// https://developers.google.com/identity/protocols/oauth2/service-account#httprest
	it("exchanges a signed assertion for the Wallet issuer scope", async () => {
		const stub = stubGoogleFetch();
		await walletTemplate(wallet(), loyalty.pass).create(loyalty.create);

		expect(stub.assertions).toEqual([
			{
				scope: "https://www.googleapis.com/auth/wallet_object.issuer",
				iss: CLIENT_EMAIL,
				aud: "https://oauth2.googleapis.com/token",
				iat: expect.any(Number),
				exp: expect.any(Number),
			},
		]);
		const [assertion] = stub.assertions;
		expect(assertion?.exp).toBe(Number(assertion?.iat) + 3600);
		expect(
			stub.requests.map((request) => request.headers.authorization)
		).toEqual(new Array(3).fill("Bearer test-token"));
	});

	it("checks a template's class once per Wallet and never rewrites it", async () => {
		const stub = stubGoogleFetch(existingClasses);
		const card = walletTemplate(wallet(), loyalty.pass);

		await card.create(loyalty.create);
		const { google: jwt } = await card.create({
			...loyalty.create,
			serialNumber: "second-holder",
		});

		expect(sent(stub)).toEqual([
			`GET /loyaltyClass/${LOYALTY_CLASS}`,
			"POST /loyaltyObject",
			"POST /loyaltyObject",
		]);
		expect(decodeJwtObject(jwt ?? "", "loyalty")).toEqual({
			id: `${ISSUER_ID}.second-holder`,
			classId: LOYALTY_CLASS,
		});
	});

	it("shares one class check, one class insert and one token exchange across concurrent creates", async () => {
		const stub = stubGoogleFetch();
		const card = walletTemplate(wallet(), loyalty.pass);

		await Promise.all(
			Array.from({ length: 10 }, (_, index) =>
				card.create({ ...loyalty.create, serialNumber: `holder-${index}` })
			)
		);

		expect(stub.tokenRequests).toBe(1);
		expect(sent(stub).filter((line) => line.includes("Class"))).toEqual([
			`GET /loyaltyClass/${LOYALTY_CLASS}`,
			"POST /loyaltyClass",
		]);
		expect(
			sent(stub).filter((line) => line === "POST /loyaltyObject")
		).toHaveLength(10);
	});

	it("checks the class again after a failed check", async () => {
		let failing = true;
		const stub = stubGoogleFetch((request) =>
			failing && request.method === "GET"
				? googleError(503, "Backend Error")
				: existingClasses(request)
		);
		const card = walletTemplate(wallet(), loyalty.pass);

		await expect(card.create(loyalty.create)).rejects.toMatchObject({
			code: "GOOGLE_UNAVAILABLE",
			status: 503,
		});
		failing = false;
		await card.create(loyalty.create);

		expect(sent(stub)).toEqual([
			`GET /loyaltyClass/${LOYALTY_CLASS}`,
			`GET /loyaltyClass/${LOYALTY_CLASS}`,
			"POST /loyaltyObject",
		]);
	});

	// Two processes can both find the class missing; the later insert gets 409
	// because the class now exists.
	it("accepts a class insert conflict as the class another process created", async () => {
		const stub = stubGoogleFetch(({ method, path }) =>
			method === "POST" && path === "/loyaltyClass"
				? googleError(409, "Already exists")
				: undefined
		);
		await expect(
			walletTemplate(wallet(), loyalty.pass).create(loyalty.create)
		).resolves.toMatchObject({ google: expect.any(String) });
		expect(sent(stub)).toEqual([
			`GET /loyaltyClass/${LOYALTY_CLASS}`,
			"POST /loyaltyClass",
			"POST /loyaltyObject",
		]);
	});

	// "This field can be set to draft or underReview using the insert, patch,
	// or update API calls."
	// https://developers.google.com/wallet/reference/rest/v1/loyaltyclass
	it.each([
		{ requested: "APPROVED", sent: "UNDER_REVIEW" },
		{ requested: "REJECTED", sent: "UNDER_REVIEW" },
		{ requested: "DRAFT", sent: "DRAFT" },
	] as const)("writes a class requested as $requested with reviewStatus $sent", async ({
		requested,
		sent: expected,
	}) => {
		const stub = stubGoogleFetch(({ method }) =>
			method === "PATCH" ? googleError(404, "Not found") : undefined
		);
		const card = walletTemplate(wallet(), {
			...loyalty.pass,
			google: { logo: LOGO_URL, reviewStatus: requested },
		});
		await card.create(loyalty.create);
		await card.publish();
		expect(
			stub.requests
				.filter((r) => r.path === "/loyaltyClass" || r.method === "PATCH")
				.map((r) => [r.method, r.body?.reviewStatus])
		).toEqual([
			["POST", expected],
			["PATCH", expected],
			["POST", expected],
		]);
	});

	// A JWT only links the holder to an object, so the object must exist with
	// current content before the link is used. Issuing inserts first, since a
	// new holder is the common case.
	it("patches the same content over an object that already exists, keeping its state", async () => {
		const stub = stubGoogleFetch(
			(request) =>
				existingClasses(request) ??
				(request.method === "POST" ? googleError(409, "exists") : undefined)
		);

		await walletTemplate(wallet(), loyalty.pass).create(loyalty.create);

		expect(sent(stub)).toEqual([
			`GET /loyaltyClass/${LOYALTY_CLASS}`,
			"POST /loyaltyObject",
			`PATCH /loyaltyObject/${LOYALTY_OBJECT}`,
		]);
		// Only the insert sets state, so re-issuing an expired serial keeps it
		// expired.
		const patch = stub.body("PATCH", LOYALTY_OBJECT);
		expect(patch).not.toHaveProperty("state");
		expect(patch).not.toHaveProperty("notifyPreference");
		expect(patch).toMatchObject({
			loyaltyPoints: { balance: { string: "1250" } },
			accountId: null,
		});
	});

	it("surfaces object insert errors other than a conflict without patching", async () => {
		const stub = stubGoogleFetch(
			(request) => existingClasses(request) ?? new Response("", { status: 403 })
		);
		await expect(
			walletTemplate(wallet(), loyalty.pass).create(loyalty.create)
		).rejects.toMatchObject({ code: "GOOGLE_ACCESS_DENIED", status: 403 });
		expect(stub.requests.map((r) => r.method)).toEqual(["GET", "POST"]);
	});

	it.each<{ label: string; fixture: Fixture; code: string }>([
		{
			label: "a flight without a passenger name",
			fixture: {
				...boardingPass,
				create: { ...boardingPass.create, values: {} },
			},
			code: "GOOGLE_FLIGHT_MISSING_PASSENGER_NAME",
		},
		{
			label: "a gift card balance that is not a decimal",
			fixture: {
				...giftCard,
				create: { ...giftCard.create, values: { balance: "fifty" } },
			},
			code: "CREATE_CONFIG_INVALID",
		},
	])("rejects $label before any request", async ({ fixture, code }) => {
		const stub = stubGoogleFetch();
		await expect(
			walletTemplate(wallet(), fixture.pass).create(fixture.create)
		).rejects.toMatchObject({ code });
		expect(stub.requests).toEqual([]);
		expect(stub.tokenRequests).toBe(0);
	});

	// The web button rejects a JWT with an empty origins array, so an empty
	// list must be dropped like an absent one.
	it.each([
		undefined,
		[],
	])("omits the origins claim for origins %j", async (origins) => {
		stubGoogleFetch();
		const { google: jwt } = await walletTemplate(
			wallet({ origins }),
			loyalty.pass
		).create(loyalty.create);
		expect(decodeJwt(jwt ?? "").claims).not.toHaveProperty("origins");
	});

	// google.transit switches the flight vertical to transitClass/transitObject.
	it.each([
		{ label: "a rail pass", fixture: transit, vertical: "transit" },
		{ label: "an air pass", fixture: boardingPass, vertical: "flight" },
	] as const)("issues $label under the $vertical vertical", async ({
		fixture,
		vertical,
	}) => {
		const stub = stubGoogleFetch();
		const classId = `${ISSUER_ID}.${fixture.pass.id}`;
		const objectId = `${ISSUER_ID}.${fixture.create.serialNumber}`;

		const { google: jwt } = await walletTemplate(wallet(), fixture.pass).create(
			fixture.create
		);

		expect(sent(stub)).toEqual([
			`GET /${vertical}Class/${classId}`,
			`POST /${vertical}Class`,
			`POST /${vertical}Object`,
		]);
		expect(decodeJwtObject(jwt ?? "", vertical)).toEqual({
			id: objectId,
			classId,
		});
	});
});

describe("createBundle", () => {
	const flightClass = `${ISSUER_ID}.${boardingPass.pass.id}`;

	function bundle(target: Wallet) {
		const card = walletTemplate(target, loyalty.pass);
		const flight = walletTemplate(target, boardingPass.pass);
		return Array.from({ length: 10 }, (_, index) =>
			index % 2 === 0
				? {
						template: card,
						content: { ...loyalty.create, serialNumber: `b-${index}` },
					}
				: {
						template: flight,
						content: { ...boardingPass.create, serialNumber: `b-${index}` },
					}
		);
	}

	it("writes every object in parallel right after its class, and signs one JWT naming them all", async () => {
		const stub = stubGoogleFetch();
		const target = wallet();

		const { google: jwt } = await target.createBundle(bundle(target));

		expect(sent(stub).sort()).toEqual(
			[
				`GET /loyaltyClass/${LOYALTY_CLASS}`,
				"POST /loyaltyClass",
				`GET /flightClass/${flightClass}`,
				"POST /flightClass",
				...new Array(5).fill("POST /loyaltyObject"),
				...new Array(5).fill("POST /flightObject"),
			].sort()
		);
		// Class check ‖ class insert ‖ objects: three round trips deep however
		// many items share a class.
		expect(Math.max(...stub.requests.map((r) => r.depth))).toBe(3);
		expect(stub.maxInFlight).toBe(10);
		for (const [index, request] of stub.requests.entries()) {
			const [, resource = ""] = request.path.split("/");
			if (resource.endsWith("Object")) {
				const classInsert = sent(stub).indexOf(
					`POST /${resource.replace("Object", "Class")}`
				);
				expect(classInsert).toBeLessThan(index);
			}
		}
		expect(stub.tokenRequests).toBe(1);

		const { payload } = decodeJwt(jwt ?? "").claims;
		expect(payload).toEqual({
			loyaltyObjects: [0, 2, 4, 6, 8].map((index) => ({
				id: `${ISSUER_ID}.b-${index}`,
				classId: LOYALTY_CLASS,
			})),
			flightObjects: [1, 3, 5, 7, 9].map((index) => ({
				id: `${ISSUER_ID}.b-${index}`,
				classId: flightClass,
			})),
		});
	});

	it("is two round trips deep over existing classes and one once they are known", async () => {
		const target = wallet();
		const cold = stubGoogleFetch(existingClasses);
		await target.createBundle(bundle(target));
		expect(Math.max(...cold.requests.map((r) => r.depth))).toBe(2);
		expect(cold.maxInFlight).toBe(10);

		const warm = stubGoogleFetch(existingClasses);
		await target.createBundle(bundle(target));
		expect(sent(warm)).toEqual(
			new Array(10).fill(expect.stringMatching(POST_RE))
		);
		expect(Math.max(...warm.requests.map((r) => r.depth))).toBe(1);
	});

	it("rejects an invalid item before writing any", async () => {
		const stub = stubGoogleFetch();
		const target = wallet();
		await expect(
			target.createBundle([
				{
					template: walletTemplate(target, loyalty.pass),
					content: loyalty.create,
				},
				{
					template: walletTemplate(target, boardingPass.pass),
					content: { serialNumber: "no-passenger" },
				},
			])
		).rejects.toMatchObject({ code: "GOOGLE_FLIGHT_MISSING_PASSENGER_NAME" });
		expect(stub.requests).toEqual([]);
	});
});

describe("update", () => {
	it("patches an existing object with one request, asking for a notification only when told to", async () => {
		const stub = stubGoogleFetch();
		const target = walletServing({
			"transit-001": transit,
			"flight-001": boardingPass,
		});

		await expect(
			target.update("transit-001", { notify: true })
		).resolves.toEqual({ apple: null, google: "updated" });
		await expect(target.update("flight-001")).resolves.toEqual({
			apple: null,
			google: "updated",
		});

		expect(sent(stub)).toEqual([
			`PATCH /transitObject/${ISSUER_ID}.transit-001`,
			`PATCH /flightObject/${ISSUER_ID}.flight-001`,
		]);
		const notified = stub.body("PATCH", "transit-001");
		expect(notified).toMatchObject({ notifyPreference: "NOTIFY_ON_UPDATE" });
		expect(notified).not.toHaveProperty("state");
		expect(stub.body("PATCH", "flight-001")).not.toHaveProperty(
			"notifyPreference"
		);
	});

	// Google announces a flight's seat change only through
	// boardingAndSeatingInfo.seatNumber with notifyPreference on the PATCH.
	// https://developers.google.com/wallet/tickets/boarding-passes/use-cases/trigger-push-notifications
	it("sends a changed seat as the flight's seat number with the notify flag", async () => {
		const stub = stubGoogleFetch();
		await walletServing({
			"flight-001": {
				...boardingPass,
				create: {
					...boardingPass.create,
					values: { ...boardingPass.create.values, seat: "14C" },
				},
			},
		}).update("flight-001", { notify: true });

		expect(stub.body("PATCH", "flight-001")).toMatchObject({
			boardingAndSeatingInfo: { seatNumber: "14C" },
			notifyPreference: "NOTIFY_ON_UPDATE",
		});
	});

	// genericObject has no notifyPreference field, and the stand-in, like
	// Google's schema, refuses a generic PATCH that carries one.
	// https://developers.google.com/wallet/reference/rest/v1/genericobject
	it("sends no notify flag for a generic pass", async () => {
		const stub = stubGoogleFetch();
		await expect(
			walletServing({ "generic-001": generic }).update("generic-001", {
				notify: true,
			})
		).resolves.toEqual({ apple: null, google: "updated" });
		expect(stub.body("PATCH", "generic-001")).not.toHaveProperty(
			"notifyPreference"
		);
	});

	it("clears values that became null", async () => {
		const stub = stubGoogleFetch();
		await walletServing({
			"event-001": {
				...eventTicket,
				create: { ...eventTicket.create, values: { seat: null, venue: null } },
			},
		}).update("event-001");

		expect(stub.body("PATCH", "event-001")).toMatchObject({
			seatInfo: { seat: null, row: { defaultValue: { value: "12" } } },
			textModulesData: null,
		});
	});

	it("creates the class and the object, without the notify flag, when Google has no object", async () => {
		const stub = stubGoogleFetch(({ method }) =>
			method === "PATCH" ? new Response("", { status: 404 }) : undefined
		);
		const classId = `${ISSUER_ID}.${boardingPass.pass.id}`;

		await expect(
			walletServing({ "flight-001": boardingPass }).update("flight-001", {
				notify: true,
			})
		).resolves.toEqual({ apple: null, google: "created" });

		expect(sent(stub)).toEqual([
			`PATCH /flightObject/${ISSUER_ID}.flight-001`,
			`GET /flightClass/${classId}`,
			"POST /flightClass",
			"POST /flightObject",
		]);
		const inserted = stub.body("POST", "/flightObject");
		expect(inserted).toMatchObject({ state: "ACTIVE" });
		expect(inserted).not.toHaveProperty("notifyPreference");
		expect(Object.values(inserted)).not.toContain(null);
	});

	it("skips the class check for a missing object once the class is known", async () => {
		const target = walletServing({ "flight-002": boardingPass });
		stubGoogleFetch();
		await walletTemplate(target, boardingPass.pass).create(boardingPass.create);

		const stub = stubGoogleFetch(({ method }) =>
			method === "PATCH" ? new Response("", { status: 404 }) : undefined
		);
		await target.update("flight-002");
		expect(sent(stub)).toEqual([
			`PATCH /flightObject/${ISSUER_ID}.flight-002`,
			"POST /flightObject",
		]);
	});

	it("surfaces errors other than a missing object without inserting", async () => {
		const stub = stubGoogleFetch(() => new Response("", { status: 403 }));
		await expect(
			walletServing({ "flight-001": boardingPass }).update("flight-001")
		).rejects.toMatchObject({ code: "GOOGLE_ACCESS_DENIED" });
		expect(stub.requests.map((r) => r.method)).toEqual(["PATCH"]);
	});
});

describe("publish", () => {
	const FLIGHT_CLASS = `${ISSUER_ID}.${boardingPass.pass.id}`;

	// A patch merges into nested objects, so fields passlet does not own, such
	// as the gate an airline sets on the class, survive a publish.
	// https://developers.google.com/wallet/tickets/boarding-passes/use-cases/trigger-push-notifications
	it("keeps nested class fields passlet does not own in one request", async () => {
		const callbackOptions = { url: "https://example.com/wallet-callback" };
		const { store, respond } = storedClass(`/flightClass/${FLIGHT_CLASS}`, {
			id: FLIGHT_CLASS,
			reviewStatus: "APPROVED",
			callbackOptions,
			origin: { airportIataCode: "JFK", terminal: "4", gate: "B22" },
			flightHeader: {
				carrier: {
					carrierIataCode: "AA",
					airlineName: {
						defaultValue: { language: "en-US", value: "American" },
					},
				},
				flightNumber: "100",
			},
		});
		const stub = stubGoogleFetch(respond);

		await walletTemplate(wallet(), boardingPass.pass).publish();

		expect(sent(stub)).toEqual([`PATCH /flightClass/${FLIGHT_CLASS}`]);
		expect(store.current).toMatchObject({
			callbackOptions,
			reviewStatus: "UNDER_REVIEW",
			origin: { airportIataCode: "JFK", terminal: "4", gate: "B22" },
			destination: { airportIataCode: "LAX" },
			flightHeader: {
				carrier: {
					carrierIataCode: "AA",
					airlineName: expect.any(Object),
					airlineLogo: expect.any(Object),
				},
			},
		});
	});

	it("clears class fields the template no longer sets and turns Smart Tap off", async () => {
		const stub = stubGoogleFetch();
		await walletTemplate(wallet(), {
			...loyalty.pass,
			google: { logo: LOGO_URL },
		}).publish();

		expect(stub.body("PATCH", LOYALTY_CLASS)).toMatchObject({
			id: LOYALTY_CLASS,
			enableSmartTap: false,
			heroImage: null,
			messages: null,
			redemptionIssuers: null,
			merchantLocations: null,
			linksModuleData: null,
			appLinkData: null,
		});
	});

	it("creates a missing class", async () => {
		const stub = stubGoogleFetch(({ method }) =>
			method === "PATCH" ? googleError(404, "Not found") : undefined
		);
		await walletTemplate(wallet(), loyalty.pass).publish();
		expect(sent(stub)).toEqual([
			`PATCH /loyaltyClass/${LOYALTY_CLASS}`,
			"POST /loyaltyClass",
		]);
		expect(Object.values(stub.body("POST", "/loyaltyClass"))).not.toContain(
			null
		);
	});

	it("marks the class known, so later creates skip the class check", async () => {
		const stub = stubGoogleFetch();
		const card = walletTemplate(wallet(), loyalty.pass);
		await card.publish();
		await card.create(loyalty.create);
		expect(sent(stub)).toEqual([
			`PATCH /loyaltyClass/${LOYALTY_CLASS}`,
			"POST /loyaltyObject",
		]);
	});
});

describe("expire", () => {
	it("moves the vertical's object to EXPIRED", async () => {
		const stub = stubGoogleFetch();
		await walletTemplate(wallet(), transit.pass).expire("transit-001");
		expect(sent(stub)).toEqual([
			`PATCH /transitObject/${ISSUER_ID}.transit-001`,
		]);
		expect(stub.body("PATCH", "transit-001")).toEqual({ state: "EXPIRED" });
	});

	it("rejects a serial number Google cannot use as an object ID, before any request", async () => {
		const stub = stubGoogleFetch();
		await expect(
			walletTemplate(wallet(), loyalty.pass).expire("../loyaltyClass/x")
		).rejects.toMatchObject({
			code: "CREATE_CONFIG_INVALID",
			issues: [expect.objectContaining({ path: ["serialNumber"] })],
		});
		expect(stub.requests).toEqual([]);
		expect(stub.tokenRequests).toBe(0);
	});
});

// TEXT_AND_NOTIFY pushes a notification when sent through AddMessage.
// https://developers.google.com/wallet/generic/use-cases/trigger-push-notifications
// https://developers.google.com/wallet/reference/rest/v1/loyaltyobject/addmessage
describe("sendMessage", () => {
	it("adds the message to the pass's object through AddMessage", async () => {
		const stub = stubGoogleFetch();
		const target = wallet();

		await walletTemplate(target, loyalty.pass).sendMessage("member-1", {
			header: "Double points",
			body: "Today only",
			id: "promo-1",
			messageType: "TEXT_AND_NOTIFY",
		});
		await walletTemplate(target, transit.pass).sendMessage("transit-001", {
			header: "Platform change",
			body: "Now leaving from platform 4",
		});

		expect(sent(stub)).toEqual([
			`POST /loyaltyObject/${ISSUER_ID}.member-1/addMessage`,
			`POST /transitObject/${ISSUER_ID}.transit-001/addMessage`,
		]);
		expect(stub.requests.map((r) => r.body)).toEqual([
			{
				message: {
					header: "Double points",
					body: "Today only",
					id: "promo-1",
					messageType: "TEXT_AND_NOTIFY",
				},
			},
			{
				message: {
					header: "Platform change",
					body: "Now leaving from platform 4",
					messageType: "TEXT",
				},
			},
		]);
	});

	it("rejects an invalid message or serial number before any request", async () => {
		const stub = stubGoogleFetch();
		const template = walletTemplate(wallet(), loyalty.pass);
		await expect(
			// @ts-expect-error -- a message without a body
			template.sendMessage("member-1", { header: "Hi" })
		).rejects.toMatchObject({
			code: "CREATE_CONFIG_INVALID",
			issues: [expect.objectContaining({ path: ["body"] })],
		});
		await expect(
			template.sendMessage("member 1", { header: "Hi", body: "There" })
		).rejects.toMatchObject({ code: "CREATE_CONFIG_INVALID" });
		expect(stub.requests).toEqual([]);
	});

	it("surfaces Google's notification quota as GOOGLE_RATE_LIMITED", async () => {
		stubGoogleFetch(() => googleError(429, "Quota"));
		await expect(
			walletTemplate(wallet(), loyalty.pass).sendMessage("member-1", {
				header: "Again",
				body: "Fourth today",
				messageType: "TEXT_AND_NOTIFY",
			})
		).rejects.toMatchObject({ code: "GOOGLE_RATE_LIMITED" });
	});

	it("requires Google credentials", async () => {
		await expect(
			walletTemplate(new Wallet({}), loyalty.pass).sendMessage("member-1", {
				header: "Hi",
				body: "There",
			})
		).rejects.toMatchObject({ code: "GOOGLE_NOT_CONFIGURED" });
	});
});

describe("Google failures", () => {
	const expire = (target = wallet()) =>
		walletTemplate(target, loyalty.pass).expire("member-1");

	it.each([
		{ status: 400, code: "GOOGLE_API_ERROR" },
		{ status: 401, code: "GOOGLE_AUTH_FAILED" },
		{ status: 403, code: "GOOGLE_ACCESS_DENIED" },
		{ status: 404, code: "GOOGLE_NOT_FOUND" },
		{ status: 409, code: "GOOGLE_CONFLICT" },
		{ status: 429, code: "GOOGLE_RATE_LIMITED" },
		{ status: 503, code: "GOOGLE_UNAVAILABLE" },
	])("classifies HTTP $status as $code", async ({ status, code }) => {
		stubGoogleFetch(() => googleError(status, "Provider diagnostic"));
		await expect(expire()).rejects.toMatchObject({ code, status });
	});

	it.each([
		{ label: "delay seconds", value: "75", expected: 75 },
		{
			label: "HTTP date",
			value: "Mon, 07 Sep 2026 12:01:15 GMT",
			expected: 75,
		},
		{
			label: "past HTTP date",
			value: "Mon, 07 Sep 2026 11:00:00 GMT",
			expected: 0,
		},
		{ label: "invalid negative delay", value: "-1", expected: undefined },
	])("exposes Retry-After $label in seconds", async ({ value, expected }) => {
		vi.spyOn(Date, "now").mockReturnValue(Date.UTC(2026, 8, 7, 12));
		onTestFinished(() => {
			vi.mocked(Date.now).mockRestore();
		});
		stubGoogleFetch(
			() =>
				new Response("Busy", {
					status: 429,
					headers: { "Retry-After": value },
				})
		);
		await expect(expire()).rejects.toMatchObject({
			code: "GOOGLE_RATE_LIMITED",
			status: 429,
			retryAfter: expected,
		});
	});

	it.each([
		"json",
		"text",
	])("does not echo untrusted %s error bodies or store them as causes", async (format) => {
		stubGoogleFetch(() =>
			format === "json"
				? googleError(400, SECRET)
				: new Response(SECRET, { status: 400 })
		);
		const error = await expire().catch((cause: unknown) => cause);
		expect(error).toMatchObject({ code: "GOOGLE_API_ERROR", status: 400 });
		expectRedacted(error, SECRET);
	});

	it.each([
		"oauth",
		"wallet",
	])("preserves the Error cause of an %s transport failure", async (endpoint) => {
		const cause = new TypeError("Connection reset");
		const fail = () => {
			throw cause;
		};
		stubGoogleFetch(endpoint === "wallet" ? fail : undefined, {
			token: endpoint === "oauth" ? fail : undefined,
		});
		await expect(expire()).rejects.toMatchObject({
			code: "GOOGLE_NETWORK_ERROR",
			cause,
		});
	});

	it("preserves a transport failure while reading the token response", async () => {
		const cause = new TypeError("Connection closed during response");
		stubGoogleFetch(undefined, {
			token: () =>
				new Response(
					new ReadableStream({
						start(controller) {
							controller.error(cause);
						},
					})
				),
		});
		await expect(expire()).rejects.toMatchObject({
			code: "GOOGLE_NETWORK_ERROR",
			status: 502,
			cause,
		});
	});
});

describe("inside Next.js", () => {
	// Next.js's patched fetch returns one tee() branch of every body and never
	// reads the other, so cancelling the returned body never settles.
	const unreadBranches: ReadableStream[] = [];
	function nextJsResponse(response: Response): Response {
		if (!response.body) {
			return response;
		}
		const [body, unread] = response.body.tee();
		unreadBranches.push(unread);
		return new Response(body, {
			status: response.status,
			headers: response.headers,
		});
	}

	it("creates a missing class and the object", async () => {
		const stub = stubGoogleFetch(({ method }) =>
			nextJsResponse(
				method === "GET" ? new Response("", { status: 404 }) : Response.json({})
			)
		);
		await walletTemplate(wallet(), loyalty.pass).create(loyalty.create);
		expect(stub.requests).toHaveLength(3);
	});

	it("re-issues over an existing object", async () => {
		const stub = stubGoogleFetch((request) =>
			nextJsResponse(
				existingClasses(request) ??
					(request.method === "POST"
						? googleError(409, "exists")
						: Response.json({}))
			)
		);
		await walletTemplate(wallet(), loyalty.pass).create(loyalty.create);
		expect(stub.requests).toHaveLength(3);
	});

	it("surfaces a Google failure", async () => {
		stubGoogleFetch(() => nextJsResponse(googleError(400, "Invalid")));
		await expect(
			walletTemplate(wallet(), loyalty.pass).expire("member-1")
		).rejects.toMatchObject({ code: "GOOGLE_API_ERROR", status: 400 });
	});
});

describe("access token", () => {
	const expire = (target: Wallet) =>
		walletTemplate(target, loyalty.pass).expire("member-1");

	// "Access tokens can be reused during the duration window specified by the
	// expires_in value."
	// https://developers.google.com/identity/protocols/oauth2/service-account
	it("reuses a token only until shortly before its expires_in", async () => {
		vi.useFakeTimers({ toFake: ["Date"] });
		onTestFinished(() => {
			vi.useRealTimers();
		});
		const stub = stubGoogleFetch(undefined, {
			token: () =>
				Response.json({ access_token: "hour-token", expires_in: 3600 }),
		});
		const target = wallet();
		await expire(target);
		vi.advanceTimersByTime(50 * 60 * 1000);
		await expire(target);
		expect(stub.tokenRequests).toBe(1);
		vi.advanceTimersByTime(6 * 60 * 1000);
		await expire(target);
		expect(stub.tokenRequests).toBe(2);
	});

	it("does not reuse a token whose response has no expires_in", async () => {
		const stub = stubGoogleFetch(undefined, {
			token: () => Response.json({ access_token: "once-token" }),
		});
		const target = wallet();
		await expire(target);
		await expire(target);
		expect(stub.tokenRequests).toBe(2);
	});

	it("replaces a cached token Google rejects and retries the request once", async () => {
		let issued = 0;
		let revoked = false;
		const stub = stubGoogleFetch(
			({ headers }) =>
				revoked && headers.authorization === "Bearer token-1"
					? googleError(401, "Invalid Credentials")
					: undefined,
			{
				token: () => {
					issued += 1;
					return Response.json({
						access_token: `token-${issued}`,
						expires_in: 3600,
					});
				},
			}
		);
		const target = wallet();
		await expire(target);
		revoked = true;
		await expire(target);
		await expire(target);
		expect(stub.tokenRequests).toBe(2);
		expect(stub.requests.map((r) => r.headers.authorization)).toEqual([
			"Bearer token-1",
			"Bearer token-1",
			"Bearer token-2",
			"Bearer token-2",
		]);
	});

	it("shares one exchange among concurrent requests on a cold Wallet", async () => {
		const stub = stubGoogleFetch();
		const template = walletTemplate(wallet(), loyalty.pass);
		await Promise.all(
			Array.from({ length: 10 }, (_, index) =>
				template.expire(`member-${index}`)
			)
		);
		expect(stub.tokenRequests).toBe(1);
		expect(stub.requests).toHaveLength(10);
	});

	it("does not retry when Google rejects a freshly exchanged token", async () => {
		const stub = stubGoogleFetch(() => googleError(401, "Invalid Credentials"));
		await expect(expire(wallet())).rejects.toMatchObject({
			code: "GOOGLE_AUTH_FAILED",
			status: 401,
		});
		expect(stub.tokenRequests).toBe(1);
		expect(stub.requests).toHaveLength(1);
	});

	it("classifies a rejected OAuth assertion without echoing its diagnostics", async () => {
		const stub = stubGoogleFetch(undefined, {
			token: () =>
				Response.json(
					{ error: "invalid_grant", error_description: SECRET },
					{ status: 400 }
				),
		});
		const error = await expire(wallet()).catch((cause: unknown) => cause);
		expect(error).toMatchObject({ code: "GOOGLE_AUTH_FAILED", status: 400 });
		expectRedacted(error, SECRET);
		expect(stub.requests).toEqual([]);
	});

	it.each([
		{ label: "json", body: "secret-invalid-json" },
		{ label: "missing", body: "{}" },
		{ label: "type", body: '{"access_token":123}' },
		{
			label: "whitespace",
			body: JSON.stringify({ access_token: "token\r\ninjected: secret" }),
		},
	])("never caches a malformed $label token response", async ({ body }) => {
		let first = true;
		const stub = stubGoogleFetch(undefined, {
			token: () => {
				if (first) {
					first = false;
					return new Response(body);
				}
				return Response.json({ access_token: "recovered-token" });
			},
		});
		const target = wallet();
		const error = await expire(target).catch((cause: unknown) => cause);
		expect(error).toMatchObject({
			code: "GOOGLE_INVALID_RESPONSE",
			status: 502,
		});
		expectRedacted(error, body);
		expect(stub.requests).toEqual([]);

		await expire(target);
		expect(stub.tokenRequests).toBe(2);
		expect(
			stub.requests.map((request) => request.headers.authorization)
		).toEqual(["Bearer recovered-token"]);
	});

	it("lets the next call exchange again after a failed exchange", async () => {
		let failed = false;
		const stub = stubGoogleFetch(undefined, {
			token: () => {
				if (failed) {
					return Response.json({ access_token: "second", expires_in: 3600 });
				}
				failed = true;
				return googleError(503, "Backend Error");
			},
		});
		const target = wallet();
		await expect(expire(target)).rejects.toMatchObject({
			code: "GOOGLE_UNAVAILABLE",
		});
		await expire(target);
		expect(stub.tokenRequests).toBe(2);
	});
});

describe("service account key", () => {
	it("accepts a PEM whose newlines are literal \\n sequences, as .env files keep them", async () => {
		stubGoogleFetch();
		const escaped = credentials.privateKey.replace(/\n/g, "\\n");
		const { google: jwt } = await walletTemplate(
			wallet({ privateKey: escaped }),
			loyalty.pass
		).create(loyalty.create);
		expect(() => verifyJwt(jwt ?? "", googlePublicKey())).not.toThrow();
	});

	it.each([
		{ label: "not a PEM", privateKey: "not-a-pem\\nat-all" },
		{ label: "missing at runtime", privateKey: undefined },
	])("rejects a key that is $label at construction", ({ privateKey }) => {
		expect(
			() =>
				new Wallet({
					google: { ...credentials, privateKey } as GoogleCredentials,
				})
		).toThrow(
			expect.objectContaining({
				code: "GOOGLE_INVALID_PRIVATE_KEY",
				cause: expect.any(Error),
			})
		);
	});
});
