---
"passlet": major
---

Separate Google class publication from recipient issuance. `create()` still creates a missing class, but no longer overwrites an existing shared template. Call `await pass.publish()` after changing shared Google configuration, from setup or deployment code rather than on every download.

Define errors with `code`, `status`, `message`, `why`, and `fix`. `WALLET_ERROR_CODES[code]` is now a structured catalog entry instead of a message string; use `.message` where a string is required. `WalletError.status` uses an upstream HTTP rejection status when available, otherwise its catalog default. Validation failures include all field paths in `issues`; Google HTTP failures preserve valid `Retry-After` delays as `retryAfter` seconds.

Google failures now distinguish authentication, permission, missing resources, conflicts, rate limits, service outages, network errors, and malformed responses instead of reporting every failure as `GOOGLE_API_ERROR`. Update error-code switches accordingly. Response bodies and image URLs are no longer included in error messages, and malformed OAuth tokens are not cached.

Correct the README quickstart, required image and credential setup, Apple update limitations, and integration guidance.
