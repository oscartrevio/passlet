---
"passlet": minor
---

Fix Apple Wallet correctness gaps surfaced by a spec audit:

- Flight and event passes now emit top-level **semantic tags**
  (`airlineCode`, `flightCode`, `flightNumber`, `departureAirportCode`,
  `destinationAirportCode`, `originalDepartureDate`/`originalArrivalDate`,
  `eventName`, `eventStartDate`/`eventEndDate`). Previously this structured
  data was dropped entirely on Apple, so Wallet could not offer flight
  tracking or event relevance.
- `relevantDates` is now derived from event `startsAt`/`endsAt` and flight
  `departure`/`arrival` when `apple.relevantDates` is not set explicitly,
  giving these passes lock-screen relevance.
- `apple.logoText` is no longer force-defaulted to the pass name (it is only
  emitted when you set it), and is omitted for poster event tickets where
  Apple uses `eventLogoText` instead.
- `apple.relevantDates` now accepts the single-moment `{ date }` form and
  requires `endDate` whenever `startDate` is given.
- `apple.nfc.encryptionPublicKey` is now required when `nfc` is present.
- `apple.webServiceURL` now requires an `authenticationToken`
  (`APPLE_MISSING_AUTH_TOKEN`).
