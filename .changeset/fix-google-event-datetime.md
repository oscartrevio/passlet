---
"passlet": patch
---

Fix Google Wallet event passes not showing the date/time. Event ticket classes now emit the correct `dateTime.start` / `dateTime.end` (EventDateTime) fields instead of the `localScheduled*` fields, which belong to flight/transit classes and were silently dropped by Google — so the scheduled time never rendered under the event headline.
