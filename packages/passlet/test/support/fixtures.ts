// One full-fidelity pass per vertical, carrying both Apple and Google options
// so unit, integration and e2e tiers all issue the same passes.
import type { CreateConfig, PassConfig } from "../../src/types/schemas";
import { ICON, PNG } from "./apple";
import { LOGO_URL } from "./google";

export interface Fixture {
	create: CreateConfig;
	pass: PassConfig;
}

export type FixtureName =
	| "loyalty"
	| "event"
	| "flight"
	| "transit"
	| "coupon"
	| "giftCard"
	| "generic";

export interface FixtureOptions {
	/** Public logo URL — Google fetches it when the class is created. */
	logo?: string;
}

export function fixtures({
	logo = LOGO_URL,
}: FixtureOptions = {}): Record<FixtureName, Fixture> {
	return {
		// Apple renders loyalty as storeCard; Google requires programLogo.
		loyalty: {
			pass: {
				type: "loyalty",
				id: "fx-loyalty",
				name: "Acme Rewards",
				color: "#1a1a2e",
				apple: {
					icon: ICON,
					logo: PNG,
					logoText: "Acme",
					foregroundColor: "#ffffff",
					labelColor: "#cccccc",
					description: "Acme loyalty card",
				},
				google: { logo },
				locales: {
					es: { points: "Puntos", tier_value: "Oro", name: "Recompensas Acme" },
				},
				fields: [
					{ slot: "primary", key: "points", label: "Points", value: "1250" },
					{ slot: "secondary", key: "tier", label: "Tier", value: "Gold" },
					{ slot: "back", key: "member", label: "Member", value: "Jane Doe" },
					{
						slot: "back",
						key: "terms",
						label: "Terms",
						value: "No refunds.",
						// [] explicitly disables Apple's data detectors.
						dataDetectorTypes: [],
					},
				],
			},
			create: {
				serialNumber: "loyalty-001",
				barcode: { value: "LOY-1250", format: "QR" },
			},
		},

		// Poster event ticket: Apple uses eventLogoText and drops logoText.
		event: {
			pass: {
				type: "event",
				id: "fx-event",
				name: "Summer Festival",
				color: "#6a0572",
				startsAt: "2026-07-15T20:00:00Z",
				endsAt: "2026-07-15T23:00:00Z",
				venue: { name: "Central Park", address: "1 Main St" },
				apple: {
					icon: ICON,
					eventLogoText: "Festival",
					preferredStyleSchemes: ["posterEventTicket"],
					logoText: "must be dropped on a poster event ticket",
					footerBackgroundColor: "#123456",
					bagPolicyURL: "https://example.com/bags",
				},
				google: { logo },
				fields: [
					{
						slot: "primary",
						key: "venue",
						label: "Venue",
						value: "Central Park",
					},
					{
						slot: "auxiliary",
						key: "seat",
						label: "Seat",
						value: "A12",
						row: 0,
					},
					{ slot: "auxiliary", key: "row", label: "Row", value: "12", row: 1 },
					{ slot: "auxiliary", key: "section", label: "Section", value: "A" },
					{ slot: "auxiliary", key: "gate", label: "Gate", value: "3" },
				],
			},
			create: {
				serialNumber: "event-001",
				barcode: { value: "EVT-1", format: "PDF417" },
			},
		},

		// Air: Apple boardingPass, Google flightClass (IATA codes required).
		flight: {
			pass: {
				type: "flight",
				id: "fx-flight",
				name: "AA 100",
				color: "#003087",
				transitType: "air",
				carrier: "AA",
				flightNumber: "100",
				origin: "JFK",
				destination: "LAX",
				departure: "2026-07-15T08:00:00Z",
				arrival: "2026-07-15T11:30:00Z",
				apple: { icon: ICON, upgradeURL: "https://example.com/upgrade" },
				google: { logo },
				fields: [
					{ slot: "primary", key: "gate", label: "Gate", value: "B22" },
					{ slot: "secondary", key: "passengerName", label: "Passenger" },
					{ slot: "secondary", key: "seat", label: "Seat", value: "14A" },
					{ slot: "auxiliary", key: "terminal", label: "Terminal", value: "4" },
				],
			},
			create: {
				serialNumber: "flight-001",
				barcode: { value: "BP-1", format: "Aztec" },
				values: { passengerName: "Jane Doe" },
			},
		},

		// Rail: Apple boardingPass, Google transitClass via google.transit.
		transit: {
			pass: {
				type: "flight",
				id: "fx-transit",
				name: "Northern Line",
				color: "#c60c30",
				transitType: "train",
				origin: "PAD",
				destination: "BRI",
				departure: "2026-07-15T08:00:00+01:00",
				arrival: "2026-07-15T09:45:00+01:00",
				apple: { icon: ICON },
				google: {
					logo,
					transit: { tripType: "roundTrip", ticketNumber: "TK-9001" },
				},
				fields: [
					{ slot: "primary", key: "platform", label: "Platform", value: "4" },
					{ slot: "secondary", key: "passengerName", label: "Passenger" },
				],
			},
			create: {
				serialNumber: "transit-001",
				values: { passengerName: "Jane Doe" },
			},
		},

		coupon: {
			pass: {
				type: "coupon",
				id: "fx-coupon",
				name: "20% Off",
				color: "#e63946",
				redemptionChannel: "both",
				apple: { icon: ICON, strip: PNG },
				google: { logo },
				fields: [
					{ slot: "primary", key: "offer", label: "Offer", value: "20% off" },
					{ slot: "secondary", key: "code", label: "Code", value: "SUMMER20" },
				],
			},
			create: { serialNumber: "coupon-001", expiresAt: "2026-12-31T23:59:59Z" },
		},

		// Apple shares storeCard with loyalty; currency is per field. Google
		// carries the balance as Money micros.
		giftCard: {
			pass: {
				type: "giftCard",
				id: "fx-gift",
				name: "Store Gift Card",
				color: "#2a9d8f",
				currency: "USD",
				apple: { icon: ICON },
				google: { logo },
				fields: [
					{
						slot: "primary",
						key: "balance",
						label: "Balance",
						value: "50.00",
						currencyCode: "USD",
						numberStyle: "decimal",
					},
					{
						slot: "secondary",
						key: "issued",
						label: "Issued",
						value: "2026-01-15T00:00:00Z",
						dateStyle: "medium",
						timeStyle: "none",
						textAlignment: "right",
					},
					{ slot: "back", key: "pin", label: "PIN", value: "1234" },
				],
			},
			create: { serialNumber: "gift-001" },
		},

		generic: {
			pass: {
				type: "generic",
				id: "fx-generic",
				name: "Member Card",
				color: "#264653",
				apple: {
					icon: ICON,
					nfc: { message: "hello", encryptionPublicKey: "KEY" },
					sharingProhibited: true,
				},
				google: { logo },
				fields: [
					{ slot: "primary", key: "mid", label: "Member ID", value: "M-98765" },
					{ slot: "secondary", key: "name", label: "Name", value: "Jane Doe" },
				],
			},
			create: { serialNumber: "generic-001" },
		},
	};
}

export const FIXTURES = fixtures();
