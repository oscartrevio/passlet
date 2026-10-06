import { WalletError } from "../errors";
import type { PassItem, Provider } from "../providers";
import type {
	AppleCredentials,
	AppleWebService,
	LoadedPass,
	LoadPass,
	UpdateResult,
} from "../schema/settings";
import type { TemplateConfig } from "../schema/template";
import { sendPassUpdates } from "./apns";
import { appleAuthToken } from "./auth-token";
import { collectImages } from "./images";
import { packagePass, packagePasses } from "./package";
import { buildPassJson } from "./pass-json";
import { buildStringsLines } from "./strings";
import { createAppleWebService } from "./web-service";

// Apple's authenticationToken is derived from this with HMAC-SHA256; 32
// characters keeps a guessable secret from undermining every issued pass.
const MIN_SECRET_LENGTH = 32;

// "You can have up to 10 passes or 150 MB for a bundle of passes."
// https://developer.apple.com/documentation/walletpasses/distributing-and-updating-a-pass
const MAX_BUNDLE_BYTES = 150_000_000;

type AppleUpdate = UpdateResult["apple"];

interface PushCredentials {
	cert: string;
	key: string;
}

export interface AppleProviderOptions {
	/** Reads a pass's current content; required with `webService`. */
	load?: LoadPass;
	/** Turn loaded content into a checked item to render for `serialNumber`. */
	resolve(loaded: LoadedPass, serialNumber: string): PassItem;
	/** APNs sender; replaced in tests. */
	sendPassUpdates?: typeof sendPassUpdates;
}

export function validateAppleRequirements(template: TemplateConfig): void {
	if (!template.apple?.icon) {
		throw new WalletError("APPLE_MISSING_ICON");
	}
	if (template.type === "boardingPass" && !template.transitType) {
		throw new WalletError("APPLE_BOARDING_MISSING_TRANSIT_TYPE");
	}
	// Apple ignores appLaunchURL without associated App Store IDs.
	if (
		template.apple?.appLaunchURL &&
		!template.apple.associatedStoreIdentifiers?.length
	) {
		throw new WalletError("APPLE_APP_LAUNCH_URL_REQUIRES_STORE_IDS");
	}
}

/**
 * Check `apple.webService` and resolve the APNs credentials it will push with.
 * Messages name the setting at fault, never its value.
 */
function resolvePushCredentials(
	apple: AppleCredentials,
	webService: AppleWebService
): PushCredentials {
	let url: URL | undefined;
	try {
		url = new URL(webService.url);
	} catch {
		// Reported below with the protocol check.
	}
	if (!(url && (url.protocol === "https:" || url.protocol === "http:"))) {
		throw new WalletError(
			"APPLE_WEB_SERVICE_INVALID",
			"apple.webService.url must be an absolute http(s) URL"
		);
	}
	if (
		typeof webService.secret !== "string" ||
		webService.secret.length < MIN_SECRET_LENGTH
	) {
		throw new WalletError(
			"APPLE_WEB_SERVICE_INVALID",
			`apple.webService.secret must be a string of ${MIN_SECRET_LENGTH} or more characters`
		);
	}
	if (webService.push) {
		return webService.push;
	}
	// APNs authenticates with TLS client certificates, so it needs the key
	// itself; an external signer cannot stand in for it.
	if (!apple.signerKey) {
		throw new WalletError(
			"APPLE_WEB_SERVICE_INVALID",
			"apple.webService.push is required when signing with apple.signer"
		);
	}
	return { cert: apple.signerCert, key: apple.signerKey };
}

/**
 * Apple Wallet: signed `.pkpass` archives, plus the web service and push
 * notifications that keep issued passes current when `webService` is set.
 */
export class AppleProvider implements Provider<Uint8Array, AppleUpdate> {
	/** Apple's pass web service; every route answers 404 without `webService`. */
	readonly handler: (request: Request) => Promise<Response>;
	private readonly credentials: AppleCredentials;
	private readonly push: PushCredentials | undefined;
	private readonly send: typeof sendPassUpdates;

