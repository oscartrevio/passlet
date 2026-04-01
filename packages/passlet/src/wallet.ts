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

export class Wallet {
	private readonly credentials: WalletCredentials;

	constructor(credentials: WalletCredentials) {
		this.credentials = credentials;
	}

	loyalty(config: Omit<LoyaltyPassConfig, "type">): Pass {
		return new Pass({ ...config, type: "loyalty" }, this.credentials);
	}

	event(config: Omit<EventPassConfig, "type">): Pass {
		return new Pass({ ...config, type: "event" }, this.credentials);
	}

	flight(config: Omit<FlightPassConfig, "type">): Pass {
		return new Pass({ ...config, type: "flight" }, this.credentials);
	}

	coupon(config: Omit<CouponPassConfig, "type">): Pass {
		return new Pass({ ...config, type: "coupon" }, this.credentials);
	}

	giftCard(config: Omit<GiftCardPassConfig, "type">): Pass {
		return new Pass({ ...config, type: "giftCard" }, this.credentials);
	}

	generic(config: Omit<GenericPassConfig, "type">): Pass {
		return new Pass({ ...config, type: "generic" }, this.credentials);
	}
}
