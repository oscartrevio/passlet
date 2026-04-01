import { WalletError } from "./errors";
import { generateApplePass } from "./providers/apple/index";
import {
	expireGooglePass,
	generateGooglePass,
	updateGooglePass,
} from "./providers/google/index";
import type { IssuedPass, WalletCredentials } from "./types/credentials";
import type { CreateConfig, FieldDef, PassConfig } from "./types/schemas";
import { createConfigSchema, passConfigSchema } from "./types/schemas";

// Field builder — use these to define display fields on any pass type.

type FieldOptions = Omit<FieldDef, "slot" | "key" | "label">;

export const field = {
	/** Top-right of the pass. Compact — typically one field. */
	header: (key: string, label: string, options?: FieldOptions): FieldDef => ({
		slot: "header",
		key,
		label,
		...options,
	}),
	/** Large, prominent area. Apple: primaryFields. Google: subheader (label) + header (value). */
	primary: (key: string, label: string, options?: FieldOptions): FieldDef => ({
		slot: "primary",
		key,
		label,
		...options,
	}),
	/** Below primary. Apple: secondaryFields. Google: textModulesData. */
	secondary: (
		key: string,
		label: string,
		options?: FieldOptions
	): FieldDef => ({ slot: "secondary", key, label, ...options }),
	/** Below secondary. Supports two rows via { row: 0 | 1 }. Apple: auxiliaryFields. Google: textModulesData. */
	auxiliary: (
		key: string,
		label: string,
		options?: FieldOptions
	): FieldDef => ({ slot: "auxiliary", key, label, ...options }),
	/** Back of the pass — hidden by default. Apple: backFields. Google: infoModuleData. */
	back: (key: string, label: string, options?: FieldOptions): FieldDef => ({
		slot: "back",
		key,
		label,
		...options,
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

	// Update an existing pass. For Google: PATCHes the object via the Wallet REST API.
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

	// Expire a pass. For Google: sets object state to EXPIRED via the Wallet REST API.
	// Apple passes expire automatically when expiresAt is reached.
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
