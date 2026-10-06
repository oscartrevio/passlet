import type * as z from "zod/mini";
import {
	WalletError,
	type WalletErrorCode,
	type WalletValidationIssue,
} from "./errors";
import { type Providers, runProviders } from "./providers";
import {
	type ParsedContent,
	type PassContent,
	passContentSchema,
} from "./schema/content";
import type { IssuedPass } from "./schema/settings";
import {
	type ParsedTemplate,
	type TemplateConfig,
	templateConfigSchema,
} from "./schema/template";

function configError(
	code: Extract<
		WalletErrorCode,
		"PASS_CONFIG_INVALID" | "CREATE_CONFIG_INVALID"
	>,
	error: z.core.$ZodError
): WalletError {
	const issues: WalletValidationIssue[] = error.issues.map(
		({ path, message }) => ({
			path: path.map((part) =>
				typeof part === "symbol" ? String(part) : part
			),
			message,
		})
	);
	const first = issues[0];
	return new WalletError(
		code,
		first ? `${first.path.join(".") || "config"}: ${first.message}` : undefined,
		{ issues }
	);
}

/**
 * Parse recipient content, defaults applied, and check each configured
 * platform's rules against it.
 */
export function parseContent(
	providers: Providers,
	content: PassContent
): ParsedContent {
	const result = passContentSchema.safeParse(content);
	if (!result.success) {
		throw configError("CREATE_CONFIG_INVALID", result.error);
	}
	providers.apple?.checkContent();
	providers.google?.checkContent(result.data);
	return result.data;
}

/**
 * A configured pass template. Obtain one from {@link Wallet} rather than
 * constructing directly.
 *
 * The config is validated at construction time — a {@link WalletError} with
 * code `PASS_CONFIG_INVALID` is thrown immediately if anything is wrong.
 * Template-level provider requirements are checked too: `APPLE_MISSING_ICON`
 * when Apple credentials are supplied without `apple.icon`, and
 * `GOOGLE_MISSING_LOGO` when a template type that requires `google.logo` is
 * missing it.
 */
export class PassTemplate {
	/**
	 * The template this was built from, as passed to the {@link Wallet}
	 * factory, with every default applied.
	 */
	readonly config: ParsedTemplate;
	private readonly providers: Providers;

	constructor(config: TemplateConfig, providers: Providers) {
		const result = templateConfigSchema.safeParse(config);
		if (!result.success) {
			throw configError("PASS_CONFIG_INVALID", result.error);
		}
		providers.apple?.checkTemplate(result.data);
		providers.google?.checkTemplate(result.data);
		this.config = result.data;
		this.providers = providers;
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
	 */
	async create(content: PassContent): Promise<IssuedPass> {
		const item = {
			template: this.config,
			content: parseContent(this.providers, content),
		};
		return await runProviders(
			this.providers,
			(apple) => apple.issue(item),
			(google) => google.issue(item)
		);
	}

	/**
	 * Publish shared Google template changes. create() only creates missing classes;
	 * it does not overwrite existing ones. Apple templates are embedded in each pass.
	 */
	async publish(): Promise<void> {
		if (!this.providers.google) {
			throw new WalletError("GOOGLE_NOT_CONFIGURED");
		}
		await this.providers.google.publish(this.config);
	}

	/**
	 * Mark a pass as expired / invalid.
	 *
	 * Google: transitions the object state to `EXPIRED` via the Wallet REST API.
	 * Apple: no-op — Apple passes expire automatically when `expiresAt` is reached.
	 * To void one, return `apple: { voided: true }` from `load` and call `wallet.update()`.
	 */
	async expire(serialNumber: string): Promise<void> {
		await this.providers.google?.expire(this.config, serialNumber);
	}
}
