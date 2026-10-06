---
"passlet": patch
---

Apple passes signed with an in-memory `signerKey` now use SHA-256 instead of SHA-1 for the signature digest. The manifest.json file hashes stay SHA-1, as Apple specifies.
