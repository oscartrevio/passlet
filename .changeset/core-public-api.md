---
"passlet": major
---

**Breaking.** A smaller, documented public API:

- Every option of every exported type now carries its documentation, so editors show it on hover.
- The option types you build separately are exported: `AppleOptions`, `AppleEventTicketOptions`, `AppleBoardingPassOptions`, `AppleNfc`, `Beacon`, `RelevantDate`, `AppleContentOptions`, `GoogleOptions`, `GoogleBoardingPassOptions`, `GoogleContentOptions`, `TotpParameter`, `EventVenue`, `WalletErrorDefinition`, and `ParsedTemplate`, the type of `template.config`.
- `PassTemplate` can no longer be constructed with `new`; get one from a `Wallet` method (`wallet.loyalty()`, …) as before. Its declaration no longer exposes passlet's provider internals.
- `LocaleCode` is removed; `locales` keys were always plain BCP 47 strings.
- `WALLET_ERROR_CODES` entries are typed as `WalletErrorDefinition` (`status: number`, `message`, `why`, `fix: string`) instead of their literal values. `WalletErrorCode` is unchanged.
- `appLinkData` now takes the targets Google documents: `android: { packageName }` opens your Android app (Google's preferred target), `web: { uri, description }` opens a web page with the description Google requires on it, and `displayText` (at most 30 characters) labels the button. `appLinkData.ios` is removed, since Google no longer supports links to iOS apps, and so are each link's `title`, `description` and `logoUrl`, which Google no longer shows. https://developers.google.com/wallet/reference/rest/v1/AppLinkData
