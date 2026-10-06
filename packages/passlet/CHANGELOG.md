# passlet

## 3.1.1

### Patch Changes

- 4feeb95: On Google air boarding passes, the `seat` field is now sent as `boardingAndSeatingInfo.seatNumber`, shown in the card's seat slot, so `wallet.update(serial, { notify: true })` can notify the holder of a seat change.
- 063dad2: Values set to `null` are now removed from Google passes on update, as they already were on Apple. Before, `wallet.update()` left the old value on the Google pass: a loyalty balance, a text module, a seat, a barcode's alternate text, a message or a link that the content no longer had stayed visible. Fields passlet never sets are still left as they are.
- 4feeb95: An expired Google pass now stays expired after `wallet.update()` or a repeated `create()`. Only the insert that creates a Google object sets it `ACTIVE`; updates no longer send a state.
- 4feeb95: Apple passes signed with an in-memory `signerKey` now use SHA-256 instead of SHA-1 for the signature digest. The manifest.json file hashes stay SHA-1, as Apple specifies.

## 3.1.0

### Minor Changes

- eec6556: passlet now has no runtime dependencies. Validation is bundled from `zod/mini`, so installing passlet no longer pulls in `zod` (8 MB), and the package loads faster.
  
  Schema defaults now apply: a coupon without `redemptionChannel` is issued as `"both"` instead of failing on Google, and a barcode without `format` renders as QR on both wallets. Fields with a default (`redemptionChannel`, barcode `format`, `fields`, Google message `messageType`, rotating barcode `type`, `periodMillis` and `algorithm`) are optional in the types, and `template.config` holds the config with its defaults applied.

### Patch Changes

- eec6556: Issuing a new Google pass makes one fewer request: `create()` and `createBundle()` now insert the pass object first and only update it when Google reports it already exists.
- eec6556: Stop publishing source maps, which were about half of the package (1.2 MB → 0.6 MB unpacked). The published code is not minified, so stack traces still name passlet's functions.

## 3.0.0

### Major Changes

