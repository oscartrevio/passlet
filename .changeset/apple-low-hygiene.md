---
"passlet": patch
---

Apple Wallet correctness hardening:

- Emit the deprecated singular `barcode` alongside `barcodes` for older-OS
  fallback (L-1).
- Encode QR/Aztec barcode payloads as UTF-8 so non-Latin-1 characters are not
  mangled; PDF417/Code128 stay on iso-8859-1 (L-9).
- Reject a field `changeMessage` that lacks the required `%@` placeholder (L-2).
- Only emit `row` on auxiliary fields, and drop `textAlignment` on primary/back
  fields, matching Apple's field rules (L-4, L-5).
- Warn when the icon has no `@2x` variant, and when an event ticket sets both a
  `strip` and a `background`/`thumbnail` (L-7, L-6).
- Throw `APPLE_APP_LAUNCH_URL_REQUIRES_STORE_IDS` when `appLaunchURL` is set
  without `associatedStoreIdentifiers` (L-8).
