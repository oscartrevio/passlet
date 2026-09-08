import { describe, expect, it } from "vitest";
import { createConfigSchema, passConfigSchema } from "../../src/types/schemas";

const BASE_LOYALTY = {
	type: "loyalty" as const,
	id: "test-pass",
	name: "Test Pass",
	fields: [],
};

const BASE_FLIGHT = {
	type: "flight" as const,
	id: "f1",
	name: "Flight",
	fields: [],
};

const BASE_EVENT = {
	type: "event" as const,
	id: "e1",
	name: "Event",
	fields: [],
};

const BASE_CREATE = {
	serialNumber: "serial-001",
};

const parsesPass = (config: unknown) =>
	passConfigSchema.safeParse(config).success;

const parsesCreate = (config: unknown) =>
	createConfigSchema.safeParse(config).success;

describe("passConfigSchema", () => {
	it("rejects an empty id or name", () => {
		expect(parsesPass({ ...BASE_LOYALTY, id: "" })).toBe(false);
		expect(parsesPass({ ...BASE_LOYALTY, name: "" })).toBe(false);
	});

	it("accepts a hex color and rejects a named color", () => {
		expect(parsesPass({ ...BASE_LOYALTY, color: "#1a2b3c" })).toBe(true);
		expect(parsesPass({ ...BASE_LOYALTY, color: "red" })).toBe(false);
	});

	it("rejects an unknown pass type", () => {
		expect(parsesPass({ ...BASE_LOYALTY, type: "unknown" })).toBe(false);
	});

	it("validates the IATA carrier code on flight passes", () => {
		expect(parsesPass({ ...BASE_FLIGHT, carrier: "AA" })).toBe(true);
		expect(parsesPass({ ...BASE_FLIGHT, carrier: "american" })).toBe(false);
	});

	it("validates IATA airport codes on flight passes", () => {
		expect(parsesPass({ ...BASE_FLIGHT, origin: "JFK" })).toBe(true);
		expect(parsesPass({ ...BASE_FLIGHT, origin: "jfk" })).toBe(false);
	});

	it("accepts generic as a flight transitType", () => {
		expect(parsesPass({ ...BASE_FLIGHT, transitType: "generic" })).toBe(true);
	});

	it("rejects a non-ISO datetime on event display times", () => {
		expect(parsesPass({ ...BASE_EVENT, startsAt: "not-a-date" })).toBe(false);
	});

	it("accepts offset-less local datetimes on event/flight display times", () => {
		expect(parsesPass({ ...BASE_EVENT, startsAt: "2024-06-01T20:00:00" })).toBe(
			true
		);
		expect(
			parsesPass({ ...BASE_FLIGHT, departure: "2024-06-01T08:00:00+04:00" })
		).toBe(true);
	});

	it("rejects unsupported google message types", () => {
		const message = { header: "Hi", body: "There" };
		expect(
			parsesPass({
				...BASE_LOYALTY,
				google: { messages: [{ ...message, messageType: "TEXT" }] },
			})
		).toBe(true);
		expect(
			parsesPass({
				...BASE_LOYALTY,
				google: {
					messages: [{ ...message, messageType: "expireNotification" }],
				},
			})
		).toBe(false);
	});

	it("accepts both relevantDates shapes and requires endDate with startDate", () => {
		const withDates = (relevantDates: unknown[]) => ({
			...BASE_LOYALTY,
			apple: { relevantDates },
		});
		expect(parsesPass(withDates([{ date: "2024-06-01T20:00:00Z" }]))).toBe(
			true
		);
		expect(
			parsesPass(
				withDates([
					{
						startDate: "2024-06-01T20:00:00Z",
						endDate: "2024-06-01T23:00:00Z",
					},
				])
			)
		).toBe(true);
		expect(parsesPass(withDates([{ startDate: "2024-06-01T20:00:00Z" }]))).toBe(
			false
		);
	});

	it("validates a static field value against its dateStyle/numberStyle", () => {
		const withField = (field: Record<string, unknown>) => ({
			...BASE_LOYALTY,
			fields: [{ slot: "primary", key: "k", label: "K", ...field }],
		});
		expect(
			parsesPass(withField({ value: "1250", numberStyle: "decimal" }))
		).toBe(true);
		expect(
			parsesPass(withField({ value: "lots", numberStyle: "decimal" }))
		).toBe(false);
		expect(parsesPass(withField({ value: "soon", dateStyle: "medium" }))).toBe(
			false
		);
	});

	// Apple: "A date or time value needs to include a time zone."
	it("requires a time zone on a field value styled as a date/time", () => {
		const dateField = (value: string, dateStyle = "medium") => ({
			...BASE_LOYALTY,
			fields: [{ slot: "secondary", key: "expires", value, dateStyle }],
		});
		expect(parsesPass(dateField("2024-06-01T20:00:00Z"))).toBe(true);
		expect(parsesPass(dateField("2024-06-01T20:00:00-07:00"))).toBe(true);
		expect(parsesPass(dateField("2024-06-01T20:00:00"))).toBe(false);
		// `none` opts the field out of Apple date rendering, so no zone needed.
		expect(parsesPass(dateField("2024-06-01T20:00:00", "none"))).toBe(true);
	});

	// Apple: "An array of up to 10 objects that represent geographic locations"
	it("caps locations at 10 entries", () => {
		const locations = Array.from({ length: 11 }, (_, i) => ({
			latitude: i,
			longitude: i,
		}));
		expect(
			parsesPass({ ...BASE_LOYALTY, locations: locations.slice(0, 10) })
		).toBe(true);
		expect(parsesPass({ ...BASE_LOYALTY, locations })).toBe(false);
	});

	it("requires the %@ placeholder in a field changeMessage", () => {
		const gate = { slot: "secondary", key: "gate", label: "Gate" };
		expect(
			parsesPass({
				...BASE_LOYALTY,
				fields: [{ ...gate, changeMessage: "Gate changed to %@" }],
			})
		).toBe(true);
		expect(
			parsesPass({
				...BASE_LOYALTY,
				fields: [{ ...gate, changeMessage: "Gate changed" }],
			})
		).toBe(false);
	});

	it("requires nfc.encryptionPublicKey when nfc is present", () => {
		expect(
			parsesPass({ ...BASE_LOYALTY, apple: { nfc: { message: "tap" } } })
		).toBe(false);
		expect(
			parsesPass({
				...BASE_LOYALTY,
				apple: { nfc: { message: "tap", encryptionPublicKey: "BASE64KEY==" } },
			})
		).toBe(true);
	});
});

