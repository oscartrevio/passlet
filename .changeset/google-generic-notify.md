---
"passlet": patch
---

`wallet.update(serialNumber, { notify: true })` no longer sends Google's `notifyPreference` for generic passes. Google's `genericObject` has no such field and dropped it without notifying anyone; to notify generic pass holders, use `PassTemplate.sendMessage()` with `messageType: "TEXT_AND_NOTIFY"`.
