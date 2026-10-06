import { describe, expect, it } from "vitest";
import { templateConfigSchema } from "../../../src/schema/template";

const BASE_LOYALTY = {
	type: "loyalty" as const,
	id: "test-pass",
	name: "Test Pass",
	fields: [],
};

const BASE_FLIGHT = {
	type: "boardingPass" as const,
	id: "f1",
	name: "Flight",
	fields: [],
};

const BASE_EVENT = {
	type: "eventTicket" as const,
	id: "e1",
	name: "Event",
	fields: [],
};

const parsesTemplate = (config: unknown) =>
	templateConfigSchema.safeParse(config).success;

describe("templateConfigSchema", () => {
	it("rejects an empty id or name", () => {
		expect(parsesTemplate({ ...BASE_LOYALTY, id: "" })).toBe(false);
		expect(parsesTemplate({ ...BASE_LOYALTY, name: "" })).toBe(false);
	});

	it("accepts a hex color and rejects a named color", () => {
		expect(parsesTemplate({ ...BASE_LOYALTY, color: "#1a2b3c" })).toBe(true);
		expect(parsesTemplate({ ...BASE_LOYALTY, color: "red" })).toBe(false);
	});

	it("rejects an unknown pass type", () => {
		expect(parsesTemplate({ ...BASE_LOYALTY, type: "unknown" })).toBe(false);
	});

	it("validates the IATA carrier code on flight passes", () => {
		expect(parsesTemplate({ ...BASE_FLIGHT, carrier: "AA" })).toBe(true);
		expect(parsesTemplate({ ...BASE_FLIGHT, carrier: "american" })).toBe(false);
	});

	it("validates IATA airport codes on flight passes", () => {
		expect(parsesTemplate({ ...BASE_FLIGHT, origin: "JFK" })).toBe(true);
		expect(parsesTemplate({ ...BASE_FLIGHT, origin: "jfk" })).toBe(false);
	});

	it("accepts generic as a flight transitType", () => {
		expect(parsesTemplate({ ...BASE_FLIGHT, transitType: "generic" })).toBe(
			true
		);
	});

	it("rejects a non-ISO datetime on event display times", () => {
		expect(parsesTemplate({ ...BASE_EVENT, startsAt: "not-a-date" })).toBe(
			false
		);
	});

	it("accepts offset-less local datetimes on event/flight display times", () => {
		expect(
			parsesTemplate({ ...BASE_EVENT, startsAt: "2024-06-01T20:00:00" })
		).toBe(true);
		expect(
			parsesTemplate({ ...BASE_FLIGHT, departure: "2024-06-01T08:00:00+04:00" })
		).toBe(true);
	});

	it("rejects unsupported google message types", () => {
		const message = { header: "Hi", body: "There" };
		expect(
			parsesTemplate({
				...BASE_LOYALTY,
				google: { messages: [{ ...message, messageType: "TEXT" }] },
			})
		).toBe(true);
		expect(
			parsesTemplate({
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
		expect(parsesTemplate(withDates([{ date: "2024-06-01T20:00:00Z" }]))).toBe(
			true
		);
		expect(
			parsesTemplate(
				withDates([
					{
						startDate: "2024-06-01T20:00:00Z",
						endDate: "2024-06-01T23:00:00Z",
					},
				])
			)
		).toBe(true);
		expect(
			parsesTemplate(withDates([{ startDate: "2024-06-01T20:00:00Z" }]))
		).toBe(false);
	});

	it("validates a static field value against its dateStyle/numberStyle", () => {
		const withField = (field: Record<string, unknown>) => ({
			...BASE_LOYALTY,
			fields: [{ slot: "primary", key: "k", label: "K", ...field }],
		});
		expect(
			parsesTemplate(withField({ value: "1250", numberStyle: "decimal" }))
		).toBe(true);
		expect(
			parsesTemplate(withField({ value: "lots", numberStyle: "decimal" }))
		).toBe(false);
		expect(
			parsesTemplate(withField({ value: "soon", dateStyle: "medium" }))
		).toBe(false);
	});

	// Apple: "A date or time value needs to include a time zone."
	it("requires a time zone on a field value styled as a date/time", () => {
		const dateField = (value: string, dateStyle = "medium") => ({
			...BASE_LOYALTY,
			fields: [{ slot: "secondary", key: "expires", value, dateStyle }],
		});
		expect(parsesTemplate(dateField("2024-06-01T20:00:00Z"))).toBe(true);
		expect(parsesTemplate(dateField("2024-06-01T20:00:00-07:00"))).toBe(true);
		expect(parsesTemplate(dateField("2024-06-01T20:00:00"))).toBe(false);
		// `none` opts the field out of Apple date rendering, so no zone needed.
		expect(parsesTemplate(dateField("2024-06-01T20:00:00", "none"))).toBe(true);
	});

	// Apple: "An array of up to 10 objects that represent geographic locations"
	it("caps locations at 10 entries", () => {
		const locations = Array.from({ length: 11 }, (_, i) => ({
			latitude: i,
			longitude: i,
		}));
		expect(
			parsesTemplate({ ...BASE_LOYALTY, locations: locations.slice(0, 10) })
		).toBe(true);
		expect(parsesTemplate({ ...BASE_LOYALTY, locations })).toBe(false);
	});

	it("requires the %@ placeholder in a field changeMessage", () => {
		const gate = { slot: "secondary", key: "gate", label: "Gate" };
		expect(
			parsesTemplate({
				...BASE_LOYALTY,
				fields: [{ ...gate, changeMessage: "Gate changed to %@" }],
			})
		).toBe(true);
		expect(
			parsesTemplate({
				...BASE_LOYALTY,
				fields: [{ ...gate, changeMessage: "Gate changed" }],
			})
		).toBe(false);
	});

	it("requires nfc.encryptionPublicKey when nfc is present", () => {
		expect(
			parsesTemplate({ ...BASE_LOYALTY, apple: { nfc: { message: "tap" } } })
		).toBe(false);
		expect(
			parsesTemplate({
				...BASE_LOYALTY,
				apple: { nfc: { message: "tap", encryptionPublicKey: "BASE64KEY==" } },
			})
		).toBe(true);
	});
});
