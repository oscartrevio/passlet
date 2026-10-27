import { WalletError } from "./errors";
import type { IssuedPass } from "./output";
import { type PassItem, type Providers, runProviders } from "./providers";
import type { PassContent } from "./schema/content";
import { type GooglePassMessage, parseGoogleMessage } from "./schema/google";
import type { ParsedTemplate } from "./schema/template";

/** What a template needs from the {@link Wallet} that built it. */
export interface TemplateHost {
	/** The checked item to render `content` from `template`. */
	item(template: PassTemplate, content: PassContent): PassItem;
	readonly providers: Providers;
}

let construct: (config: ParsedTemplate, host: TemplateHost) => PassTemplate;

/**
 * A validated pass template, built by the {@link Wallet} methods named after
 * each pass type (`wallet.loyalty()`, `wallet.eventTicket()`, …), which
 * throw `PASS_CONFIG_INVALID` for an invalid config and the provider codes
 * for configs your credentials cannot issue: `APPLE_MISSING_ICON`,
 * `GOOGLE_MISSING_LOGO`, `GOOGLE_FLIGHT_MISSING_CLASS_FIELDS`, ….
 */
export class PassTemplate {
	/**
	 * The template this was built from, as passed to the {@link Wallet}
	 * factory, with every default applied.
	 */
	readonly config: ParsedTemplate;
	readonly #host: TemplateHost;

	static {
		construct = (config, host) => new PassTemplate(config, host);
	}

	private constructor(config: ParsedTemplate, host: TemplateHost) {
		this.config = config;
		this.#host = host;
	}

	/**
	 * Issue a pass to a recipient. Runs both providers in parallel.
	 *
	 * Returns an {@link IssuedPass} with:
	 * - `apple` — a `.pkpass` `Uint8Array` ready to serve, or `null` if Apple credentials were omitted.
	 * - `google` — a signed JWT for the Google Wallet save link, or `null` if Google credentials were omitted.
	 *
	 * When `apple.webService` is configured, the `.pkpass` carries its URL and
	 * this pass's own authentication token, so `wallet.handler` can update it.
	 *
	 * @throws {WalletError} `CREATE_CONFIG_INVALID` if `content` fails validation.
	 * A provider's error carries `results` when both wallets are configured.
	 */
	async create(content: PassContent): Promise<IssuedPass> {
		const item = this.#host.item(this, content);
		return await runProviders(
			this.#host.providers,
			(apple) => apple.issue(item),
			(google) => google.issue(item)
		);
	}

	/**
	 * Publish shared Google template changes. create() only creates missing classes;
	 * it does not overwrite existing ones. Apple templates are embedded in each pass.
	 *
	 * @throws {WalletError} `GOOGLE_NOT_CONFIGURED` without Google credentials.
	 */
	async publish(): Promise<void> {
		await this.#google().publish(this.config);
	}

	/**
	 * Mark a Google pass as expired: moves its object to the `EXPIRED` state
	 * through the Wallet REST API.
	 *
	 * Apple has no such call. Apple passes expire on their own at
	 * `expiresAt`; to void one, return `apple: { voided: true }` from `load`
	 * and call `wallet.update()`.
	 *
	 * @throws {WalletError} `GOOGLE_NOT_CONFIGURED` without Google credentials,
	 * `CREATE_CONFIG_INVALID` for a serial number Google cannot use, or the
	 * Google API error.
	 */
	async expire(serialNumber: string): Promise<void> {
		await this.#google().expire(this.config, serialNumber);
	}

	/**
	 * Google only: add a message to an issued pass's details. With
	 * `messageType: "TEXT_AND_NOTIFY"` Google also pushes a notification to
	 * holders who saved the pass; Google documents that push only for messages
	 * sent this way, not for `google.messages` written by `create()` or
	 * `wallet.update()`. Google allows at most 3 notifying messages per pass in
	 * 24 hours and rejects more with a quota error; send further messages as
	 * `"TEXT"`.
	 * https://developers.google.com/wallet/generic/use-cases/trigger-push-notifications
	 *
	 * The message joins the object's `messages`, which `wallet.update()`
	 * rewrites from `content.google.messages`; keep it there to keep it shown.
	 * Apple has no per-pass message; use a field with a `changeMessage`.
	 *
	 * @throws {WalletError} `GOOGLE_NOT_CONFIGURED` without Google credentials,
	 * `CREATE_CONFIG_INVALID` for an invalid message or serial number, or the
	 * Google API error, e.g. `GOOGLE_NOT_FOUND` for a serial never issued.
	 */
	async sendMessage(
		serialNumber: string,
		message: GooglePassMessage
	): Promise<void> {
		const google = this.#google();
		await google.sendMessage(
			this.config,
			serialNumber,
			parseGoogleMessage(message)
		);
	}

	#google() {
		const { google } = this.#host.providers;
		if (!google) {
			throw new WalletError("GOOGLE_NOT_CONFIGURED");
		}
		return google;
	}
}

/** A template of `config`, already validated, issued through `host`. */
export function createTemplate(
	config: ParsedTemplate,
	host: TemplateHost
): PassTemplate {
	return construct(config, host);
}
