// Issues every fixture against the live Wallet API with the service account
// from .env, then drives every other Google write (update, expire,
// sendMessage, publish) and reads the result back through the REST API with
// a client written here, independent of passlet's. Skips cleanly when
// GOOGLE_ISSUER_ID is absent.
import { createPrivateKey, sign } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import type { GoogleVertical } from "../../src/google/utils";
import {
	type GoogleCredentials,
	googleSaveUrl,
	type PassContent,
	type PassTemplate,
	Wallet,
} from "../../src/index";
import {
	type FixtureName,
	fixtures,
	walletTemplate,
} from "../support/fixtures";
import { decodeJwt, decodeJwtObject } from "../support/google";

const CASES: { name: FixtureName; vertical: GoogleVertical }[] = [
	{ name: "loyalty", vertical: "loyalty" },
	{ name: "eventTicket", vertical: "eventTicket" },
	{ name: "boardingPass", vertical: "flight" },
	{ name: "transit", vertical: "transit" },
	{ name: "coupon", vertical: "offer" },
	{ name: "giftCard", vertical: "giftCard" },
	{ name: "generic", vertical: "generic" },
];

const WALLET_BASE = "https://walletobjects.googleapis.com/walletobjects/v1";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

// Google reads enums back as their legacy lowercase aliases ("expired").
function googleEnum(value: string) {
	return expect.stringMatching(new RegExp(`^${value}$`, "i"));
}

function requireEnv(name: string): string {
	const value = process.env[name];
	if (!value) {
		throw new Error(`${name} is not set`);
	}
	return value;
}

type Rest = (
	method: "GET" | "PATCH",
	path: string,
	body?: object
) => Promise<Record<string, unknown>>;

// Google's documented service-account flow, so reads and out-of-band writes
// do not go through the code under test.
// https://developers.google.com/identity/protocols/oauth2/service-account#httprest
async function restClient({
	clientEmail,
	privateKey,
}: GoogleCredentials): Promise<Rest> {
	const encode = (part: object) =>
		Buffer.from(JSON.stringify(part)).toString("base64url");
	const iat = Math.floor(Date.now() / 1000);
	const unsigned = `${encode({ alg: "RS256", typ: "JWT" })}.${encode({
		iss: clientEmail,
		scope: "https://www.googleapis.com/auth/wallet_object.issuer",
		aud: TOKEN_URL,
		iat,
		exp: iat + 3600,
	})}`;
	const signature = sign(
		"sha256",
		Buffer.from(unsigned),
		createPrivateKey(privateKey.replace(/\\n/g, "\n"))
	).toString("base64url");
	const tokenResponse = await fetch(TOKEN_URL, {
		method: "POST",
		body: new URLSearchParams({
			grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
			assertion: `${unsigned}.${signature}`,
		}),
	});
	const { access_token: token } = await tokenResponse.json();
	return async (method, path, body) => {
		const response = await fetch(`${WALLET_BASE}${path}`, {
			method,
			headers: {
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/json",
			},
			body: body && JSON.stringify(body),
		});
		if (!response.ok) {
			throw new Error(
				`${method} ${path}: ${response.status} ${await response.text()}`
			);
		}
		return await response.json();
	};
}

