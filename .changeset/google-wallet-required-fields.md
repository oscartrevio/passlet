---
"passlet": patch
---

Fix Google Wallet required-field correctness bugs surfaced by a spec audit:

- `giftCardObject` now emits the required `cardNumber` (sourced from a
  `cardNumber` field, falling back to the serial number). Previously every
  gift-card object was rejected by the Wallet API.
- `genericObject` now always includes the required `header`, falling back to
  the pass name when there is no primary field.
- Flight passes now validate that `departure` is present, since Google
  `flightClass` requires `localScheduledDepartureDateTime`.
- `google.messages[].messageType` no longer accepts the invalid
  `"expireNotification"` value; only `TEXT` and `TEXT_AND_NOTIFY` are allowed.
