---
"passlet": patch
---

An expired Google pass now stays expired after `wallet.update()` or a repeated `create()`. Only the insert that creates a Google object sets it `ACTIVE`; updates no longer send a state.
