---
"passlet": patch
---

Stop publishing source maps, which were about half of the package (1.2 MB → 0.6 MB unpacked). The published code is not minified, so stack traces still name passlet's functions.