describe("createConfigSchema", () => {
	it("rejects an empty serialNumber", () => {
		expect(parsesCreate({ serialNumber: "" })).toBe(false);
	});

	it.each([
		"validFrom",
		"expiresAt",
	])("requires a full ISO datetime for %s", (key) => {
		expect(parsesCreate({ ...BASE_CREATE, [key]: "2024-01-01" })).toBe(false);
		expect(
			parsesCreate({ ...BASE_CREATE, [key]: "2024-01-01T00:00:00Z" })
		).toBe(true);
	});

	it("rejects an empty barcode value", () => {
		expect(parsesCreate({ ...BASE_CREATE, barcode: { value: "" } })).toBe(
			false
		);
	});

	it("accepts the iOS 27 barcode formats", () => {
		expect(
			parsesCreate({
				...BASE_CREATE,
				barcodes: [
					{ value: "12345", format: "EAN13" },
					{ value: "12345", format: "ITF" },
					{ value: "12345", format: "Code39" },
					{ value: "12345", format: "Codabar" },
				],
			})
		).toBe(true);
	});

	// Google supports rotation for QR_CODE and PDF_417 only.
	it("restricts rotating barcodes to the rotation-capable types", () => {
		const rotatingBarcode = {
			valuePattern: "https://example.com/{totp_value_hex}",
			totpDetails: { parameters: [{ key: "K1", valueLength: 8 }] },
		};
		expect(
			parsesCreate({
				...BASE_CREATE,
				google: { rotatingBarcode: { ...rotatingBarcode, type: "PDF_417" } },
			})
		).toBe(true);
		expect(
			parsesCreate({
				...BASE_CREATE,
				google: { rotatingBarcode: { ...rotatingBarcode, type: "AZTEC" } },
			})
		).toBe(false);
	});

	it("caps google.valueAdded at 10 modules", () => {
		const valueAdded = Array.from({ length: 11 }, () => ({
			header: "Perk",
			uri: "https://example.com",
		}));
		expect(
			parsesCreate({
				...BASE_CREATE,
				google: { valueAdded: valueAdded.slice(0, 10) },
			})
		).toBe(true);
		expect(parsesCreate({ ...BASE_CREATE, google: { valueAdded } })).toBe(
			false
		);
	});
});
