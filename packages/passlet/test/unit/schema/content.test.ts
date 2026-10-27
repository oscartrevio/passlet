import { describe, expect, it } from "vitest";
import {
	type GooglePassMessage,
	type PassContent,
	WalletError,
} from "../../../src/index";
import { Wallet } from "../../../src/wallet";
import { googleCredentials, LOGO_URL } from "../../support/google";

const template = new Wallet({}).generic({ id: "t-1", name: "Test" });

async function issuesOf(content: object) {
	// Rows hold content the types reject on purpose, to reach the runtime checks.
	const invalid = { serialNumber: "s-1", ...content } as PassContent;
	const error = await template.create(invalid).catch((e: unknown) => e);
	if (!(error instanceof WalletError)) {
		throw new Error("expected CREATE_CONFIG_INVALID");
	}
	expect(error).toMatchObject({ code: "CREATE_CONFIG_INVALID", status: 400 });
	return error.issues.map((issue) => issue.path);
}

const rotating = {
	valuePattern: "https://example.com/{totp_value_hex}",
	totpDetails: { parameters: [{ key: "K1", valueLength: 8 }] },
};

describe("content validation through create()", () => {
	it.each<[string, object, (string | number)[][]]>([
		["an empty serialNumber", { serialNumber: "" }, [["serialNumber"]]],
		["a missing serialNumber", { serialNumber: undefined }, [["serialNumber"]]],
		[
			"an empty barcode value",
			{ barcode: { value: "" } },
			[["barcode", "value"]],
		],
		[
			"an unknown format in a later barcode",
			{ barcodes: [{ value: "1" }, { value: "2", format: "QRCODE" }] },
			[["barcodes", 1, "format"]],
		],
		["a date without a time", { validFrom: "2024-01-01" }, [["validFrom"]]],
		[
			"an expiry without a time zone",
			{ expiresAt: "2026-12-09T13:00:00" },
			[["expiresAt"]],
		],
		[
			"a number among the values",
			{ values: { points: 1 } },
			[["values", "points"]],
		],
		["an empty group", { group: "" }, [["group"]]],
		[
			"a rotating barcode type Google cannot rotate",
			{ google: { rotatingBarcode: { ...rotating, type: "AZTEC" } } },
			[["google", "rotatingBarcode", "type"]],
		],
		[
			"an empty rotating barcode pattern",
			{ google: { rotatingBarcode: { ...rotating, valuePattern: "" } } },
			[["google", "rotatingBarcode", "valuePattern"]],
		],
		[
			"a TOTP value longer than 8 digits",
			{
				google: {
					rotatingBarcode: {
						...rotating,
						totpDetails: { parameters: [{ key: "K1", valueLength: 9 }] },
					},
				},
			},
			[
				[
					"google",
					"rotatingBarcode",
					"totpDetails",
					"parameters",
					0,
					"valueLength",
				],
			],
		],
		[
			"a message without a header",
			{ google: { messages: [{ body: "B" }] } },
			[["google", "messages", 0, "header"]],
		],
		[
			"more than 10 value-added modules",
			{
				google: {
					valueAdded: Array.from({ length: 11 }, () => ({
						header: "Perk",
						uri: "https://example.com",
					})),
				},
			},
			[["google", "valueAdded"]],
		],

		[
			"a barcode altText that is no string",
			{ barcode: { value: "1", altText: 1 } },
			[["barcode", "altText"]],
		],
		[
			"a voided flag that is no boolean",
			{ apple: { voided: "yes" } },
			[["apple", "voided"]],
		],
		[
			"a trip type Google does not have",
			{ google: { tripType: "multiCity" } },
			[["google", "tripType"]],
		],
		[
			"a render encoding Google does not have",
			{
				google: { rotatingBarcode: { ...rotating, renderEncoding: "UTF_16" } },
			},
			[["google", "rotatingBarcode", "renderEncoding"]],
		],
	])("rejects %s", async (_, content, paths) => {
		expect(await issuesOf(content)).toEqual(paths);
	});

	// W3C timestamps, as Apple's expirationDate and Google's DateTime take them:
	// https://developer.apple.com/documentation/walletpasses/pass
	// https://developers.google.com/wallet/reference/rest/v1/DateTime
	it.each([
		"2026-12-09T13:00:00Z",
		"2026-12-09T13:00:00-07:00",
		"2026-12-09T13:00-07:00",
		"2026-12-09T13:00:00.123+05:30",
	])("accepts %s as validFrom and expiresAt", async (date) => {
		await expect(
			template.create({ serialNumber: "s-1", validFrom: date, expiresAt: date })
		).resolves.toEqual({ apple: null, google: null });
	});

	it("accepts the iOS 27 barcode formats", async () => {
		await expect(
			template.create({
				serialNumber: "s-1",
				barcodes: (["EAN13", "ITF", "Code39", "Codabar"] as const).map(
					(format) => ({ value: "12345", format })
				),
			})
		).resolves.toEqual({ apple: null, google: null });
	});
});

describe("sendMessage validation", () => {
	it("reports the failing member of the message, labelled as the message", async () => {
		const card = new Wallet({ google: googleCredentials() }).generic({
			id: "t-1",
			name: "Test",
			google: { logo: LOGO_URL },
		});
		// A string the types allow but that is no timestamp.
		const message = {
			header: "Hi",
			body: "B",
			displayInterval: { end: { date: "tomorrow" } },
		} satisfies GooglePassMessage;
		await expect(card.sendMessage("s-1", message)).rejects.toMatchObject({
			code: "CREATE_CONFIG_INVALID",
			message: expect.stringContaining("displayInterval.end.date: "),
			issues: [{ path: ["displayInterval", "end", "date"] }],
		});
	});
});