	/**
	 * @throws {WalletError} `APPLE_WEB_SERVICE_INVALID` if `webService` is
	 * malformed, or `UPDATES_NOT_CONFIGURED` if it is set without `load`.
	 */
	constructor(credentials: AppleCredentials, options: AppleProviderOptions) {
		this.credentials = credentials;
		this.send = options.sendPassUpdates ?? sendPassUpdates;
		const { webService } = credentials;
		if (!webService) {
			this.push = undefined;
			this.handler = () => Promise.resolve(new Response(null, { status: 404 }));
			return;
		}
		this.push = resolvePushCredentials(credentials, webService);
		const { load, resolve } = options;
		if (!load) {
			throw new WalletError(
				"UPDATES_NOT_CONFIGURED",
				"apple.webService needs load to serve updated passes"
			);
		}
		this.handler = createAppleWebService({
			passTypeIdentifier: credentials.passTypeIdentifier,
			secret: webService.secret,
			registrations: webService.registrations,
			load,
			onLog: webService.onLog,
			renderPass: async (loaded, serialNumber) =>
				await this.issue(resolve(loaded, serialNumber)),
		});
	}

	checkTemplate(template: TemplateConfig): void {
		if (!template.apple?.icon) {
			throw new WalletError("APPLE_MISSING_ICON");
		}
	}

	checkContent(): void {
		// Apple accepts any non-empty serial number, which the schema ensures.
	}

	/** Sign one `.pkpass`. */
	async issue(item: PassItem): Promise<Uint8Array> {
		validateAppleRequirements(item.template);
		return await this.sign(item, await collectImages(item.template));
	}

	/**
	 * Sign one `.pkpass` per item and bundle them into a `.pkpasses`, loading
	 * each distinct template's images once.
	 *
	 * @throws {WalletError} `PASS_BUNDLE_INVALID` past Apple's 150 MB bundle cap.
	 */
	async issueBundle(items: readonly PassItem[]): Promise<Uint8Array> {
		for (const { template } of items) {
			validateAppleRequirements(template);
		}
		const images = new Map<
			TemplateConfig,
			Promise<Record<string, Uint8Array>>
		>();
		const passes = await Promise.all(
			items.map(async (item) => {
				let files = images.get(item.template);
				if (!files) {
					files = collectImages(item.template);
					images.set(item.template, files);
				}
				return await this.sign(item, await files);
			})
		);
		const bundle = packagePasses(passes);
		if (bundle.byteLength > MAX_BUNDLE_BYTES) {
			throw new WalletError(
				"PASS_BUNDLE_INVALID",
				"The .pkpasses bundle exceeds Apple's 150 MB limit"
			);
		}
		return bundle;
	}

	/**
	 * Push to every device registered for the pass, which then downloads it
	 * from the handler, and drop registrations APNs reports as gone. Apple
	 * always alerts for fields with a `changeMessage`, so `notify` does not
	 * apply. `null` without `webService`.
	 */
	async update({ content }: PassItem): Promise<AppleUpdate> {
		const { webService, passTypeIdentifier } = this.credentials;
		if (!(webService && this.push)) {
			return null;
		}
		const { serialNumber } = content;
		const devices = await webService.registrations.devices(serialNumber);
		const { notified, failed, unregistered } = await this.send(devices, {
			...this.push,
			topic: passTypeIdentifier,
		});
		// Pushes are deduplicated by token, so drop every device holding a token
		// APNs no longer accepts, not only the one reported.
		const gone = new Set(unregistered.map(({ pushToken }) => pushToken));
		const stale = devices.filter(({ pushToken }) => gone.has(pushToken));
		await Promise.all(
			stale.map(({ deviceLibraryIdentifier }) =>
				webService.registrations.remove(deviceLibraryIdentifier, serialNumber)
			)
		);
		return { notified, failed, removed: stale.length };
	}

	/**
	 * Sign one pass from its template's loaded images. With `webService`, it
	 * carries the service URL and its own authentication token, so the handler
	 * can update it.
	 */
	private async sign(
		{ template, content }: PassItem,
		images: Record<string, Uint8Array>
	): Promise<Uint8Array> {
		const { webService } = this.credentials;
		const encoder = new TextEncoder();
		const files: Record<string, Uint8Array> = {};

		const passJson = buildPassJson(
			template,
			content,
			this.credentials,
			webService && {
				url: webService.url,
				authenticationToken: appleAuthToken(
					webService.secret,
					this.credentials.passTypeIdentifier,
					content.serialNumber
				),
			}
		);
		files["pass.json"] = encoder.encode(JSON.stringify(passJson));

		if (template.locales) {
			const values = content.values ?? {};
			for (const [language, translations] of Object.entries(template.locales)) {
				const lines = buildStringsLines(template, values, translations);
				files[`${language}.lproj/pass.strings`] = encoder.encode(
					lines.join("\n")
				);
			}
		}

		Object.assign(files, images);
		return await packagePass(files, this.credentials);
	}
}
