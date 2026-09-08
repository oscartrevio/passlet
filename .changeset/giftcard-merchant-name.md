---
"passlet": patch
---

Fix Google gift card classes being rejected with `400 Invalid value at 'resource' (merchant_name)`: `giftCardClass.merchantName` is now sent as the plain string Google expects, and `locales` translations of the pass name go to `localizedMerchantName`.
