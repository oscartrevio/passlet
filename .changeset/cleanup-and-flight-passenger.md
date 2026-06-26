---
"passlet": patch
---

Cleanup and flight passenger handling:

- Validate a static field `value` against its style: numeric for `numberStyle`,
  a parseable datetime for `dateStyle`/`timeStyle` (L-3).
- Google flight passes now throw `GOOGLE_FLIGHT_MISSING_PASSENGER_NAME` when
  `passengerName` is absent instead of sending an empty (and rejected) value
  (L-11).
- Remove dead code: the unreachable `transitType` default and the never-thrown
  `APPLE_UNSUPPORTED_BARCODE_FORMAT` error code (L-10).
