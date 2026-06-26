# passlet

## 1.2.0

### Minor Changes

- affb2d9: Expand Apple Wallet semantic tags: well-known display fields are now mapped to
  additional semantic tags — flight `gate`/`terminal`/`boardingZone`/`seat` to
  `departureGate`/`departureTerminal`/`boardingGroup`/`seats`, and event
  `venue`/`section`/`row`/`seat` to `venueName`/`seats` — so Wallet can render
  structured boarding and event details.
- 707869b: Map Google event fields to structured slots: `seat`/`row`/`section`/`gate` now
  populate `eventTicketObject.seatInfo` (rendered in Google's dedicated ticket UI
  instead of generic text modules), and a new structured event `venue`
  (`{ name, address }`) populates `eventTicketClass.venue`.
- 3d45efa: Add an optional `origins` field to `GoogleCredentials`. When set, it is included
  as the `origins` claim in the "Add to Google Wallet" JWT — required for the
  embeddable web save button to render.

### Patch Changes

- e4efdec: Apple Wallet correctness hardening:

  - Emit the deprecated singular `barcode` alongside `barcodes` for older-OS
    fallback (L-1).
  - Encode QR/Aztec barcode payloads as UTF-8 so non-Latin-1 characters are not
    mangled; PDF417/Code128 stay on iso-8859-1 (L-9).
  - Reject a field `changeMessage` that lacks the required `%@` placeholder (L-2).
  - Only emit `row` on auxiliary fields, and drop `textAlignment` on primary/back
    fields, matching Apple's field rules (L-4, L-5).
  - Warn when the icon has no `@2x` variant, and when an event ticket sets both a
    `strip` and a `background`/`thumbnail` (L-7, L-6).
  - Throw `APPLE_APP_LAUNCH_URL_REQUIRES_STORE_IDS` when `appLaunchURL` is set
    without `associatedStoreIdentifiers` (L-8).

- 84830ba: Cleanup and flight passenger handling:

  - Validate a static field `value` against its style: numeric for `numberStyle`,
    a parseable datetime for `dateStyle`/`timeStyle` (L-3).
  - Google flight passes now throw `GOOGLE_FLIGHT_MISSING_PASSENGER_NAME` when
    `passengerName` is absent instead of sending an empty (and rejected) value
    (L-11).
  - Remove dead code: the unreachable `transitType` default and the never-thrown
    `APPLE_UNSUPPORTED_BARCODE_FORMAT` error code (L-10).

- a8b2b22: Treat event and flight display datetimes as local venue/airport wall-clock
  time. `startsAt`/`endsAt`/`departure`/`arrival` now accept ISO datetimes with or
  without a UTC offset; any offset is preserved for Apple semantics and stripped
  for Google (which derives the timezone from the venue/airport and rejects an
  offset on flight times). This fixes flight class creation when an offset was
  provided and removes the previous UTC-relabelling ambiguity.

## 1.1.1

### Patch Changes

- 7333ae5: Publish the latest README (corrected examples, expanded usage guides, updated badges, removed early-release warning).

## 1.1.0

### Minor Changes

- c38c747: Fix Apple Wallet correctness gaps surfaced by a spec audit:

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

### Patch Changes

- cfed976: Fix Google Wallet required-field correctness bugs surfaced by a spec audit:

  - `giftCardObject` now emits the required `cardNumber` (sourced from a
    `cardNumber` field, falling back to the serial number). Previously every
    gift-card object was rejected by the Wallet API.
  - `genericObject` now always includes the required `header`, falling back to
    the pass name when there is no primary field.
  - Flight passes now validate that `departure` is present, since Google
    `flightClass` requires `localScheduledDepartureDateTime`.
  - `google.messages[].messageType` no longer accepts the invalid
    `"expireNotification"` value; only `TEXT` and `TEXT_AND_NOTIFY` are allowed.

## 1.0.3

### Patch Changes

- 8a66b49: Fix Google Wallet event passes not showing the date/time. Event ticket classes now emit the correct `dateTime.start` / `dateTime.end` (EventDateTime) fields instead of the `localScheduled*` fields, which belong to flight/transit classes and were silently dropped by Google — so the scheduled time never rendered under the event headline.

## 1.0.2

### Patch Changes

- 0c8500e: chore: update dependencies to latest

  Bumps the toolchain and dependencies to their latest versions (TypeScript 6.0,
  Biome 2.4.16, ultracite 7.8.2, commitlint 21, vitest, tsup, and others). `jose`
  is intentionally held at v5 because v6 is ESM-only and would break the published
  CommonJS bundle.

## 1.0.1

### Patch Changes

- 7f83a3a: chore: codebase quality cleanup

## 1.0.0

### Major Changes

- 62e9056: Images are now provider-specific

  The shared `logo` and `banner` fields have been removed from the top-level pass config. Use provider-specific image fields instead:

  **Apple** (`apple.*`) — accepts `ImageSet` (bytes or URL):

  - `apple.logo`
  - `apple.strip`

  **Google** (`google.*`) — URL only:

  - `google.logo`
  - `google.hero`

  **Migration**

  ```diff
   wallet.loyalty({
     id: "rewards",
     name: "Rewards Card",
  -  logo: "https://example.com/logo.png",
  -  banner: bannerBytes,
  +  apple: {
  +    icon: iconBytes,
  +    strip: bannerBytes,
  +  },
  +  google: {
  +    logo: "https://example.com/logo.png",
  +    hero: "https://example.com/hero.png",
  +  },
   });
  ```

## 0.2.5

### Patch Changes

- 073283e: Fix Google Wallet class updates rejecting with `Invalid review status Optional[APPROVED]` or `Review status must be set`. The class update now properly merges the existing remote class using a `PUT` request and normalizes the `reviewStatus` attribute to `UNDER_REVIEW`.
- aecdd26: Fix Google Wallet hero image and class update behavior

  - **Banner ImageSet support**: when `banner` is passed as an `ImageSet` object (`{ base, retina, superRetina }`), the Google provider now correctly uses the `base` URL as the `heroImage`. Previously only plain string URLs were picked up; an `ImageSet` with a URL base was silently dropped.

  - **Class upsert**: `create()` now updates the Google Wallet class body (colors, images, names) on every call instead of no-op-ing when the class already exists. `reviewStatus` is intentionally excluded from the update so approved classes are never demoted.

## 0.2.4

### Patch Changes

- b65596d: fix: omit barcode altText when not

## 0.2.3

### Patch Changes

- 8b9cd75: Throw `GOOGLE_MISSING_LOGO` before hitting the Google API when a loyalty pass has no logo. Previously the library would make the API call and surface a cryptic 400 response; now it fails fast with a clear `WalletError`.

## 0.2.2

### Patch Changes

- be02c8b: bump deps

## 0.2.1

### Patch Changes

- 6c36400: Fix zod catalog specifier for npm compatibility, surface upstream detail in Google API errors

## 0.2.0

### Minor Changes

- a83e16d: Initial release. Generate Apple Wallet and Google Wallet passes from a single TypeScript API.
