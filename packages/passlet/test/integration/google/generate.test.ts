import { createPublicKey } from "node:crypto";
import { jwtVerify, SignJWT } from "jose";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import {
	buildClassBody,
	buildObjectBody,
	deleteGooglePass,
	expireGooglePass,
	generateGooglePass,
	publishGooglePass,
	updateGooglePass,
} from "../../../src/providers/google/index";
import { FIXTURES, type Fixture } from "../../support/fixtures";
import {
	decodeJwt,
	decodeJwtObject,
	type GoogleFetchStub,
	googleCredentials,
	ISSUER_ID,
	stubGoogleFetch,
} from "../../support/google";

const credentials = googleCredentials();
const { loyalty, flight, transit } = FIXTURES;

async function generate(
	fixture: Fixture,
	creds = credentials
): Promise<string> {
	const { pass, warnings } = await generateGooglePass(
		fixture.pass,
		fixture.create,
		creds
	);
	if (!pass) {
		throw new Error("expected a JWT");
	}
	expect(warnings).toEqual([]);
	return pass;
}

/** `[method, path, body]` of every Wallet request, in order. */
function calls(stub: GoogleFetchStub): unknown[][] {
	return stub.requests.map((r) => [r.method, r.path, r.body]);
}

describe("generateGooglePass", () => {
	it("creates the class, then signs a save-to-wallet JWT carrying the object", async () => {
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
			payload: {
				loyaltyObjects: [
					buildObjectBody(loyalty.pass, loyalty.create, classId, objectId),
				],
			},
		});
	});

	it("rejects invalid recipient data before making Google requests", async () => {
		const stub = stubGoogleFetch();
		await expect(
			generate(
				{
					pass: flight.pass,
					create: { ...flight.create, values: {} },
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
			["GET", `/loyaltyClass/${classId}`, undefined],
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
		{ label: "an air pass", fixture: flight, vertical: "flight" },
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
		]);
		expect(decodeJwtObject(jwt, `${vertical}Object`)).toEqual(
			buildObjectBody(fixture.pass, fixture.create, classId, objectId)
		);
	});

	it("normalizes save-to-wallet JWT signing failures with their Error cause", async () => {
		const cause = new Error("Signing unavailable");
		const originalSign = SignJWT.prototype.sign;
		const sign = vi
			.spyOn(SignJWT.prototype, "sign")
			.mockImplementationOnce(originalSign)
			.mockRejectedValueOnce(cause);
		onTestFinished(() => {
			sign.mockRestore();
		});
		const stub = stubGoogleFetch();
		const scoped = googleCredentials({
			clientEmail: "save-signing@test-project.iam.gserviceaccount.com",
		});

		await expect(generate(loyalty, scoped)).rejects.toMatchObject({
			code: "GOOGLE_SIGNING_FAILED",
			cause,
		});
		// OAuth signing succeeded and the class exists; only the save JWT failed.
		expect(stub.requests.map((request) => request.method)).toEqual([
			"GET",
			"POST",
		]);
	});
});

describe("publishGooglePass", () => {
	it.each([
		{ fixture: loyalty, vertical: "loyalty" },
		{ fixture: flight, vertical: "flight" },
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

		await publishGooglePass(fixture.pass, credentials);

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

describe("updateGooglePass", () => {
	it("patches the vertical's object with the rebuilt body and the notify flag", async () => {
		const stub = stubGoogleFetch();
		const transitObject = buildObjectBody(
			transit.pass,
			transit.create,
			`${ISSUER_ID}.fx-transit`,
			`${ISSUER_ID}.transit-001`
		);
		const flightObject = buildObjectBody(
			flight.pass,
			flight.create,
			`${ISSUER_ID}.fx-flight`,
			`${ISSUER_ID}.flight-001`
		);

		await updateGooglePass(transit.pass, transit.create, credentials, {
			notify: true,
		});
		await updateGooglePass(flight.pass, flight.create, credentials);

		expect(calls(stub)).toEqual([
			[
				"PATCH",
				`/transitObject/${ISSUER_ID}.transit-001`,
				{ ...transitObject, notifyPreference: "NOTIFY_ON_UPDATE" },
			],
			["PATCH", `/flightObject/${ISSUER_ID}.flight-001`, flightObject],
		]);
	});
});

describe("expireGooglePass", () => {
	it("marks the vertical's object expired", async () => {
		const stub = stubGoogleFetch();
		await expireGooglePass(transit.pass, "transit-001", credentials);
		await expireGooglePass(flight.pass, "flight-001", credentials);
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

describe("deleteGooglePass", () => {
	it("deletes the vertical's object", async () => {
		const stub = stubGoogleFetch();
		await deleteGooglePass(transit.pass, "transit-001", credentials);
		await deleteGooglePass(flight.pass, "flight-001", credentials);
		expect(calls(stub)).toEqual([
			["DELETE", `/transitObject/${ISSUER_ID}.transit-001`, undefined],
			["DELETE", `/flightObject/${ISSUER_ID}.flight-001`, undefined],
		]);
	});
});
