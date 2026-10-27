import { describe, expect, it } from "vitest";
import { type TemplateConfig, WalletError } from "../../../src/index";
import { parseTemplate } from "../../../src/schema/template";
import { Wallet } from "../../../src/wallet";
import { walletTemplate } from "../../support/fixtures";

const NAMED = { id: "t-1", name: "Test" };

function build(config: object) {
	// Rows hold configs the types reject on purpose, to reach the runtime checks.
	const invalid = { type: "generic", ...config } as TemplateConfig;
	return walletTemplate(new Wallet({}), invalid);
}

function issuesOf(config: object) {
	try {
		build(config);
	} catch (error) {
		if (!(error instanceof WalletError)) {
			throw error;
		}
		expect(error).toMatchObject({ code: "PASS_CONFIG_INVALID", status: 400 });
		return error.issues.map((issue) => issue.path);
	}
	throw new Error("expected PASS_CONFIG_INVALID");
}

const field = (patch: object) => ({
	...NAMED,
	fields: [{ slot: "primary", key: "k", label: "K", ...patch }],
});

describe("template validation through the Wallet", () => {
	it.each<[string, object, (string | number)[][]]>([
		["an empty id", { ...NAMED, id: "" }, [["id"]]],
		["a missing name", { id: "t-1" }, [["name"]]],
		["a named color", { ...NAMED, color: "red" }, [["color"]]],
		[
			"every failing member at once",
			{ id: "", name: "", color: "red" },
			[["id"], ["name"], ["color"]],
		],
		[
			"a lowercase IATA carrier",
			{ ...NAMED, type: "boardingPass", carrier: "american" },
			[["carrier"]],
		],
		[
			"a lowercase IATA airport",
			{ ...NAMED, type: "boardingPass", origin: "jfk", destination: "lax" },
			[["origin"], ["destination"]],
		],
		[
			"a flight number with its carrier",
			{ ...NAMED, type: "boardingPass", flightNumber: "AA100" },
			[["flightNumber"]],
		],
		[
			"a lowercase currency code",
			{ ...NAMED, type: "giftCard", currency: "usd" },
			[["currency"]],
		],
		[
			"an event time that is no date",
			{ ...NAMED, type: "eventTicket", startsAt: "not-a-date" },
			[["startsAt"]],
		],
		[
			"a venue without a name",
			{ ...NAMED, type: "eventTicket", venue: { name: "", address: "1 Main" } },
			[["venue", "name"]],
		],
		[
			"a Google message type Google does not support",
			{
				...NAMED,
				google: {
					messages: [
						{ header: "Hi", body: "B", messageType: "EXPIRATION_NOTIFICATION" },
					],
				},
			},
			[["google", "messages", 0, "messageType"]],
		],
		[
			"a Google message display date without a time",
			{
				...NAMED,
				google: {
					messages: [
						{
							header: "Hi",
							body: "B",
							displayInterval: { start: { date: "2026-12-09" } },
						},
					],
				},
			},
			[["google", "messages", 0, "displayInterval", "start", "date"]],
		],
		[
			"a relevance interval without its end",
			{
				...NAMED,
				apple: { relevantDates: [{ startDate: "2026-06-01T20:00Z" }] },
			},
			[["apple", "relevantDates", 0, "endDate"]],
		],
		[
			"a relevance date without a time zone",
			{ ...NAMED, apple: { relevantDates: [{ date: "2025-12-09T13:00:00" }] } },
			[["apple", "relevantDates", 0, "date"]],
		],
		[
			"a relevance date on a day the month lacks",
			{ ...NAMED, apple: { relevantDates: [{ date: "2026-02-30T13:00Z" }] } },
			[["apple", "relevantDates", 0, "date"]],
		],
		[
			"a non-numeric value with numberStyle",
			field({ value: "lots", numberStyle: "decimal" }),
			[["fields", 0, "value"]],
		],
		[
			"a value that is no date with dateStyle",
			field({ value: "soon", dateStyle: "medium" }),
			[["fields", 0, "value"]],
		],
		[
			"a zone-less date with dateStyle",
			field({ value: "2024-06-01T20:00:00", dateStyle: "medium" }),
			[["fields", 0, "value"]],
		],
		[
			"a changeMessage without the %@ placeholder",
			field({ changeMessage: "Gate changed" }),
			[["fields", 0, "changeMessage"]],
		],
		[
			"an auxiliary row Apple does not have",
			field({ row: 2 }),
			[["fields", 0, "row"]],
		],
		[
			"more than 10 locations",
			{
				...NAMED,
				locations: Array.from({ length: 11 }, () => ({
					latitude: 0,
					longitude: 0,
				})),
			},
			[["locations"]],
		],
		[
			"a locale that is no BCP 47 tag",
			{ ...NAMED, locales: { EN: { name: "Test" } } },
			[["locales", "EN"]],
		],
		[
			"NFC without its encryption key",
			{ ...NAMED, apple: { nfc: { message: "tap" } } },
			[["apple", "nfc", "encryptionPublicKey"]],
		],
		[
			"an Apple image URL fetch cannot download",
			{ ...NAMED, apple: { icon: "ftp://example.com/icon.png" } },
			[["apple", "icon"]],
		],
		[
			"an Apple image that is neither URL nor bytes",
			{ ...NAMED, apple: { icon: 42 } },
			[["apple", "icon"]],
		],
		[
			"Apple image variants without a base",
			{ ...NAMED, apple: { icon: { retina: new Uint8Array(1) } } },
			[["apple", "icon", "base"]],
		],
		[
			"an appLaunchURL that is no URL",
			{ ...NAMED, apple: { appLaunchURL: "open my app" } },
			[["apple", "appLaunchURL"]],
		],
		[
			"a beacon major past 16 bits",
			{
				...NAMED,
				apple: {
					beacons: [
						{
							proximityUUID: "E2C56DB5-DFFB-48D2-B060-D0F5A71096E0",
							major: 70_000,
						},
					],
				},
			},
			[["apple", "beacons", 0, "major"]],
		],
		[
			"an App Store ID of 0",
			{ ...NAMED, apple: { associatedStoreIdentifiers: [0] } },
			[["apple", "associatedStoreIdentifiers", 0]],
		],
		[
			"a venue email that is no address",
			{ ...NAMED, type: "eventTicket", apple: { contactVenueEmail: "venue" } },
			[["apple", "contactVenueEmail"]],
		],
		[
			"a relative Google image URL",
			{ ...NAMED, google: { logo: "logo.png" } },
			[["google", "logo"]],
		],
		[
			"a Google link without a scheme",
			{ ...NAMED, google: { links: [{ uri: "example.com" }] } },
			[["google", "links", 0, "uri"]],
		],
		[
			"more than 10 Google value-added modules",
			{
				...NAMED,
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
			"a NaN latitude",
			{ ...NAMED, locations: [{ latitude: Number.NaN, longitude: 0 }] },
			[["locations", 0, "latitude"]],
		],
		[
			"an infinite longitude",
			{
				...NAMED,
				locations: [{ latitude: 0, longitude: Number.POSITIVE_INFINITY }],
			},
			[["locations", 0, "longitude"]],
		],
		[
			"an altitude that is no number",
			{
				...NAMED,
				locations: [{ latitude: 0, longitude: 0, altitude: "high" }],
			},
			[["locations", 0, "altitude"]],
		],
		[
			"a translation that is no string",
			{ ...NAMED, locales: { en: { name: 1 } } },
			[["locales", "en", "name"]],
		],
		[
			"a currencyCode that is no string",
			field({ currencyCode: 840 }),
			[["fields", 0, "currencyCode"]],
		],
		[
			"a value that is no date with timeStyle",
			field({ value: "soon", timeStyle: "short" }),
			[["fields", 0, "value"]],
		],
		[
			"a value that is neither numeric nor a date with both styles",
			field({ value: "soon", numberStyle: "decimal", dateStyle: "medium" }),
			[
				["fields", 0, "value"],
				["fields", 0, "value"],
			],
		],
		[
			"a venue without an address",
			{ ...NAMED, type: "eventTicket", venue: { name: "Hall", address: "" } },
			[["venue", "address"]],
		],
		[
			"an event end that is no date",
			{ ...NAMED, type: "eventTicket", endsAt: "later" },
			[["endsAt"]],
		],
		[
			"flight times that are no dates",
			{ ...NAMED, type: "boardingPass", departure: "soon", arrival: "later" },
			[["departure"], ["arrival"]],
		],
		[
			"a transit type Apple does not have",
			{ ...NAMED, type: "boardingPass", transitType: "plane" },
			[["transitType"]],
		],
		[
			"a redemption channel Google does not have",
			{ ...NAMED, type: "coupon", redemptionChannel: "mail" },
			[["redemptionChannel"]],
		],
		[
			"a maxDistance of 0",
			{ ...NAMED, apple: { maxDistance: 0 } },
			[["apple", "maxDistance"]],
		],
		[
			"a named foregroundColor",
			{ ...NAMED, apple: { foregroundColor: "white" } },
			[["apple", "foregroundColor"]],
		],
		[
			"a named labelColor",
			{ ...NAMED, apple: { labelColor: "white" } },
			[["apple", "labelColor"]],
		],
		[
			"a named footerBackgroundColor",
			{
				...NAMED,
				type: "eventTicket",
				apple: { footerBackgroundColor: "white" },
			},
			[["apple", "footerBackgroundColor"]],
		],
		[
			"a beacon minor past 16 bits",
			{
				...NAMED,
				apple: {
					beacons: [
						{
							proximityUUID: "E2C56DB5-DFFB-48D2-B060-D0F5A71096E0",
							minor: 70_000,
						},
					],
				},
			},
			[["apple", "beacons", 0, "minor"]],
		],
		[
			"an auxiliary App Store ID of 0",
			{
				...NAMED,
				type: "eventTicket",
				apple: { auxiliaryStoreIdentifiers: [0] },
			},
			[["apple", "auxiliaryStoreIdentifiers", 0]],
		],
		[
			"a transit provider email that is no address",
			{
				...NAMED,
				type: "boardingPass",
				apple: { transitProviderEmail: "airline" },
			},
			[["apple", "transitProviderEmail"]],
		],
		[
			"boarding pass links that are no URLs",
			{
				...NAMED,
				type: "boardingPass",
				apple: {
					changeSeatURL: "no url",
					entertainmentURL: "no url",
					managementURL: "no url",
					purchaseAdditionalBaggageURL: "no url",
					purchaseLoungeAccessURL: "no url",
					purchaseWifiURL: "no url",
					registerServiceAnimalURL: "no url",
					reportLostBagURL: "no url",
					requestWheelchairURL: "no url",
					trackBagsURL: "no url",
					transitProviderWebsiteURL: "no url",
					upgradeURL: "no url",
				},
			},
			[
				["apple", "changeSeatURL"],
				["apple", "entertainmentURL"],
				["apple", "managementURL"],
				["apple", "purchaseAdditionalBaggageURL"],
				["apple", "purchaseLoungeAccessURL"],
				["apple", "purchaseWifiURL"],
				["apple", "registerServiceAnimalURL"],
				["apple", "reportLostBagURL"],
				["apple", "requestWheelchairURL"],
				["apple", "trackBagsURL"],
				["apple", "transitProviderWebsiteURL"],
				["apple", "upgradeURL"],
			],
		],
		[
			"event ticket links that are no URLs",
			{
				...NAMED,
				type: "eventTicket",
				apple: {
					accessibilityURL: "no url",
					addOnURL: "no url",
					bagPolicyURL: "no url",
					contactVenueWebsite: "no url",
					directionsInformationURL: "no url",
					merchandiseURL: "no url",
					orderFoodURL: "no url",
					parkingInformationURL: "no url",
					purchaseParkingURL: "no url",
					sellURL: "no url",
					transferURL: "no url",
					transitInformationURL: "no url",
				},
			},
			[
				["apple", "accessibilityURL"],
				["apple", "addOnURL"],
				["apple", "bagPolicyURL"],
				["apple", "contactVenueWebsite"],
				["apple", "directionsInformationURL"],
				["apple", "merchandiseURL"],
				["apple", "orderFoodURL"],
				["apple", "parkingInformationURL"],
				["apple", "purchaseParkingURL"],
				["apple", "sellURL"],
				["apple", "transferURL"],
				["apple", "transitInformationURL"],
			],
		],
		[
			"a relevance interval without its start",
			{
				...NAMED,
				apple: { relevantDates: [{ endDate: "2026-06-01T20:00Z" }] },
			},
			[["apple", "relevantDates", 0, "startDate"]],
		],
		[
			"a relevance entry that is both a moment and an interval",
			{
				...NAMED,
				apple: {
					relevantDates: [
						{
							date: "2026-06-01T20:00Z",
							startDate: "2026-06-01T20:00Z",
							endDate: "2026-06-01T22:00Z",
						},
					],
				},
			},
			[["apple", "relevantDates", 0]],
		],
		[
			"a Google value-added module without a header",
			{
				...NAMED,
				google: { valueAdded: [{ header: "", uri: "https://example.com" }] },
			},
			[["google", "valueAdded", 0, "header"]],
		],
		[
			"a Google value-added module with bad members",
			{
				...NAMED,
				google: {
					valueAdded: [
						{
							header: "Perk",
							uri: "example.com",
							imageUrl: "perk.png",
							sortIndex: 1.5,
						},
					],
				},
			},
			[
				["google", "valueAdded", 0, "uri"],
				["google", "valueAdded", 0, "imageUrl"],
				["google", "valueAdded", 0, "sortIndex"],
			],
		],
		[
			"a relative Google image module URL",
			{ ...NAMED, google: { images: [{ url: "image.png" }] } },
			[["google", "images", 0, "url"]],
		],
		[
			"relative Google hero and wide logo URLs",
			{ ...NAMED, google: { hero: "hero.png", wideLogo: "wide.png" } },
			[
				["google", "hero"],
				["google", "wideLogo"],
			],
		],
		[
			"Google app links Google cannot open",
			{
				...NAMED,
				google: {
					appLinkData: {
						android: { packageName: "app" },
						web: { uri: "example.com", description: "" },
						displayText: "A button label longer than thirty characters",
					},
				},
			},
			[
				["google", "appLinkData", "android", "packageName"],
				["google", "appLinkData", "web", "uri"],
				["google", "appLinkData", "web", "description"],
				["google", "appLinkData", "displayText"],
			],
		],
		[
			"a review status Google does not have",
			{ ...NAMED, google: { reviewStatus: "LIVE" } },
			[["google", "reviewStatus"]],
		],
		[
			"Google transit types Google does not have",
			{
				...NAMED,
				type: "boardingPass",
				google: { transit: { transitType: "plane", tripType: "multiCity" } },
			},
			[
				["google", "transit", "transitType"],
				["google", "transit", "tripType"],
			],
		],
	])("rejects %s", (_, config, paths) => {
		expect(issuesOf(config)).toEqual(paths);
	});

	it.each<[string, object]>([
		[
			"relevance dates with a UTC offset, at minute or second precision",
			{
				...NAMED,
				apple: {
					relevantDates: [
						{ date: "2025-12-09T13:00-07:00" },
						{
							startDate: "2025-12-09T13:00:00+05:30",
							endDate: "2025-12-09T15:00:00.5+05:30",
						},
					],
				},
			},
		],
		[
			"zone-less and zoned event times",
			{
				...NAMED,
				type: "eventTicket",
				startsAt: "2024-06-01T20:00:00",
				endsAt: "2024-06-01T23:00-04:00",
			},
		],
		[
			"a flight with offset times and a generic transit type",
			{
				...NAMED,
				type: "boardingPass",
				transitType: "generic",
				departure: "2024-06-01T08:00:00+04:00",
				arrival: "2024-06-01T11:30",
			},
		],
		[
			"a static value matching its styles",
			{
				...NAMED,
				fields: [
					{ slot: "primary", key: "a", value: "1250", numberStyle: "decimal" },
					{
						slot: "secondary",
						key: "b",
						value: "2024-06-01T20:00:00-07:00",
						dateStyle: "medium",
					},
					// `none` opts out of Apple date rendering, so no zone is needed.
					{
						slot: "back",
						key: "c",
						value: "2024-06-01T20:00:00",
						dateStyle: "none",
					},
					{ slot: "back", key: "d", changeMessage: "Gate changed to %@" },
				],
			},
		],
		[
			"Google links of every documented scheme",
			{
				...NAMED,
				google: {
					links: [
						{ uri: "https://example.com" },
						{ uri: "tel:+15555550100" },
						{ uri: "mailto:help@example.com" },
						{ uri: "geo:40.7,-74.0" },
					],
				},
			},
		],
		[
			"an app deep link and a beacon UUID without version bits",
			{
				...NAMED,
				apple: {
					appLaunchURL: "myapp://open",
					associatedStoreIdentifiers: [123_456_789],
					beacons: [{ proximityUUID: "00000000-0000-0000-0000-000000000001" }],
				},
			},
		],
	])("accepts %s", (_, config) => {
		expect(() => build(config)).not.toThrow();
	});
});

describe("template defaults", () => {
	it("applies every default and drops keys the types do not name", () => {
		const wallet = new Wallet({});
		expect(
			wallet.coupon({
				...NAMED,
				google: { messages: [{ header: "Hi", body: "B" }] },
				// @ts-expect-error -- not a template option
				unknown: true,
			}).config
		).toEqual({
			...NAMED,
			type: "coupon",
			fields: [],
			redemptionChannel: "both",
			google: { messages: [{ header: "Hi", body: "B", messageType: "TEXT" }] },
		});
	});

	// Wallet's factories set `type`, so only the parser itself sees one.
	it("rejects a type that is only a prototype key", () => {
		const config = {
			...NAMED,
			type: "constructor",
		} as unknown as TemplateConfig;
		expect(() => parseTemplate(config)).toThrow(
			expect.objectContaining({
				issues: [expect.objectContaining({ path: ["type"] })],
			})
		);
	});

	it("omits members given as undefined", () => {
		const { config } = new Wallet({}).generic({ ...NAMED, color: undefined });
		expect(Object.hasOwn(config, "color")).toBe(false);
	});

	it("trims the URLs it takes", () => {
		const { config } = new Wallet({}).generic({
			...NAMED,
			apple: {
				appLaunchURL: " myapp://open ",
				icon: "\thttps://example.com/i.png",
			},
			google: { logo: " https://example.com/logo.png\n" },
		});
		expect(config.apple).toEqual({
			appLaunchURL: "myapp://open",
			icon: "https://example.com/i.png",
		});
		expect(config.google?.logo).toBe("https://example.com/logo.png");
	});

	it("drops Apple options of another pass type", () => {
		const { config } = new Wallet({}).loyalty({
			...NAMED,
			// @ts-expect-error -- a boarding pass option on a loyalty card
			apple: { upgradeURL: "https://example.com/upgrade" },
		});
		expect(config.apple).toEqual({});
	});

	it("gives every template its own fields list", () => {
		const wallet = new Wallet({});
		const first = wallet.generic(NAMED);
		expect(first.config.fields).not.toBe(wallet.generic(NAMED).config.fields);
	});
});
