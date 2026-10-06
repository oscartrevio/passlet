import JSZip from "jszip";
import { beforeAll, describe, expect, it, onTestFinished, vi } from "vitest";
import { appleAuthToken } from "../../src/apple/auth-token";
import {
	type AppleCredentials,
	type PassContent,
	type PassTemplate,
	Wallet,
	WalletError,
} from "../../src/index";
import {
	appleCredentials,
	ICON,
	memoryRegistrations,
	PASS_TYPE_IDENTIFIER,
	type Pkpass,
	parseSignature,
	readPkpass,
} from "../support/apple";
import { FIXTURES, walletTemplate } from "../support/fixtures";
import {
	decodeJwt,
	googleCredentials,
	ISSUER_ID,
	stubGoogleFetch,
} from "../support/google";

const SECRET = "s".repeat(32);
const { loyalty, eventTicket, boardingPass } = FIXTURES;

let apple: AppleCredentials & { signerKey: string };

beforeAll(() => {
	apple = appleCredentials();
});

function appleWallet(): Wallet {
	return new Wallet({
		apple: {
			...apple,
			webService: {
				url: "https://example.com/api/wallet",
				secret: SECRET,
				registrations: memoryRegistrations(),
			},
		},
		load: () => null,
	});
}

/** Every `.pkpass` inside a `.pkpasses` bundle, keyed by member name. */
async function readBundle(bytes: Uint8Array): Promise<Record<string, Pkpass>> {
	const zip = await JSZip.loadAsync(bytes);
	const passes: Record<string, Pkpass> = {};
	for (const [name, entry] of Object.entries(zip.files)) {
		passes[name] = await readPkpass(await entry.async("uint8array"));
	}
	return passes;
}

async function rejection(promise: Promise<unknown>): Promise<WalletError> {
	const error = await promise.then(
		() => {
			throw new Error("expected a rejection");
		},
		(reason: unknown) => reason
	);
	expect(error).toBeInstanceOf(WalletError);
	return error as WalletError;
}

describe("wallet.createBundle on Apple", () => {
	it("bundles one signed .pkpass per item, each with its own update token", async () => {
		const wallet = appleWallet();
		const card = walletTemplate(wallet, loyalty.pass);
		const ticket = walletTemplate(wallet, eventTicket.pass);
		const serials = ["many-1", "many-2", "many-3"];

		const issued = await wallet.createBundle([
			{
				template: card,
				content: { ...loyalty.create, serialNumber: "many-1" },
			},
			{
				template: ticket,
				content: { ...eventTicket.create, serialNumber: "many-2" },
			},
			{
				template: card,
				content: { ...loyalty.create, serialNumber: "many-3" },
			},
		]);
		if (!issued.apple) {
			throw new Error("no .pkpasses issued");
		}
		expect(issued.google).toBeNull();

		const passes = await readBundle(issued.apple);
		expect(Object.keys(passes).sort()).toEqual([
			"0.pkpass",
			"1.pkpass",
			"2.pkpass",
		]);
		for (const [index, serialNumber] of serials.entries()) {
			const pass = passes[`${index}.pkpass`];
			if (!pass) {
				throw new Error(`${index}.pkpass missing`);
			}
			const signed = parseSignature(pass.signature);
			expect(signed.messageDigestHex).toBe(pass.sha1["manifest.json"]);
			expect(signed.verifies(apple.signerCert)).toBe(true);
			expect(pass.passJson).toMatchObject({
				passTypeIdentifier: PASS_TYPE_IDENTIFIER,
				serialNumber,
				authenticationToken: appleAuthToken(
					SECRET,
					PASS_TYPE_IDENTIFIER,
					serialNumber
				),
			});
		}
		expect(passes["1.pkpass"]?.passJson.eventTicket).toBeDefined();
	});

	it("returns a bundle even for one item", async () => {
		const wallet = new Wallet({ apple });
		const { apple: bytes } = await wallet.createBundle([
			{
				template: walletTemplate(wallet, loyalty.pass),
				content: loyalty.create,
			},
		]);
		if (!bytes) {
			throw new Error("no .pkpasses issued");
		}
		const passes = await readBundle(bytes);
		expect(Object.keys(passes)).toEqual(["0.pkpass"]);
		expect(passes["0.pkpass"]?.passJson.serialNumber).toBe(
			loyalty.create.serialNumber
		);
	});

	it("downloads each template's images once per batch", async () => {
		const fetchImage = vi.fn((_url: string) =>
			Promise.resolve(new Response(ICON.base))
		);
		vi.stubGlobal("fetch", fetchImage);
		onTestFinished(() => {
			vi.unstubAllGlobals();
		});
		const wallet = new Wallet({ apple });
		const first = wallet.generic({
			id: "a",
			name: "A",
			fields: [],
			apple: { icon: "https://cdn.example.com/a.png" },
		});
		const second = wallet.generic({
			id: "b",
			name: "B",
			fields: [],
			apple: { icon: "https://cdn.example.com/b.png" },
		});

		await wallet.createBundle([
			{ template: first, content: { serialNumber: "a-1" } },
			{ template: first, content: { serialNumber: "a-2" } },
			{ template: second, content: { serialNumber: "b-1" } },
			{ template: first, content: { serialNumber: "a-3" } },
		]);

		expect(fetchImage.mock.calls.map(([url]) => url).sort()).toEqual([
			"https://cdn.example.com/a.png",
			"https://cdn.example.com/b.png",
		]);
	});

	it("rejects a bundle over Apple's 150 MB limit", async () => {
		const wallet = new Wallet({ apple });
		const heavy = wallet.generic({
			id: "heavy",
			name: "Heavy",
			fields: [],
			apple: { icon: new Uint8Array(76_000_000) },
		});
		const error = await rejection(
			wallet.createBundle([
				{ template: heavy, content: { serialNumber: "heavy-1" } },
				{ template: heavy, content: { serialNumber: "heavy-2" } },
			])
		);
		expect(error.code).toBe("PASS_BUNDLE_INVALID");
	});
});

