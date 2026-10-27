---
"passlet": patch
---

Apple passes take less work to issue and to serve. A template's images are now hashed once instead of on every pass, bundle item and web service render; passlet keeps its own copy of image bytes, so reusing the `Uint8Array` you passed in no longer changes later passes. The @1x, @2x and @3x versions of an image URL now download at the same time, and a URL named twice in a template (an icon that is also the logo) downloads once. Devices that fetch the same version of a pass at the same moment, like a holder's iPhone and Apple Watch right after `wallet.update()`, now share one render instead of signing the pass once each.
