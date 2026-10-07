---
"passlet": patch
---

Connections and caches now belong to each `Wallet` instead of being shared module-wide: its APNs connection, its template images and its Google access token. An invalid `google.privateKey` now throws `GOOGLE_INVALID_PRIVATE_KEY` from `new Wallet()` instead of on the first Google request.
