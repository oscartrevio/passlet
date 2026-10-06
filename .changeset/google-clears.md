---
"passlet": patch
---

Values set to `null` are now removed from Google passes on update, as they already were on Apple. Before, `wallet.update()` left the old value on the Google pass: a loyalty balance, a text module, a seat, a barcode's alternate text, a message or a link that the content no longer had stayed visible. Fields passlet never sets are still left as they are.
