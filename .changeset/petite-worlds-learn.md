---
"passlet": patch
---

Fix Google Wallet hero image and class update behavior

- **Banner ImageSet support**: when `banner` is passed as an `ImageSet` object (`{ base, retina, superRetina }`), the Google provider now correctly uses the `base` URL as the `heroImage`. Previously only plain string URLs were picked up; an `ImageSet` with a URL base was silently dropped.

- **Class upsert**: `create()` now updates the Google Wallet class body (colors, images, names) on every call instead of no-op-ing when the class already exists. `reviewStatus` is intentionally excluded from the update so approved classes are never demoted.
