---
"passlet": patch
---

Apple pass signatures list their signed attributes in DER order (content type, signing time, message digest), as CMS requires, so verifiers that re-encode the attributes accept them too. Signing with an in-memory `signerKey` no longer blocks the event loop: it runs on Node's thread pool, so the passes of a `createBundle()` sign in parallel and other requests keep being served meanwhile. An unsupported `signer.digestAlgorithm` now throws `APPLE_INVALID_SIGNER_KEY` from `new Wallet()` instead of `APPLE_SIGNING_FAILED` from every `create()`, and that error's `why` and `fix` mention it.
