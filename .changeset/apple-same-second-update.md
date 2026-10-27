---
"passlet": patch
---

An Apple pass updated twice within the same second now reaches devices. The web service answered the second version with `304 Not Modified`, because HTTP dates have whole seconds and both versions carried the same `Last-Modified`; the device kept the first version until the next update. Pass responses now carry `Last-Modified` only once the second of `updatedAt` is over (RFC 9110 §8.8.2.2), so a device fetching in that second always gets the full pass. Pass responses also carry `Content-Length` now.
