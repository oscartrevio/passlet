import { createPublicKey } from "node:crypto";
import { jwtVerify } from "jose";
import { describe, expect, it, vi } from "vitest";
import { buildClassBody } from "../../../src/google/class-body";
import { GoogleProvider } from "../../../src/google/index";
import { signJwt } from "../../../src/google/jwt";
import { buildObjectBody } from "../../../src/google/object-body";
import { FIXTURES, type Fixture } from "../../support/fixtures";
import {
	decodeJwt,
	decodeJwtObject,
	existingClasses,
	type GoogleFetchStub,
	googleCredentials,
	ISSUER_ID,
	stubGoogleFetch,
} from "../../support/google";

vi.mock("../../../src/google/jwt", async (importOriginal) => {
	const actual = await importOriginal<{ signJwt: typeof signJwt }>();
	return { signJwt: vi.fn(actual.signJwt) };
});

const credentials = googleCredentials();
const provider = new GoogleProvider(credentials);
const { loyalty, boardingPass, transit } = FIXTURES;

async function generate(
	fixture: Fixture,
	creds = credentials
): Promise<string> {
	return await new GoogleProvider(creds).issue({
		template: fixture.pass,
		content: fixture.create,
	});
}

/** `[method, path, body]` of every Wallet request, in order. */
function calls(stub: GoogleFetchStub): unknown[][] {
	return stub.requests.map((r) => [r.method, r.path, r.body]);
}

