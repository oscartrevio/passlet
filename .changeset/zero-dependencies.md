---
"passlet": minor
---

passlet now has no runtime dependencies. Validation is bundled from `zod/mini`, so installing passlet no longer pulls in `zod` (8 MB), and the package loads faster.

Schema defaults now apply: a coupon without `redemptionChannel` is issued as `"both"` instead of failing on Google, and a barcode without `format` renders as QR on both wallets. Fields with a default (`redemptionChannel`, barcode `format`, `fields`, Google message `messageType`, rotating barcode `type`, `periodMillis` and `algorithm`) are optional in the types, and `template.config` holds the config with its defaults applied.
