---
"passlet": major
---

**Breaking.** Every pass is built through one path, so the same checks apply everywhere:

- A template that reaches a `Wallet` from elsewhere, returned by `load` (for `wallet.update()` and the Apple web service) or passed to `createBundle()`, is checked against that Wallet's credentials the first time it is used. A boarding pass without `transitType` returned by `load` now throws `APPLE_BOARDING_MISSING_TRANSIT_TYPE` instead of producing a pass Apple cannot render. `createBundle()` accepts a template built by another `Wallet` once it passes those checks, instead of rejecting it with `PASS_BUNDLE_INVALID`.
- When `apple.webService.registrations` fails during `wallet.update()`, the error is a `WalletError` with the new code `APPLE_REGISTRATIONS_FAILED`, your storage's error as `cause`, and, with Google configured, `results`, so you can tell that Google already applied the update. It used to be your storage's own error, without `results`.
- `template.expire()` throws `GOOGLE_NOT_CONFIGURED` without Google credentials, as `publish()` and `sendMessage()` do, instead of silently doing nothing.
