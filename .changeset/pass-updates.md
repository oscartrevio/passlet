---
"passlet": major
---

**Breaking.** Upgrade with the [migration guide](https://github.com/oscartrevio/passlet/blob/main/MIGRATION.md).

- **Pass updates.** Give `new Wallet()` a `load(serialNumber)` function and call `wallet.update(serialNumber, { notify: true })` after your data changes. Google objects update in place; Apple devices get an APNs push and download the new pass from `wallet.handler`, the built-in Apple web service (`apple.webService: { url, secret, registrations }`; mount it with `toNodeListener` outside Fetch-based frameworks). Each Apple pass gets its own authentication token.
- **Bundles.** `wallet.createBundle([{ template, content }, ...])` issues up to 10 passes at once: an Apple `.pkpasses` bundle (`APPLE_PASSES_CONTENT_TYPE`) and one Google save JWT. `content.group` groups related passes in both wallets.
- **Pass vocabulary.** `Pass` → `PassTemplate`, `CreateConfig` → `PassContent`, `wallet.event()` → `wallet.eventTicket()`, `wallet.flight()` → `wallet.boardingPass()`, and the matching types.
- **No more warnings.** `create()` returns `{ apple, google }`; problems it used to warn about now throw.
- **Removed.** `Pass.update()` (use `wallet.update()`), `Pass.delete()` (Google has no delete; it never removed anything), template `apple.webServiceURL` / `apple.authenticationToken` / `apple.groupingIdentifier`, and `APPLE_MISSING_AUTH_TOKEN`.
- **New error codes.** `APPLE_WEB_SERVICE_INVALID`, `APPLE_PUSH_FAILED`, `UPDATES_NOT_CONFIGURED`, `PASS_NOT_FOUND`, `PASS_BUNDLE_INVALID`.
