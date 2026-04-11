import { WalletError } from "./errors";
import { generateApplePass } from "./providers/apple/index";
import {
	deleteGooglePass,
	expireGooglePass,
	generateGooglePass,
	updateGooglePass,
} from "./providers/google/index";
import type { IssuedPass, WalletCredentials } from "./types/credentials";
import type { CreateConfig, FieldDef, PassConfig } from "./types/schemas";
import { createConfigSchema, passConfigSchema } from "./types/schemas";

// Field builder — use these to define display fields on any pass type.

type FieldOptions = Omit<FieldDef, "slot" | "key" | "label">;

// A string shorthand sets value directly; an object passes all options through.
type FieldArg = string | FieldOptions;

function resolveOptions(arg: FieldArg | undefined): FieldOptions | undefined {
	if (arg === undefined) {
		return undefined;
	}
	return typeof arg === "string" ? { value: arg } : arg;
}

/**
 * Builders for pass display fields. Pass the result into the `fields` array
 * of any pass config.
 *
 * The third argument is either a string (shorthand for `value`) or a full
 * {@link FieldDef} options object for formatting, alignment, and more.
 *
 * @example
 * fields: [
 *   field.primary("points", "Points", "1 250"),
 *   field.secondary("tier", "Tier", "Gold"),
 *   field.back("terms", "Terms", { value: "No refunds." }),
 * ]
 */
export const field = {
	/**
	 * Top-right corner of the pass. Space is limited — use at most one field.
	 *
	 * Apple → `headerFields`. Google → `textModulesData`.
	 */
	header: (key: string, label: string, arg?: FieldArg): FieldDef => ({
		slot: "header",
		key,
		label,
		...resolveOptions(arg),
	}),
	/**
	 * Large, prominent area below the logo.
	 *
	 * Apple → `primaryFields`. Google → `subheader` (label) + `header` (value).
	 * On boarding passes, Apple renders a transit icon between the two primary fields,
	 * so place departure on the left and arrival on the right.
	 */
	primary: (key: string, label: string, arg?: FieldArg): FieldDef => ({
		slot: "primary",
		key,
		label,
		...resolveOptions(arg),
	}),
	/**
	 * Row below the primary area.
	 *
	 * Apple → `secondaryFields`. Google → `textModulesData`.
	 */
	secondary: (key: string, label: string, arg?: FieldArg): FieldDef => ({
		slot: "secondary",
		key,
		label,
		...resolveOptions(arg),
	}),
	/**
	 * Row below secondary. Supports two rows — pass `{ row: 0 }` or `{ row: 1 }` to assign.
	 *
	 * Apple → `auxiliaryFields`. Google → `textModulesData`.
	 */
	auxiliary: (key: string, label: string, arg?: FieldArg): FieldDef => ({
		slot: "auxiliary",
		key,
		label,
		...resolveOptions(arg),
	}),
	/**
	 * Back of the pass — visible only when the user flips it over.
	 * Good for terms, redemption instructions, or contact info.
	 *
	 * Apple → `backFields`. Google → `infoModuleData`.
	 */
	back: (key: string, label: string, arg?: FieldArg): FieldDef => ({
		slot: "back",
		key,
		label,
		...resolveOptions(arg),
	}),
};

// Validation

function validatePassConfig(config: PassConfig): void {
	const result = passConfigSchema.safeParse(config);
	if (!result.success) {
		throw new WalletError(
			"PASS_CONFIG_INVALID",
			result.error.issues[0]?.message
		);
	}
}

function validateCreateConfig(config: CreateConfig): void {
	const result = createConfigSchema.safeParse(config);
	if (!result.success) {
		throw new WalletError(
			"CREATE_CONFIG_INVALID",
			result.error.issues[0]?.message
		);
	}
}

// Pass

/**
 * A configured pass template. Obtain one from {@link Wallet} rather than
 * constructing directly.
 *
 * Config is validated at construction time — a {@link WalletError} with code
 * `PASS_CONFIG_INVALID` is thrown immediately if anything is wrong.
 */
export class Pass {
	private readonly config: PassConfig;
	private readonly credentials: WalletCredentials;

	constructor(config: PassConfig, credentials: WalletCredentials) {
		// Validate immediately so misconfiguration is surfaced at construction time,
		// not deferred until the first create().
		validatePassConfig(config);
		this.config = config;
		this.credentials = credentials;
	}

	/**
	 * Issue a pass to a recipient. Runs both providers in parallel.
	 *
	 * Returns an {@link IssuedPass} with:
	 * - `apple` — a `.pkpass` `Uint8Array` ready to serve, or `null` if Apple credentials were omitted.
	 * - `google` — a signed JWT for the Google Wallet save link, or `null` if Google credentials were omitted.
	 * - `warnings` — non-fatal notices (e.g. a missing optional image).
	 *
	 * @throws {WalletError} `CREATE_CONFIG_INVALID` if `createConfig` fails validation.
	 */
	async create(createConfig: CreateConfig): Promise<IssuedPass> {
		validateCreateConfig(createConfig);

		// Both providers run independently — a Google API failure won't block the Apple pass.
		const [appleResult, googleResult] = await Promise.allSettled([
			this.credentials.apple
				? generateApplePass(this.config, createConfig, this.credentials.apple)
				: Promise.resolve({ pass: null, warnings: [] as string[] }),
			this.credentials.google
				? generateGooglePass(this.config, createConfig, this.credentials.google)
				: Promise.resolve({ pass: null, warnings: [] as string[] }),
		]);

		if (appleResult.status === "rejected") {
			throw appleResult.reason;
		}
		if (googleResult.status === "rejected") {
			throw googleResult.reason;
		}

		return {
			apple: appleResult.value.pass,
			google: googleResult.value.pass,
			warnings: [...appleResult.value.warnings, ...googleResult.value.warnings],
		};
	}

	/**
	 * Push updated field values to an already-issued pass.
	 *
	 * Google: PATCHes the object via the Wallet REST API (the pass must have been
	 * saved to a wallet first). Apple: no-op — Apple passes update when the holder
	 * re-downloads the pass via your web service.
	 */
	async update(createConfig: CreateConfig): Promise<void> {
		validateCreateConfig(createConfig);
		if (this.credentials.google) {
			await updateGooglePass(
				this.config,
				createConfig,
				this.credentials.google
			);
		}
	}

	/**
	 * Permanently delete a pass.
	 *
	 * Google: removes the object via the Wallet REST API.
	 * Apple: no-op — Apple passes cannot be remotely deleted; use {@link expire} to invalidate them.
	 */
	async delete(serialNumber: string): Promise<void> {
		if (this.credentials.google) {
			await deleteGooglePass(
				this.config,
				serialNumber,
				this.credentials.google
			);
		}
	}

	/**
	 * Mark a pass as expired / invalid.
	 *
	 * Google: transitions the object state to `EXPIRED` via the Wallet REST API.
	 * Apple: no-op — Apple passes expire automatically when `expiresAt` is reached,
	 * or you can set `apple.voided: true` at issue time via {@link create}.
	 */
	async expire(serialNumber: string): Promise<void> {
		if (this.credentials.google) {
			await expireGooglePass(
				this.config,
				serialNumber,
				this.credentials.google
			);
		}
	}
}