describe("wallet.createBundle checks", () => {
	function items(
		template: PassTemplate,
		count: number
	): { template: PassTemplate; content: PassContent }[] {
		return Array.from({ length: count }, (_, index) => ({
			template,
			content: { serialNumber: `item-${index}` },
		}));
	}

	it.each([0, 11])("rejects %i items", async (count) => {
		const wallet = new Wallet({ apple });
		const error = await rejection(
			wallet.createBundle(items(walletTemplate(wallet, loyalty.pass), count))
		);
		expect(error.code).toBe("PASS_BUNDLE_INVALID");
		expect(error.message).toContain(String(count));
	});

	it("rejects two items with the same serial number", async () => {
		const wallet = new Wallet({ apple });
		const card = walletTemplate(wallet, loyalty.pass);
		const ticket = walletTemplate(wallet, eventTicket.pass);
		const error = await rejection(
			wallet.createBundle([
				{ template: card, content: { serialNumber: "same" } },
				{ template: ticket, content: { serialNumber: "same" } },
			])
		);
		expect(error.code).toBe("PASS_BUNDLE_INVALID");
		expect(error.message).toContain("items[1]");
	});

	it("rejects a template built by another wallet", async () => {
		const wallet = new Wallet({ apple });
		const foreign = walletTemplate(new Wallet({ apple }), loyalty.pass);
		const error = await rejection(
			wallet.createBundle([
				{
					template: walletTemplate(wallet, eventTicket.pass),
					content: eventTicket.create,
				},
				{ template: foreign, content: loyalty.create },
			])
		);
		expect(error.code).toBe("PASS_BUNDLE_INVALID");
		expect(error.message).toContain("items[1]");
	});

	it("validates every item's content", async () => {
		const wallet = new Wallet({ apple });
		const error = await rejection(
			wallet.createBundle([
				{
					template: walletTemplate(wallet, loyalty.pass),
					content: { serialNumber: "" },
				},
			])
		);
		expect(error.code).toBe("CREATE_CONFIG_INVALID");
	});
});

