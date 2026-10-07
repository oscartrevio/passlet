---
"passlet": patch
---

Apple passes now also emit the deprecated `relevantDate` (first relevance date) for devices before iOS 18, which only read the singular key; `apple.relevantDates` accepts UTC offsets such as `"2025-12-09T13:00-07:00"`; event and flight times without a time zone stay out of Apple's date keys (`relevantDates`, `eventStartDate`, `originalDepartureDate`, …) because Apple needs W3C timestamps, while Google still receives them; `venueName` falls back to the template's `venue.name`. Apple credentials are parsed once when the `Wallet` is built: PEM with literal `\n` escapes is accepted, and a `signerKey` that does not match `signerCert` or a `wwdr` that did not issue it throws `APPLE_INVALID_SIGNER_KEY` / `APPLE_INVALID_WWDR` immediately. Template-only Apple rules (`transitType`, `appLaunchURL` with `associatedStoreIdentifiers`) are now checked when the template is defined.
