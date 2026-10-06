---
"passlet": patch
---

Issuing a new Google pass makes one fewer request: `create()` and `createBundle()` now insert the pass object first and only update it when Google reports it already exists.