describe("wallet.createBundle on Google", () => {
	it("writes every object, checks each class once and signs one JWT grouped by object type", async () => {
		const stub = stubGoogleFetch();
		const credentials = googleCredentials();
		const wallet = new Wallet({ google: credentials });
		const card = walletTemplate(wallet, loyalty.pass);
		const boarding = walletTemplate(wallet, boardingPass.pass);
		const loyaltyClass = `${ISSUER_ID}.${loyalty.pass.id}`;
		const flightClass = `${ISSUER_ID}.${boardingPass.pass.id}`;

		const { apple: bytes, google: jwt } = await wallet.createBundle([
			{ template: card, content: { ...loyalty.create, serialNumber: "g-1" } },
			{
				template: boarding,
				content: { ...boardingPass.create, serialNumber: "g-2" },
			},
			{ template: card, content: { ...loyalty.create, serialNumber: "g-3" } },
		]);

		expect(bytes).toBeNull();
		expect(stub.requests.map(({ method, path }) => [method, path])).toEqual([
			["GET", `/loyaltyClass/${loyaltyClass}`],
			["POST", "/loyaltyClass"],
			["GET", `/flightClass/${flightClass}`],
			["POST", "/flightClass"],
			["PATCH", `/loyaltyObject/${ISSUER_ID}.g-1`],
			["PATCH", `/flightObject/${ISSUER_ID}.g-2`],
			["PATCH", `/loyaltyObject/${ISSUER_ID}.g-3`],
		]);
		if (!jwt) {
			throw new Error("no JWT issued");
		}
		expect(decodeJwt(jwt).claims.payload).toEqual({
			loyaltyObjects: [
				{ id: `${ISSUER_ID}.g-1`, classId: loyaltyClass },
				{ id: `${ISSUER_ID}.g-3`, classId: loyaltyClass },
			],
			flightObjects: [{ id: `${ISSUER_ID}.g-2`, classId: flightClass }],
		});
	});

	it("writes nothing when any item is invalid for Google", async () => {
		const stub = stubGoogleFetch();
		const wallet = new Wallet({ google: googleCredentials() });
		const boarding = walletTemplate(wallet, boardingPass.pass);
		// Google flight objects need the passenger name.
		await expect(
			wallet.createBundle([
				{ template: boarding, content: boardingPass.create },
				{ template: boarding, content: { serialNumber: "no-passenger" } },
			])
		).rejects.toMatchObject({ code: "GOOGLE_FLIGHT_MISSING_PASSENGER_NAME" });
		expect(stub.requests).toEqual([]);
	});
});

describe("content.group", () => {
	it("sets Apple's groupingIdentifier on event tickets and boarding passes only", async () => {
		const wallet = new Wallet({ apple });
		const { apple: bytes } = await wallet.createBundle([
			{
				template: walletTemplate(wallet, eventTicket.pass),
				content: { ...eventTicket.create, group: "trip-1" },
			},
			{
				template: walletTemplate(wallet, boardingPass.pass),
				content: { ...boardingPass.create, group: "trip-1" },
			},
			{
				template: walletTemplate(wallet, loyalty.pass),
				content: { ...loyalty.create, group: "trip-1" },
			},
		]);
		if (!bytes) {
			throw new Error("no .pkpasses issued");
		}
		const passes = await readBundle(bytes);
		expect(passes["0.pkpass"]?.passJson.groupingIdentifier).toBe("trip-1");
		expect(passes["1.pkpass"]?.passJson.groupingIdentifier).toBe("trip-1");
		expect(passes["2.pkpass"]?.passJson).not.toHaveProperty(
			"groupingIdentifier"
		);
	});

	it("sets Google's groupingInfo.groupingId on every object", async () => {
		const stub = stubGoogleFetch();
		const wallet = new Wallet({ google: googleCredentials() });
		await wallet.createBundle([
			{
				template: walletTemplate(wallet, boardingPass.pass),
				content: { ...boardingPass.create, group: "trip-1" },
			},
			{
				template: walletTemplate(wallet, loyalty.pass),
				content: { ...loyalty.create, group: "trip-1" },
			},
		]);
		expect(stub.body("PATCH", "/flightObject/").groupingInfo).toEqual({
			groupingId: "trip-1",
		});
		expect(stub.body("PATCH", "/loyaltyObject/").groupingInfo).toEqual({
			groupingId: "trip-1",
		});
	});
});
