import type {
	AppleCredentials,
	AppleWebService,
	LoadedPass,
	LoadPass,
	PassRegistrations,
} from "../config";
import { WalletError } from "../errors";
import { notFound } from "../http";
import type { UpdateResult } from "../output";
import type { PassItem, Provider } from "../providers";
import type { ParsedTemplate } from "../schema/template";
import { ApnsClient } from "./apns";
import { type AppleAuthTokens, appleAuthTokens } from "./auth-token";
import { collectImages } from "./images";
import {
	encoder,
	type PassFile,
	packagePass,
	packagePasses,
	passFile,
} from "./package";
import { buildPassJson } from "./pass-json";
import {
	type AppleSigningIdentity,
	parseSigningIdentity,
	unescapePem,
} from "./signature";
import { buildLocalizations } from "./strings";
import { createAppleWebService } from "./web-service";

// Apple's authenticationToken is derived from this with HMAC-SHA256; 32
// characters keeps a guessable secret from undermining every issued pass.
const MIN_SECRET_LENGTH = 32;

// "You can have up to 10 passes or 150 MB for a bundle of passes."
// https://developer.apple.com/documentation/walletpasses/distributing-and-updating-a-pass
const MAX_BUNDLE_BYTES = 150_000_000;

type AppleUpdate = UpdateResult["apple"];

export interface AppleProviderOptions {
	/** Reads a pass's current content; required with `webService`. */
	load?: LoadPass;
	/** Turn loaded content into a checked item to render for `serialNumber`. */
	resolve(loaded: LoadedPass, serialNumber: string): PassItem;
}

/** What a configured `webService` adds: updatable passes and their pushes. */
interface AppleUpdates {
	readonly apns: ApnsClient;
	readonly registrations: PassRegistrations;
	readonly tokens: AppleAuthTokens;
	readonly url: string;
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
	private readonly updates: AppleUpdates | undefined;
	// Each template's images, loaded and hashed once per provider.
	private readonly images = new WeakMap<
		ParsedTemplate,
		Promise<readonly PassFile[]>
	>();

	/**
	 * @throws {WalletError} `APPLE_INVALID_SIGNER_CERT`, `APPLE_INVALID_WWDR`
	 * or `APPLE_INVALID_SIGNER_KEY` if the signing credentials are unusable or
	 * do not belong together, `APPLE_WEB_SERVICE_INVALID` if `webService` is
	 * malformed, or `UPDATES_NOT_CONFIGURED` if it is set without `load`.
	 */
	constructor(
		credentials: AppleCredentials,
		{ load, resolve }: AppleProviderOptions
	) {
		this.credentials = credentials;
		this.identity = parseSigningIdentity(credentials);
		const { passTypeIdentifier, webService } = credentials;
		if (!webService) {
			this.updates = undefined;
			this.handler = notFound;
			return;
		}
		const push = resolvePushCredentials(this.identity, webService);
		if (!load) {
			throw new WalletError(
				"UPDATES_NOT_CONFIGURED",
				"apple.webService needs load to serve updated passes"
			);
		}
		const tokens = appleAuthTokens(webService.secret, passTypeIdentifier);
		this.updates = {
			apns: new ApnsClient({ ...push, topic: passTypeIdentifier }),
			registrations: webService.registrations,
			tokens,
			url: webService.url,
		};
		this.handler = createAppleWebService({
			passTypeIdentifier,
			tokens,
			registrations: webService.registrations,
			load,
			onLog: webService.onLog,
			onError: webService.onError,
			renderPass: (loaded, serialNumber) =>
				this.issue(resolve(loaded, serialNumber)),
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

	/**
	 * Sign one `.pkpass`. With `webService`, it carries the service URL and its
	 * own authentication token, so the handler can update it.
	 */
	async issue({
		template,
		content,
	}: PassItem): Promise<Uint8Array<ArrayBuffer>> {
		const images = await collectImages(template, this.images);
		const passJson = buildPassJson(
			template,
			content,
			this.credentials,
			this.updates && {
				url: this.updates.url,
				authenticationToken: this.updates.tokens.issue(content.serialNumber),
			}
		);
		return await packagePass(
			[
				passFile("pass.json", encoder.encode(JSON.stringify(passJson))),
				...buildLocalizations(template, content.values ?? {}),
				...images,
			],
			this.identity
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
		const bundle = packagePasses(
			await Promise.all(items.map((item) => this.issue(item)))
		);
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
	 *
	 * @throws {WalletError} `APPLE_REGISTRATIONS_FAILED` when the user's
	 * registrations storage fails, so `wallet.update()` can attach `results`.
	 */
	async update({ content }: PassItem): Promise<AppleUpdate> {
		if (!this.updates) {
			return null;
		}
		const { apns, registrations } = this.updates;
		const { serialNumber } = content;
		const { notified, failed, unregistered } = await apns.send(
			await fromRegistrations(() => registrations.devices(serialNumber))
		);
		await fromRegistrations(() =>
			Promise.all(
				unregistered.map(({ deviceLibraryIdentifier }) =>
					registrations.remove(deviceLibraryIdentifier, serialNumber)
				)
			)
		);
		return { notified, failed, removed: unregistered.length };
	}
}

/** Runs a call into the user's registrations storage, wrapping its failure. */
async function fromRegistrations<T>(call: () => Promise<T>): Promise<T> {
	try {
		return await call();
	} catch (cause) {
		throw new WalletError("APPLE_REGISTRATIONS_FAILED", undefined, { cause });
	}
}