- 23d57fb: **Breaking.** Upgrade with the [migration guide](https://github.com/oscartrevio/passlet/releases/tag/passlet%403.0.0).
  
  - **Pass updates.** Give `new Wallet()` a `load(serialNumber)` function and call `wallet.update(serialNumber, { notify: true })` after your data changes. Google objects update in place; Apple devices get an APNs push and download the new pass from `wallet.handler`, the built-in Apple web service (`apple.webService: { url, secret, registrations }`; mount it with `toNodeListener` outside Fetch-based frameworks). Each Apple pass gets its own authentication token.
  - **Bundles.** `wallet.createBundle([{ template, content }, ...])` issues up to 10 passes at once: an Apple `.pkpasses` bundle (`APPLE_PASSES_CONTENT_TYPE`) and one Google save JWT. `content.group` groups related passes in both wallets.
  - **Pass vocabulary.** `Pass` → `PassTemplate`, `CreateConfig` → `PassContent`, `wallet.event()` → `wallet.eventTicket()`, `wallet.flight()` → `wallet.boardingPass()`, and the matching types.
  - **No more warnings.** `create()` returns `{ apple, google }`; problems it used to warn about now throw.
  - **Removed.** `Pass.update()` (use `wallet.update()`), `Pass.delete()` (Google has no delete; it never removed anything), template `apple.webServiceURL` / `apple.authenticationToken` / `apple.groupingIdentifier`, and `APPLE_MISSING_AUTH_TOKEN`.
  - **New error codes.** `APPLE_WEB_SERVICE_INVALID`, `APPLE_PUSH_FAILED`, `UPDATES_NOT_CONFIGURED`, `PASS_NOT_FOUND`, `PASS_BUNDLE_INVALID`.

### Minor Changes

- 23d57fb: Drop `node-forge`, `jose` and `jszip`: passlet now depends only on `zod`. Apple signatures, Google JWTs and `.pkpass` archives are built with Node's own `crypto` and `zlib`, producing the same output as before. This also removes the `node-forge` security advisory from your dependency tree.
  
  Other changes:
  
  - CommonJS consumers now get the CommonJS type declarations (`index.d.cts`); before, `require("passlet")` resolved ESM types.
  - Google `privateKey` now also accepts a PKCS#1 (`BEGIN RSA PRIVATE KEY`) PEM.
  - `engines` now declares Node.js `>=20.15`.

## 2.0.1

### Patch Changes

- 3b5e087: Fix Google `create()` hanging inside Next.js when the pass's class doesn't exist yet, and failed Google requests hanging instead of throwing. Next.js's patched `fetch` hands back one branch of a teed body, and awaiting `cancel()` on that branch never settles. Passlet now releases response bodies it won't read without waiting on them. Apple image fetch failures do the same.

## 2.0.0

### Major Changes

- cdbbc7c: Separate Google class publication from recipient issuance. `create()` still creates a missing class, but no longer overwrites an existing shared template. Call `await pass.publish()` after changing shared Google configuration, from setup or deployment code rather than on every download.

  Define errors with `code`, `status`, `message`, `why`, and `fix`. `WALLET_ERROR_CODES[code]` is now a structured catalog entry instead of a message string; use `.message` where a string is required. `WalletError.status` uses an upstream HTTP rejection status when available, otherwise its catalog default. Validation failures include all field paths in `issues`; Google HTTP failures preserve valid `Retry-After` delays as `retryAfter` seconds.

  Google failures now distinguish authentication, permission, missing resources, conflicts, rate limits, service outages, network errors, and malformed responses instead of reporting every failure as `GOOGLE_API_ERROR`. Update error-code switches accordingly. Response bodies and image URLs are no longer included in error messages, and malformed OAuth tokens are not cached.

  Correct the README quickstart, required image and credential setup, Apple update limitations, and integration guidance.

### Patch Changes

- 2b25933: Fix Google gift card classes being rejected with `400 Invalid value at 'resource' (merchant_name)`: `giftCardClass.merchantName` is now sent as the plain string Google expects, and `locales` translations of the pass name go to `localizedMerchantName`.

## 1.3.0

### Minor Changes

- 225858c: Vendor-documentation audit: fixes, new Wallet features, and golden-file contract tests.

  ### Added

  - Google transit vertical: `google.transit` on a flight pass issues `transitClass`/`transitObject` (rail, bus, tram, ferry) instead of the air-only `flightClass`
  - Google `linksModuleData`, `imageModulesData`, and `valueAddedModuleData` via `google.links`, `google.images`, and `google.valueAdded`
  - Push notifications on Google pass updates: `pass.update(config, { notify: true })`
  - Apple semantic tags supplied by the user at pass level (`apple.semantics`) and per field, merged over the auto-derived tags
  - New field keys: `attributedValue`, `dataDetectorTypes`, `ignoresTimeZone`, `isRelative`
  - `nfc.requiresAuthentication`
  - Barcode formats Code 39, Codabar, EAN-13, and ITF on both platforms (Apple emits them in the iOS 27+ `barcodes` array only), plus multiple barcodes via `createConfig.barcodes`
  - External Apple signer (`AppleCredentials.signer`) so private keys can stay in KMS/HSM
  - `googleSaveUrl()` helper and `APPLE_PASS_CONTENT_TYPE` constant
  - Literal `\n` sequences in the Google private key are normalized automatically
  - Template requirements (Apple icon, Google logo) now validate at construction instead of first `create()`

  ### Fixed

  - Google generic passes now render their color, logo, and hero image (`genericClass` has no branding fields; they belong on `genericObject`)
  - Wide logos now use the field name each Google class defines (`wideProgramLogo`, `wideLogo`, `wideTitleImage`, `wideAirlineLogo`); `wideProgramBanner` does not exist
  - Flight arrival time moved to the top-level `localScheduledArrivalDateTime` field on `flightClass`
  - Gift cards now show their merchant name (`giftCardClass` uses `merchantName`, not `cardTitle`)
  - Apple localization works: `pass.strings` entries are keyed by the literal strings emitted in `pass.json`, which is how Apple matches them
  - Apple date, time, number, and alignment styles now emit the required PK-prefixed constants; previously iOS ignored them
  - Event datetimes keep their UTC offset (Google converts offsets; stripping them shifted events by hours)
  - Back fields moved from the deprecated `infoModuleData` to `textModulesData`; the primary field on non-generic Google passes now renders as the first text module, because `header`/`subheader` only exist on generic objects
  - Deprecated `locations` replaced with `merchantLocations` on Google classes
  - The deprecated singular Apple `barcode` key is omitted for Code128, which is not legal there
  - Rotating barcodes restricted to `QR_CODE`/`PDF_417` per Google's documentation
  - Timezone required on `dateStyle`/`timeStyle` field values; Apple locations capped at 10; field `label` is optional

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
