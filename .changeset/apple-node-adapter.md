---
"passlet": patch
---

`toNodeListener` no longer special-cases `Set-Cookie` response headers: it adapts `wallet.handler`, which never sets cookies. A handler of your own that sets several cookies through it now sends only the last one.
