import type { AppleProvider } from "./apple/index";
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
	/** Reject content this platform cannot issue, e.g. Google's serial characters. */
	checkContent(content: ParsedContent): void;
	/** Reject a template this platform cannot render. Runs at construction. */
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
 * Google's) is thrown.
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
	if (appleResult.status === "rejected") {
		throw appleResult.reason;
	}
	if (googleResult.status === "rejected") {
		throw googleResult.reason;
	}
	return { apple: appleResult.value, google: googleResult.value };
}
