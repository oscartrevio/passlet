---
"passlet": minor
---

With both Apple and Google configured, `create()`, `createBundle()` and `update()` still throw the first failure (Apple's, then Google's) with its own code, but a `WalletError` now carries a new `results` field (exported type `PlatformResults`) holding how each platform settled, so you can tell that Google already patched the object when Apple failed, and Google's error is no longer lost when both fail. Validation messages are now in English (e.g. `barcode.format: Invalid option: expected one of "QR"|"PDF417"|…`) instead of zod/mini's bare "Invalid input". `IssuedPass.apple` and `IssuedBundle.apple` are typed `Uint8Array<ArrayBuffer>`, so they pass straight to `new Response()` under current TypeScript DOM types. The published package now includes its LICENSE.
