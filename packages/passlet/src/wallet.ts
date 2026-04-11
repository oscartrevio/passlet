import { Pass } from "./pass";
import type { WalletCredentials } from "./types/credentials";
import type {
	CouponPassConfig,
	EventPassConfig,
	FlightPassConfig,
	GenericPassConfig,
	GiftCardPassConfig,
	LoyaltyPassConfig,
} from "./types/schemas";

/**
 * Entry point for building passes. Construct once with your credentials,
 * then call the pass-type methods to get a {@link Pass} you can issue.
 *
 * Omit a provider's credentials to skip that platform entirely —
 * `apple` and `google` are both optional.
 *
 * @example
 * const wallet = new Wallet({ apple: appleCredentials, google: googleCredentials });
 * const result = await wallet.loyalty({ id: "rewards", name: "Rewards Card", fields: [] })
 *   .create({ serialNumber: "user-123" });
 */
export class Wallet {
	private readonly credentials: WalletCredentials;

	constructor(credentials: WalletCredentials) {
		this.credentials = credentials;
	}

	/** Create a loyalty / rewards card pass. */
	loyalty(config: Omit<LoyaltyPassConfig, "type">): Pass {
		return new Pass({ ...config, type: "loyalty" }, this.credentials);
	}

	/** Create an event ticket pass. */
	event(config: Omit<EventPassConfig, "type">): Pass {
		return new Pass({ ...config, type: "event" }, this.credentials);
	}

	/**
	 * Create a boarding pass. Covers air, train, bus, and boat transit.
	 *
	 * Apple boarding passes render a transit icon between the two `primary` fields,
	 * so use `field.primary()` for the departure and arrival locations.
	 */
	flight(config: Omit<FlightPassConfig, "type">): Pass {
		return new Pass({ ...config, type: "flight" }, this.credentials);
	}

	/** Create a coupon / offer pass. */
	coupon(config: Omit<CouponPassConfig, "type">): Pass {
		return new Pass({ ...config, type: "coupon" }, this.credentials);
	}

	/** Create a gift card pass. */
	giftCard(config: Omit<GiftCardPassConfig, "type">): Pass {
		return new Pass({ ...config, type: "giftCard" }, this.credentials);
	}

	/** Create a generic pass for anything that doesn't fit the other types. */
	generic(config: Omit<GenericPassConfig, "type">): Pass {
		return new Pass({ ...config, type: "generic" }, this.credentials);
	}
}