describe.skipIf(!process.env.GOOGLE_ISSUER_ID)(
	"Google Wallet against the live API",
	() => {
		// Google fetches class logos, so a public URL from .env replaces the
		// example.com placeholder when one is configured.
		const FIXTURES = fixtures({ logo: process.env.GOOGLE_LOGO_URL });
		let google: GoogleCredentials;
		let rest: Rest;

		beforeAll(async () => {
			google = {
				issuerId: requireEnv("GOOGLE_ISSUER_ID"),
				clientEmail: requireEnv("GOOGLE_CLIENT_EMAIL"),
				privateKey: requireEnv("GOOGLE_PRIVATE_KEY"),
			};
			rest = await restClient(google);
		});

		it.each(
			CASES
		)("$name: publishes the class and signs a save JWT for its $vertical object", async ({
			name,
			vertical,
		}) => {
			const { pass, create } = FIXTURES[name];
			const serialNumber = `e2e-${create.serialNumber}`;
			const template = walletTemplate(new Wallet({ google }), pass);
			await template.publish();
			const issued = await template.create({
				...create,
				serialNumber,
			});
			const jwt = issued.google;
			if (!jwt) {
				throw new Error("no Google pass was issued");
			}
			expect(decodeJwtObject(jwt, vertical)).toMatchObject({
				id: `${google.issuerId}.${serialNumber}`,
				classId: `${google.issuerId}.${pass.id}`,
			});
			expect(
				googleSaveUrl(jwt).startsWith("https://pay.google.com/gp/v/save/")
			).toBe(true);
		});

		it("createBundle writes two objects of different templates and signs one JWT naming both", async () => {
			const wallet = new Wallet({ google });
			const { eventTicket, boardingPass } = FIXTURES;
			const { google: jwt } = await wallet.createBundle([
				{
					template: walletTemplate(wallet, eventTicket.pass),
					content: {
						...eventTicket.create,
						serialNumber: "e2e-many-event",
						group: "e2e-many",
					},
				},
				{
					template: walletTemplate(wallet, boardingPass.pass),
					content: {
						...boardingPass.create,
						serialNumber: "e2e-many-flight",
						group: "e2e-many",
					},
				},
			]);
			if (!jwt) {
				throw new Error("no Google pass was issued");
			}
			expect(decodeJwt(jwt).claims.payload).toEqual({
				eventTicketObjects: [
					{
						id: `${google.issuerId}.e2e-many-event`,
						classId: `${google.issuerId}.${eventTicket.pass.id}`,
					},
				],
				flightObjects: [
					{
						id: `${google.issuerId}.e2e-many-flight`,
						classId: `${google.issuerId}.${boardingPass.pass.id}`,
					},
				],
			});
		});

		it("update writes a value with notify, then clears it once it is null", async () => {
			const { loyalty } = FIXTURES;
			const serialNumber = "e2e-update";
			const objectPath = `/loyaltyObject/${google.issuerId}.${serialNumber}`;
			let content: Omit<PassContent, "serialNumber"> = {
				values: { points: "777", tier: "Platinum" },
			};
			let template: PassTemplate | undefined;
			const wallet = new Wallet({
				google,
				load: () =>
					template ? { template, content, updatedAt: new Date() } : null,
			});
			template = walletTemplate(wallet, loyalty.pass);

			await wallet.update(serialNumber, { notify: true });
			expect(await rest("GET", objectPath)).toMatchObject({
				state: googleEnum("ACTIVE"),
				loyaltyPoints: { balance: { string: "777" } },
				textModulesData: expect.arrayContaining([
					expect.objectContaining({ id: "tier", body: "Platinum" }),
				]),
			});

			content = { values: { points: null, tier: null } };
			await expect(wallet.update(serialNumber)).resolves.toEqual({
				apple: null,
				google: "updated",
			});
			const cleared = await rest("GET", objectPath);
			expect(cleared).not.toHaveProperty("loyaltyPoints");
			expect(JSON.stringify(cleared.textModulesData ?? [])).not.toContain(
				"Platinum"
			);
		});

		it("expire moves the object to EXPIRED and a re-issue keeps it there", async () => {
			const { coupon } = FIXTURES;
			const serialNumber = "e2e-expire";
			const template = walletTemplate(new Wallet({ google }), coupon.pass);
			await template.create({ ...coupon.create, serialNumber });

			await template.expire(serialNumber);
			await template.create({ ...coupon.create, serialNumber });

			expect(
				await rest("GET", `/offerObject/${google.issuerId}.${serialNumber}`)
			).toMatchObject({ state: googleEnum("EXPIRED") });
		});

		it("sendMessage adds a TEXT message to the object", async () => {
			const { generic } = FIXTURES;
			const serialNumber = "e2e-message";
			const template = walletTemplate(new Wallet({ google }), generic.pass);
			// Re-issuing clears earlier runs' messages, as the content has none.
			await template.create({ ...generic.create, serialNumber });
			const id = `e2e-${Date.now()}`;

			await template.sendMessage(serialNumber, {
				id,
				header: "e2e",
				body: "Sent by the passlet e2e suite",
				messageType: "TEXT",
			});

			const object = await rest(
				"GET",
				`/genericObject/${google.issuerId}.${serialNumber}`
			);
			expect(object.messages).toEqual([
				expect.objectContaining({ id, messageType: googleEnum("TEXT") }),
			]);
		});

		// Airlines patch the class gate out of band; a publish must not wipe it.
		// https://developers.google.com/wallet/tickets/boarding-passes/use-cases/trigger-push-notifications
		it("publish keeps a flight class gate set outside passlet", async () => {
			const { boardingPass } = FIXTURES;
			const classPath = `/flightClass/${google.issuerId}.${boardingPass.pass.id}`;
			const template = walletTemplate(
				new Wallet({ google }),
				boardingPass.pass
			);
			await template.publish();
			const gate = `G${Date.now() % 100}`;
			await rest("PATCH", classPath, {
				origin: { gate, terminal: "4" },
				reviewStatus: "UNDER_REVIEW",
			});

			await template.publish();

			expect(await rest("GET", classPath)).toMatchObject({
				origin: { airportIataCode: "JFK", gate, terminal: "4" },
				destination: { airportIataCode: "LAX" },
			});
		});

		// Templates take W3C timestamps to the minute, but Google's DateTime and
		// local date-time docs only show examples with seconds, so check the API
		// takes minute precision on every kind of date passlet sends.
		// https://developers.google.com/wallet/reference/rest/v1/DateTime
		it("accepts minute-precision dates on events, flights and validity", async () => {
			const { eventTicket, boardingPass } = FIXTURES;
			if (
				!(
					eventTicket.pass.type === "eventTicket" &&
					boardingPass.pass.type === "boardingPass"
				)
			) {
				throw new Error("fixture types changed");
			}
			const wallet = new Wallet({ google });
			const event = walletTemplate(wallet, {
				...eventTicket.pass,
				id: "fx-event-minutes",
				startsAt: "2026-07-15T20:00-04:00",
				endsAt: "2026-07-15T23:30-04:00",
			});
			const flight = walletTemplate(wallet, {
				...boardingPass.pass,
				id: "fx-flight-minutes",
				departure: "2026-11-02T13:05",
				arrival: "2026-11-02T16:40",
			});
			await Promise.all([event.publish(), flight.publish()]);
			await event.create({
				...eventTicket.create,
				serialNumber: "e2e-minutes-event",
				validFrom: "2026-07-01T09:00-04:00",
				expiresAt: "2026-07-16T02:00-04:00",
			});
			await flight.create({
				...boardingPass.create,
				serialNumber: "e2e-minutes-flight",
			});

			const id = (suffix: string) => `${google.issuerId}.${suffix}`;
			const [eventClass, eventObject, flightClass] = await Promise.all([
				rest("GET", `/eventTicketClass/${id("fx-event-minutes")}`),
				rest("GET", `/eventTicketObject/${id("e2e-minutes-event")}`),
				rest("GET", `/flightClass/${id("fx-flight-minutes")}`),
			]);
			expect(eventClass.dateTime).toMatchObject({
				start: expect.stringContaining("2026-07-15T20:00"),
				end: expect.stringContaining("2026-07-15T23:30"),
			});
			expect(eventObject.validTimeInterval).toMatchObject({
				start: { date: expect.stringContaining("2026-07-01T09:00") },
				end: { date: expect.stringContaining("2026-07-16T02:00") },
			});
			expect(flightClass).toMatchObject({
				localScheduledDepartureDateTime:
					expect.stringContaining("2026-11-02T13:05"),
				localScheduledArrivalDateTime:
					expect.stringContaining("2026-11-02T16:40"),
			});
		});

		it("stores app links as Google documents them", async () => {
			const { loyalty } = FIXTURES;
			const id = "fx-loyalty-app-link";
			const template = walletTemplate(new Wallet({ google }), {
				...loyalty.pass,
				id,
				google: {
					...loyalty.pass.google,
					appLinkData: {
						android: { packageName: "com.google.android.gm" },
						web: {
							uri: "https://mail.google.com/mail/",
							description: "Web link for Gmail",
						},
						displayText: "Open the app",
					},
				},
			});
			await template.publish();

			const loyaltyClass = await rest(
				"GET",
				`/loyaltyClass/${google.issuerId}.${id}`
			);
			expect(loyaltyClass.appLinkData).toMatchObject({
				androidAppLinkInfo: {
					appTarget: { packageName: "com.google.android.gm" },
				},
				webAppLinkInfo: {
					appTarget: {
						targetUri: {
							uri: "https://mail.google.com/mail/",
							description: "Web link for Gmail",
						},
					},
				},
				displayText: { defaultValue: { value: "Open the app" } },
			});
		});
	}
);