describe("GoogleProvider.issue", () => {
	it("creates the class and object, then signs a save-to-wallet JWT referencing the object", async () => {
		const stub = stubGoogleFetch();
		const classId = `${ISSUER_ID}.${loyalty.pass.id}`;
		const objectId = `${ISSUER_ID}.${loyalty.create.serialNumber}`;
		const origins = ["https://example.com"];

		const jwt = await generate(loyalty, { ...credentials, origins });

		expect(calls(stub)).toEqual([
			["GET", `/loyaltyClass/${classId}`, undefined],
			[
				"POST",
				"/loyaltyClass",
				{ id: classId, ...buildClassBody(loyalty.pass) },
			],
			[
				"POST",
				"/loyaltyObject",
				buildObjectBody(loyalty.pass, loyalty.create, classId, objectId),
			],
		]);

		// Google verifies the JWT against the service account's public key and
		// rejects an iat in the future, which a millisecond timestamp would be.
		const { payload, protectedHeader } = await jwtVerify(
			jwt,
			createPublicKey(credentials.privateKey),
			{ maxTokenAge: "5 minutes" }
		);
		expect(protectedHeader.alg).toBe("RS256");
		expect(payload).toEqual({
			iss: credentials.clientEmail,
			aud: "google",
			typ: "savetowallet",
			iat: expect.any(Number),
			origins,
			payload: { loyaltyObjects: [{ id: objectId, classId }] },
		});
	});

	// A JWT only links the holder to an object, so the object must exist with
	// current content before the link is used. Issuing inserts first, since a
	// new holder is the common case.
	it("inserts the object, then patches it with the same body when it already exists", async () => {
		const stub = stubGoogleFetch(
			(request) =>
				existingClasses(request) ??
				(request.method === "POST"
					? Response.json({ error: { code: 409 } }, { status: 409 })
					: undefined)
		);
		const classId = `${ISSUER_ID}.${loyalty.pass.id}`;
		const objectId = `${ISSUER_ID}.${loyalty.create.serialNumber}`;
		const objectBody = buildObjectBody(
			loyalty.pass,
			loyalty.create,
			classId,
			objectId
		);

		await generate(loyalty);

		expect(calls(stub)).toEqual([
			["GET", `/loyaltyClass/${classId}`, undefined],
			["POST", "/loyaltyObject", objectBody],
			["PATCH", `/loyaltyObject/${objectId}`, objectBody],
		]);
	});

	it("surfaces object insert errors other than a conflict without patching", async () => {
		const stub = stubGoogleFetch(
			(request) => existingClasses(request) ?? new Response("", { status: 403 })
		);

		await expect(generate(loyalty)).rejects.toMatchObject({
			code: "GOOGLE_ACCESS_DENIED",
		});
		expect(stub.requests.map((r) => r.method)).toEqual(["GET", "POST"]);
	});

	it("rejects invalid recipient data before making Google requests", async () => {
		const stub = stubGoogleFetch();
		await expect(
			generate(
				{
					pass: boardingPass.pass,
					create: { ...boardingPass.create, values: {} },
				},
				googleCredentials({ clientEmail: "invalid-recipient@test.invalid" })
			)
		).rejects.toMatchObject({ code: "GOOGLE_FLIGHT_MISSING_PASSENGER_NAME" });
		expect(stub.requests).toEqual([]);
		expect(stub.tokenRequests).toBe(0);
	});

	it("never rewrites the shared class when issuing repeatedly from an older template", async () => {
		const classId = `${ISSUER_ID}.${loyalty.pass.id}`;
		const stub = stubGoogleFetch(() =>
			Response.json({
				id: classId,
				issuerName: "Newer console-managed branding",
				reviewStatus: "APPROVED",
				enableSmartTap: true,
			})
		);
		await generate(loyalty);
		const jwt = await generate({
			pass: { ...loyalty.pass, name: "Older deployment" },
			create: { ...loyalty.create, serialNumber: "second-holder" },
		});
		expect(calls(stub)).toEqual([
			["GET", `/loyaltyClass/${classId}`, undefined],
			["POST", "/loyaltyObject", expect.any(Object)],
			["GET", `/loyaltyClass/${classId}`, undefined],
			["POST", "/loyaltyObject", expect.any(Object)],
		]);
		expect(decodeJwtObject(jwt, "loyaltyObject")).toMatchObject({
			id: `${ISSUER_ID}.second-holder`,
			classId,
		});
	});

	// The web button rejects a JWT with an empty origins array, so an empty
	// list must be dropped like an absent one.
	it("omits the origins claim when none are configured", async () => {
		stubGoogleFetch();
		const unset = await generate(loyalty, {
			...credentials,
			origins: undefined,
		});
		expect(decodeJwt(unset).claims).not.toHaveProperty("origins");
		const empty = await generate(loyalty, { ...credentials, origins: [] });
		expect(decodeJwt(empty).claims).not.toHaveProperty("origins");
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

		const jwt = await generate(fixture);

		expect(calls(stub)).toEqual([
			["GET", `/${vertical}Class/${classId}`, undefined],
			[
				"POST",
				`/${vertical}Class`,
				{ id: classId, ...buildClassBody(fixture.pass) },
			],
			[
				"POST",
				`/${vertical}Object`,
				buildObjectBody(fixture.pass, fixture.create, classId, objectId),
			],
		]);
		expect(decodeJwtObject(jwt, `${vertical}Object`)).toEqual({
			id: objectId,
			classId,
		});
	});

	it("normalizes save-to-wallet JWT signing failures with their Error cause", async () => {
		const cause = new Error("Signing unavailable");
		const { signJwt: realSignJwt } = await vi.importActual<{
			signJwt: typeof signJwt;
		}>("../../../src/google/jwt");
		vi.mocked(signJwt)
			.mockImplementationOnce(realSignJwt)
			.mockImplementationOnce(() => {
				throw cause;
			});
		const stub = stubGoogleFetch();
		const scoped = googleCredentials({
			clientEmail: "save-signing@test-project.iam.gserviceaccount.com",
		});

		await expect(generate(loyalty, scoped)).rejects.toMatchObject({
			code: "GOOGLE_SIGNING_FAILED",
			cause,
		});
		// OAuth signing succeeded and the class and object exist; only the save
		// JWT failed.
		expect(stub.requests.map((request) => request.method)).toEqual([
			"GET",
			"POST",
			"POST",
		]);
	});
});

