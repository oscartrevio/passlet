import type { AppleProvider } from "./apple/index";
import { WalletError, withResults } from "./errors";
import type { GoogleProvider } from "./google/index";
import type { ParsedContent } from "./schema/content";
import type { ParsedTemplate } from "./schema/template";

/** One pass to render: the template it comes from and its recipient's content. */
export interface PassItem {
	content: ParsedContent;
	template: ParsedTemplate;
}

/** What every wallet platform does with templates and passes. */
export interface Provider<Issued, Updated> {
	/** Reject a template this platform cannot render. */
	checkTemplate(template: ParsedTemplate): void;
	/** Issue one pass: Apple signs a `.pkpass`, Google signs a save JWT. */
	issue(item: PassItem): Promise<Issued>;
	/**
	 * Issue a batch: Apple bundles a `.pkpasses`, Google signs one save JWT for
	 * every item. Per-template work runs once per distinct template.
	 */
	issueBundle(items: readonly PassItem[]): Promise<Issued>;
	update(item: PassItem, options: { notify?: boolean }): Promise<Updated>;
}

/** The platforms a wallet issues to; `null` where credentials were omitted. */
export interface Providers {
	readonly apple: AppleProvider | null;
	readonly google: GoogleProvider | null;
}

/**
 * Run one operation on every configured platform at once. Each runs to
 * completion even if another fails, then the first failure (Apple's, then
 * Google's) is thrown. With both platforms configured it carries `results`:
 * how each platform settled, so the caller knows whether the other already
 * applied its change.
 *
 * Providers throw only `WalletError`s, wrapping user callbacks where they
 * call them; anything else is a passlet bug, rethrown as is.
 */
export async function runProviders<Apple, Google>(
	providers: Providers,
	apple: (provider: AppleProvider) => Promise<Apple>,
	google: (provider: GoogleProvider) => Promise<Google>
): Promise<{ apple: Apple | null; google: Google | null }> {
	const [appleResult, googleResult] = await Promise.allSettled([
		providers.apple ? apple(providers.apple) : null,
		providers.google ? google(providers.google) : null,
	]);
	if (
		appleResult.status === "fulfilled" &&
		googleResult.status === "fulfilled"
	) {
		return { apple: appleResult.value, google: googleResult.value };
	}
	const [failure] = [appleResult, googleResult].flatMap((result) =>
		result.status === "rejected" ? [result.reason] : []
	);
	if (providers.apple && providers.google && failure instanceof WalletError) {
		throw withResults(failure, { apple: appleResult, google: googleResult });
	}
	throw failure;
}
