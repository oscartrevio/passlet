import { AppleProvider } from "./apple/index";
import { WalletError } from "./errors";
import { GoogleProvider } from "./google/index";
import { type PassItem, type Providers, runProviders } from "./providers";
import type { PassContent } from "./schema/content";
import type {
	IssuedBundle,
	LoadedPass,
	UpdateResult,
	WalletConfig,
} from "./schema/settings";
import type {
	BoardingPassTemplateConfig,
	CouponTemplateConfig,
	EventTicketTemplateConfig,
	GenericTemplateConfig,
	GiftCardTemplateConfig,
	LoyaltyTemplateConfig,
	TemplateConfig,
} from "./schema/template";
import { PassTemplate, parseContent } from "./template";

// "You can have up to 10 passes or 150 MB for a bundle of passes."
// https://developer.apple.com/documentation/walletpasses/distributing-and-updating-a-pass
const MAX_BUNDLE_PASSES = 10;

/**
 * Entry point for building passes. Construct once with your credentials,
 * then call the template methods to get a {@link PassTemplate} you can issue.
 *
 * Omit a provider's credentials to skip that platform entirely —
 * `apple` and `google` are both optional.
 *
 * Create one `Wallet` per process and reuse it, so `update` keeps one APNs
 * connection open as Apple asks. That connection never keeps the process
 * alive and closes itself after an hour idle.
 *
 * @example
 * const wallet = new Wallet({ apple: appleCredentials, google: googleCredentials });
 * const result = await wallet.loyalty({ id: "rewards", name: "Rewards Card", fields: [] })
 *   .create({ serialNumber: "user-123" });
 */
export class Wallet {
	/**
	 * Apple's pass web service as a Fetch handler. Mount it at
	 * `apple.webService.url`; every route answers 404 without `apple.webService`.
	 * Wrap it with `toNodeListener` for Express or `node:http`.
	 *
	 * @example
	 * export const GET = wallet.handler;
	 * export const POST = wallet.handler;
	 * export const DELETE = wallet.handler;
	 */
	readonly handler: (request: Request) => Promise<Response>;
	private readonly config: WalletConfig;
	private readonly providers: Providers;
	private readonly templates = new WeakSet<PassTemplate>();

	/**
	 * @throws {WalletError} `APPLE_INVALID_SIGNER_CERT`, `APPLE_INVALID_WWDR`
	 * or `APPLE_INVALID_SIGNER_KEY` if the Apple signing credentials are
	 * unusable, `APPLE_WEB_SERVICE_INVALID` if `apple.webService` is malformed,
	 * `UPDATES_NOT_CONFIGURED` if it is set without `load`, or
	 * `GOOGLE_INVALID_PRIVATE_KEY` if `google.privateKey` is not an RSA PEM
	 * private key.
	 */
	constructor(config: WalletConfig) {
		this.config = config;
		const { apple, google, load } = config;
		const appleProvider = apple
			? new AppleProvider(apple, {
					load,
					resolve: (loaded, serialNumber) => this.item(loaded, serialNumber),
				})
			: null;
		this.providers = {
			apple: appleProvider,
			google: google ? new GoogleProvider(google) : null,
		};
		this.handler =
			appleProvider?.handler ??
			(() => Promise.resolve(new Response(null, { status: 404 })));
	}

	/**
	 * Push a pass's current content, read through `load`, to both wallets.
	 *
	 * Google: writes the object, creating it if Google has none. `notify` asks
	 * Google to alert the holder about allowlisted field changes; it applies to
	 * this call only. Apple: sends a push to every registered device, which
	 * then downloads the new pass from `wallet.handler`, and drops
	 * registrations APNs reports as gone. Apple always alerts for fields with a
	 * `changeMessage`, so `notify` does not apply to it.
	 *
	 * @throws {WalletError} `UPDATES_NOT_CONFIGURED` without `load`,
	 * `PASS_NOT_FOUND` when `load` returns `null`, `CREATE_CONFIG_INVALID` when
	 * the loaded content is invalid, or the provider's error, which carries
	 * `results` when both wallets are configured.
	 */
	async update(
		serialNumber: string,
		options: { notify?: boolean } = {}
	): Promise<UpdateResult> {
		const { load } = this.config;
		if (!load) {
			throw new WalletError("UPDATES_NOT_CONFIGURED");
		}
		const loaded = await load(serialNumber);
		if (!loaded) {
			throw new WalletError("PASS_NOT_FOUND");
		}
		const item = this.item(loaded, serialNumber);
		return await runProviders(
			this.providers,
			(apple) => apple.update(item),
			(google) => google.update(item, options)
		);
	}

