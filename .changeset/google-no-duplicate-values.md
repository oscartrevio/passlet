---
"passlet": patch
---

Google passes no longer show the same value twice. A gift card's `balance` and `cardNumber`, and a boarding pass's passenger name, appeared both in their own slot and again as a text module; every field that Google shows in a dedicated slot is now left out of the text modules, as loyalty and event fields already were. A boarding pass's `passengerName` field now also uses the field's `value` when the recipient sets none, instead of failing with `GOOGLE_FLIGHT_MISSING_PASSENGER_NAME`; `values.passengerName` without a template field still works.