describe("GoogleProvider.publish", () => {
	it.each([
		{ fixture: loyalty, vertical: "loyalty" },
		{ fixture: boardingPass, vertical: "flight" },
		{ fixture: transit, vertical: "transit" },
	])("explicitly publishes the $vertical class without deleting remote attributes", async ({
		fixture,
		vertical,
	}) => {
		const classId = `${ISSUER_ID}.${fixture.pass.id}`;
		const callbackOptions = { url: "https://example.com/wallet-callback" };
		const stub = stubGoogleFetch(({ method }) =>
			method === "GET"
				? Response.json({
						id: classId,
						issuerName: "Previous branding",
						callbackOptions,
						reviewStatus: "APPROVED",
					})
				: undefined
		);

		await provider.publish(fixture.pass);

		expect(
			stub.requests.map((request) => [request.method, request.path])
		).toEqual([
			["GET", `/${vertical}Class/${classId}`],
			["PUT", `/${vertical}Class/${classId}`],
		]);
		expect(stub.body("PUT", classId)).toMatchObject({
			id: classId,
			issuerName: fixture.pass.google?.issuerName ?? fixture.pass.name,
			callbackOptions,
			reviewStatus: "UNDER_REVIEW",
		});
	});
});

describe("GoogleProvider.update", () => {
	it("patches the vertical's object with the rebuilt body and the notify flag", async () => {
		const stub = stubGoogleFetch(existingClasses);
		const transitObject = buildObjectBody(
			transit.pass,
			transit.create,
			`${ISSUER_ID}.fx-transit`,
			`${ISSUER_ID}.transit-001`
		);
		const flightObject = buildObjectBody(
			boardingPass.pass,
			boardingPass.create,
			`${ISSUER_ID}.fx-flight`,
			`${ISSUER_ID}.flight-001`
		);

		await expect(
			provider.update(
				{ template: transit.pass, content: transit.create },
				{ notify: true }
			)
		).resolves.toBe("updated");
		await expect(
			provider.update(
				{ template: boardingPass.pass, content: boardingPass.create },
				{}
			)
		).resolves.toBe("updated");

		// An existing class is only checked, never rewritten, by an update.
		expect(calls(stub)).toEqual([
			["GET", `/transitClass/${ISSUER_ID}.fx-transit`, undefined],
			[
				"PATCH",
				`/transitObject/${ISSUER_ID}.transit-001`,
				{ ...transitObject, notifyPreference: "NOTIFY_ON_UPDATE" },
			],
			["GET", `/flightClass/${ISSUER_ID}.fx-flight`, undefined],
			["PATCH", `/flightObject/${ISSUER_ID}.flight-001`, flightObject],
		]);
	});

	it("creates the missing class, then the object without the notify flag", async () => {
		const stub = stubGoogleFetch((request) =>
			request.method === "PATCH" ? new Response("", { status: 404 }) : undefined
		);
		const classId = `${ISSUER_ID}.fx-flight`;
		const objectId = `${ISSUER_ID}.flight-001`;
		const objectBody = buildObjectBody(
			boardingPass.pass,
			boardingPass.create,
			classId,
			objectId
		);

		await expect(
			provider.update(
				{ template: boardingPass.pass, content: boardingPass.create },
				{ notify: true }
			)
		).resolves.toBe("created");

		expect(calls(stub)).toEqual([
			["GET", `/flightClass/${classId}`, undefined],
			[
				"POST",
				"/flightClass",
				{ id: classId, ...buildClassBody(boardingPass.pass) },
			],
			[
				"PATCH",
				`/flightObject/${objectId}`,
				{ ...objectBody, notifyPreference: "NOTIFY_ON_UPDATE" },
			],
			["POST", "/flightObject", objectBody],
		]);
	});

	it("surfaces errors other than a missing object without inserting", async () => {
		const stub = stubGoogleFetch(
			(request) => existingClasses(request) ?? new Response("", { status: 403 })
		);

		await expect(
			provider.update(
				{ template: boardingPass.pass, content: boardingPass.create },
				{}
			)
		).rejects.toMatchObject({ code: "GOOGLE_ACCESS_DENIED" });
		expect(stub.requests.map((r) => r.method)).toEqual(["GET", "PATCH"]);
	});
});

describe("GoogleProvider.expire", () => {
	it("marks the vertical's object expired", async () => {
		const stub = stubGoogleFetch();
		await provider.expire(transit.pass, "transit-001");
		await provider.expire(boardingPass.pass, "flight-001");
		expect(calls(stub)).toEqual([
			[
				"PATCH",
				`/transitObject/${ISSUER_ID}.transit-001`,
				{ state: "EXPIRED" },
			],
			["PATCH", `/flightObject/${ISSUER_ID}.flight-001`, { state: "EXPIRED" }],
		]);
	});
});