	/**
	 * Issue up to 10 passes in one go, e.g. every ticket in an order or every
	 * leg of a trip. Runs both providers in parallel.
	 *
	 * Returns an {@link IssuedBundle} with:
	 * - `apple` — a `.pkpasses` bundle of one signed `.pkpass` per item (even
	 *   for one item); serve it as `APPLE_PASSES_CONTENT_TYPE`.
	 * - `google` — one signed JWT whose save link adds every item.
	 *
	 * Items may mix templates. Set the same `content.group` on items that belong
	 * together to show them as one group in both wallets.
	 *
	 * @throws {WalletError} `PASS_BUNDLE_INVALID` without 1 to 10 items, when two
	 * items share a serialNumber, when a template comes from another Wallet, or
	 * when the Apple bundle passes 150 MB; `CREATE_CONFIG_INVALID` if any
	 * content fails validation. A provider's error carries `results` when both
	 * wallets are configured.
	 */
	async createBundle(
		items: readonly { template: PassTemplate; content: PassContent }[]
	): Promise<IssuedBundle> {
		if (items.length < 1 || items.length > MAX_BUNDLE_PASSES) {
			throw new WalletError(
				"PASS_BUNDLE_INVALID",
				`createBundle takes 1 to ${MAX_BUNDLE_PASSES} passes, got ${items.length}`
			);
		}
		const serials = new Set<string>();
		const passes = items.map(({ template, content }, index): PassItem => {
			if (!this.templates.has(template)) {
				throw new WalletError(
					"PASS_BUNDLE_INVALID",
					`items[${index}].template was not created by this Wallet`
				);
			}
			const parsed = parseContent(this.providers, content);
			// Wallet identifies a pass by its serial number; a repeat overwrites.
			if (serials.has(parsed.serialNumber)) {
				throw new WalletError(
					"PASS_BUNDLE_INVALID",
					`items[${index}].content.serialNumber repeats an earlier item`
				);
			}
			serials.add(parsed.serialNumber);
			return { template: template.config, content: parsed };
		});
		return await runProviders(
			this.providers,
			(apple) => apple.issueBundle(passes),
			(google) => google.issueBundle(passes)
		);
	}

	/** Create a loyalty / rewards card template. */
	loyalty(config: Omit<LoyaltyTemplateConfig, "type">): PassTemplate {
		return this.template({ ...config, type: "loyalty" });
	}

	/** Create an event ticket template. */
	eventTicket(config: Omit<EventTicketTemplateConfig, "type">): PassTemplate {
		return this.template({ ...config, type: "eventTicket" });
	}

	/**
	 * Create a boarding pass template. Covers air, train, bus, and boat transit.
	 *
	 * Apple boarding passes render a transit icon between the two `primary` fields,
	 * so use `field.primary()` for the departure and arrival locations.
	 */
	boardingPass(config: Omit<BoardingPassTemplateConfig, "type">): PassTemplate {
		return this.template({ ...config, type: "boardingPass" });
	}

	/** Create a coupon / offer template. */
	coupon(config: Omit<CouponTemplateConfig, "type">): PassTemplate {
		return this.template({ ...config, type: "coupon" });
	}

	/** Create a gift card template. */
	giftCard(config: Omit<GiftCardTemplateConfig, "type">): PassTemplate {
		return this.template({ ...config, type: "giftCard" });
	}

	/** Create a generic template for anything that doesn't fit the other types. */
	generic(config: Omit<GenericTemplateConfig, "type">): PassTemplate {
		return this.template({ ...config, type: "generic" });
	}

	// Remembered so createBundle can reject templates built by another Wallet.
	private template(config: TemplateConfig): PassTemplate {
		const template = new PassTemplate(config, this.providers);
		this.templates.add(template);
		return template;
	}

	// The serial being served wins over any serialNumber left in loaded content.
	private item(loaded: LoadedPass, serialNumber: string): PassItem {
		return {
			template: loaded.template.config,
			content: parseContent(this.providers, {
				...loaded.content,
				serialNumber,
			}),
		};
	}
}
