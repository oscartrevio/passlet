import { WalletError } from "../errors";
import type { PassItem, Provider } from "../providers";
import type {
	AppleCredentials,
	AppleWebService,
	LoadedPass,
	LoadPass,
	UpdateResult,
} from "../schema/settings";
import type { ParsedTemplate } from "../schema/template";
import { ApnsClient, type ApnsOptions } from "./apns";
import { appleAuthToken } from "./auth-token";
import { collectImages } from "./images";
import { packagePass, packagePasses } from "./package";
import { buildPassJson } from "./pass-json";
import {
	type AppleSigningIdentity,
	parseSigningIdentity,
	unescapePem,
} from "./signature";
import { buildStringsLines } from "./strings";
import { createAppleWebService } from "./web-service";

// Apple's authenticationToken is derived from this with HMAC-SHA256; 32
// characters keeps a guessable secret from undermining every issued pass.
const MIN_SECRET_LENGTH = 32;

// "You can have up to 10 passes or 150 MB for a bundle of passes."
// https://developer.apple.com/documentation/walletpasses/distributing-and-updating-a-pass
const MAX_BUNDLE_BYTES = 150_000_000;

type AppleUpdate = UpdateResult["apple"];

/** The part of {@link ApnsClient} the provider uses. */
export type ApnsSender = Pick<ApnsClient, "send">;

export interface AppleProviderOptions {
	/** Creates the APNs sender instead of an {@link ApnsClient}; for tests. */
	apns?: (options: ApnsOptions) => ApnsSender;
	/** Reads a pass's current content; required with `webService`. */
	load?: LoadPass;
	/** Turn loaded content into a checked item to render for `serialNumber`. */
	resolve(loaded: LoadedPass, serialNumber: string): PassItem;
}

/**
 * Check `apple.webService` and resolve the APNs credentials it will push with.
 * Messages name the setting at fault, never its value.
 */
function resolvePushCredentials(
	identity: AppleSigningIdentity,
	webService: AppleWebService
): { cert: string; key: string } {
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
		return {
			cert: unescapePem(webService.push.cert),
			key: unescapePem(webService.push.key),
		};
	}
	// APNs authenticates with TLS client certificates, so it needs the key
	// itself; an external signer cannot stand in for it.
	if (!identity.signerKey) {
		throw new WalletError(
			"APPLE_WEB_SERVICE_INVALID",
			"apple.webService.push is required when signing with apple.signer"
		);
	}
	return {
		cert: identity.signerCert.toString(),
		key: identity.signerKey.export({ format: "pem", type: "pkcs8" }).toString(),
	};
}

/**
 * Apple Wallet: signed `.pkpass` archives, plus the web service and push
 * notifications that keep issued passes current when `webService` is set.
 */
export class AppleProvider
	implements Provider<Uint8Array<ArrayBuffer>, AppleUpdate>
{
	/** Apple's pass web service; every route answers 404 without `webService`. */
	readonly handler: (request: Request) => Promise<Response>;
	private readonly credentials: AppleCredentials;
	private readonly identity: AppleSigningIdentity;
	private readonly apns: ApnsSender | undefined;
	// Each template's images, loaded once per provider.
	private readonly images = new WeakMap<
		ParsedTemplate,
		Promise<Record<string, Uint8Array>>
	>();

	/**
	 * @throws {WalletError} `APPLE_INVALID_SIGNER_CERT`, `APPLE_INVALID_WWDR`
	 * or `APPLE_INVALID_SIGNER_KEY` if the signing credentials are unusable or
	 * do not belong together, `APPLE_WEB_SERVICE_INVALID` if `webService` is
	 * malformed, or `UPDATES_NOT_CONFIGURED` if it is set without `load`.
	 */
	constructor(credentials: AppleCredentials, options: AppleProviderOptions) {
		this.credentials = credentials;
		this.identity = parseSigningIdentity(credentials);
		const { webService } = credentials;
		if (!webService) {
			this.apns = undefined;
			this.handler = () => Promise.resolve(new Response(null, { status: 404 }));
			return;
		}
		const push = resolvePushCredentials(this.identity, webService);
		const apnsOptions = { ...push, topic: credentials.passTypeIdentifier };
		this.apns = options.apns
			? options.apns(apnsOptions)
			: new ApnsClient(apnsOptions);
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
			onError: webService.onError,
			renderPass: async (loaded, serialNumber) =>
				await this.issue(resolve(loaded, serialNumber)),
		});
	}

	checkTemplate(template: ParsedTemplate): void {
		if (!template.apple?.icon) {
			throw new WalletError("APPLE_MISSING_ICON");
		}
		if (template.type === "boardingPass" && !template.transitType) {
			throw new WalletError("APPLE_BOARDING_MISSING_TRANSIT_TYPE");
		}
		// Apple ignores appLaunchURL without associated App Store IDs.
		if (
			template.apple.appLaunchURL &&
			!template.apple.associatedStoreIdentifiers?.length
		) {
			throw new WalletError("APPLE_APP_LAUNCH_URL_REQUIRES_STORE_IDS");
		}
	}

	checkContent(): void {
		// Apple accepts any non-empty serial number, which the schema ensures.
	}

	/** Sign one `.pkpass`. */
	async issue(item: PassItem): Promise<Uint8Array<ArrayBuffer>> {
		return await this.sign(
			item,
			await collectImages(item.template, this.images)
		);
	}

	/**
	 * Sign one `.pkpass` per item and bundle them into a `.pkpasses`.
	 *
	 * @throws {WalletError} `PASS_BUNDLE_INVALID` past Apple's 150 MB bundle cap.
	 */
	async issueBundle(
		items: readonly PassItem[]
	): Promise<Uint8Array<ArrayBuffer>> {
		const passes = await Promise.all(
			items.map(
				async (item) =>
					await this.sign(item, await collectImages(item.template, this.images))
			)
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
		const { webService } = this.credentials;
		if (!(webService && this.apns)) {
			return null;
		}
		const { serialNumber } = content;
		const devices = await webService.registrations.devices(serialNumber);
		const { notified, failed, unregistered } = await this.apns.send(devices);
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
	): Promise<Uint8Array<ArrayBuffer>> {
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
		return await packagePass(files, this.identity);
	}
}
