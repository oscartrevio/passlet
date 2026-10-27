# passlet

## 4.0.0

### Major Changes

- b323088: **Breaking.** A smaller, documented public API:
  
  - Every option of every exported type now carries its documentation, so editors show it on hover.
  - The option types you build separately are exported: `AppleOptions`, `AppleEventTicketOptions`, `AppleBoardingPassOptions`, `AppleNfc`, `Beacon`, `RelevantDate`, `AppleContentOptions`, `GoogleOptions`, `GoogleBoardingPassOptions`, `GoogleContentOptions`, `TotpParameter`, `EventVenue`, `WalletErrorDefinition`, and `ParsedTemplate`, the type of `template.config`.
  - `PassTemplate` can no longer be constructed with `new`; get one from a `Wallet` method (`wallet.loyalty()`, …) as before. Its declaration no longer exposes passlet's provider internals.
  - `LocaleCode` is removed; `locales` keys were always plain BCP 47 strings.
  - `WALLET_ERROR_CODES` entries are typed as `WalletErrorDefinition` (`status: number`, `message`, `why`, `fix: string`) instead of their literal values. `WalletErrorCode` is unchanged.
  - `appLinkData` now takes the targets Google documents: `android: { packageName }` opens your Android app (Google's preferred target), `web: { uri, description }` opens a web page with the description Google requires on it, and `displayText` (at most 30 characters) labels the button. `appLinkData.ios` is removed, since Google no longer supports links to iOS apps, and so are each link's `title`, `description` and `logoUrl`, which Google no longer shows. https://developers.google.com/wallet/reference/rest/v1/AppLinkData
- b323088: **Breaking.** Validation no longer bundles `zod/mini`: passlet checks templates and content with its own small validator. `dist/index.js` is 43% smaller than in 3.2.0 (205 KB → 116 KB, 33 KB gzipped), `import("passlet")` takes 15 ms instead of 25 ms, and building a template takes a quarter of the time. Unknown keys are still dropped and every default still applies; what changed for you:
  
  - Messages are passlet's own, in English, and name the failing path once: `barcode.format: must be one of "QR", "PDF417", …`, `id: must not be empty` (was `TemplateConfig missing: id`), `google.valueAdded: accepts at most 10 entries`. A problem with the content as a whole reads `content: …`. `issues` still lists every failing path.
  - `expiresAt`, `validFrom` and Google message `displayInterval` dates now take any W3C timestamp, as Apple and Google do: a UTC offset (`"2026-12-09T13:00:00-07:00"`) and minute precision (`"2026-12-09T13:00-07:00"`) were rejected before. A time zone is still required. `startsAt`, `endsAt`, `departure` and `arrival` also take minute precision with a zone.
  - Apple image URLs must be `http:` or `https:`, since passlet downloads them. Google `links[].uri` and `valueAdded[].uri` must carry a scheme (`https:`, `tel:`, `mailto:`, `geo:`, an app deep link), as Google requires; an empty string was the only thing rejected before.
  - A beacon `proximityUUID` may be any 8-4-4-4-12 hex UUID, not only RFC 9562 versions, and email options take any `name@domain.tld`.
  - An Apple `relevantDates` entry with both `date` and `startDate`/`endDate` is rejected at that entry, since Apple defines each entry as one or the other; it was read as `{ date }` before.
- b323088: **Breaking.** Every pass is built through one path, so the same checks apply everywhere:
  
  - A template that reaches a `Wallet` from elsewhere, returned by `load` (for `wallet.update()` and the Apple web service) or passed to `createBundle()`, is checked against that Wallet's credentials the first time it is used. A boarding pass without `transitType` returned by `load` now throws `APPLE_BOARDING_MISSING_TRANSIT_TYPE` instead of producing a pass Apple cannot render. `createBundle()` accepts a template built by another `Wallet` once it passes those checks, instead of rejecting it with `PASS_BUNDLE_INVALID`.
  - When `apple.webService.registrations` fails during `wallet.update()`, the error is a `WalletError` with the new code `APPLE_REGISTRATIONS_FAILED`, your storage's error as `cause`, and, with Google configured, `results`, so you can tell that Google already applied the update. It used to be your storage's own error, without `results`.
  - `template.expire()` throws `GOOGLE_NOT_CONFIGURED` without Google credentials, as `publish()` and `sendMessage()` do, instead of silently doing nothing.
- b323088: **Breaking.** passlet is now published as an ES module only, and needs Node.js `^20.19.0 || >=22.12.0`. Those versions load ES modules with `require()`, so CommonJS apps keep calling `require("passlet")` unchanged (Node 22.12 prints a one-time `ExperimentalWarning` for it; later 22.x releases don't); only Node 20.15–20.18 and 22.0–22.11 must upgrade (Node 20 itself reached end of life in April 2026). Dropping the CommonJS copy halves the package (`index.cjs` and `index.d.cts` are gone) and removes the dual-package hazard where an app that loaded passlet both ways got two `WalletError` classes, so `instanceof WalletError` and the check that a template belongs to its `Wallet` failed across them.

### Patch Changes

- b323088: `toNodeListener` no longer special-cases `Set-Cookie` response headers: it adapts `wallet.handler`, which never sets cookies. A handler of your own that sets several cookies through it now sends only the last one.
- b323088: Apple passes take less work to issue and to serve. A template's images are now hashed once instead of on every pass, bundle item and web service render; passlet keeps its own copy of image bytes, so reusing the `Uint8Array` you passed in no longer changes later passes. The @1x, @2x and @3x versions of an image URL now download at the same time, and a URL named twice in a template (an icon that is also the logo) downloads once. Devices that fetch the same version of a pass at the same moment, like a holder's iPhone and Apple Watch right after `wallet.update()`, now share one render instead of signing the pass once each.
- b323088: An Apple pass updated twice within the same second now reaches devices. The web service answered the second version with `304 Not Modified`, because HTTP dates have whole seconds and both versions carried the same `Last-Modified`; the device kept the first version until the next update. Pass responses now carry `Last-Modified` only once the second of `updatedAt` is over (RFC 9110 §8.8.2.2), so a device fetching in that second always gets the full pass. Pass responses also carry `Content-Length` now.
- b323088: Apple pass signatures list their signed attributes in DER order (content type, signing time, message digest), as CMS requires, so verifiers that re-encode the attributes accept them too. Signing with an in-memory `signerKey` no longer blocks the event loop: it runs on Node's thread pool, so the passes of a `createBundle()` sign in parallel and other requests keep being served meanwhile. An unsupported `signer.digestAlgorithm` now throws `APPLE_INVALID_SIGNER_KEY` from `new Wallet()` instead of `APPLE_SIGNING_FAILED` from every `create()`, and that error's `why` and `fix` mention it.
- b323088: Google writes make fewer and faster requests. A `Wallet` remembers which classes exist (Google cannot delete a class), so after the first pass from a template `create()` is a single request instead of two, and concurrent first issues check and create the class once. `wallet.update()` patches the pass first and only looks at the class when Google has no pass yet: one request instead of two. `createBundle()` writes every pass in parallel, each right after its class, instead of one request after another, so a bundle waits on at most three round trips (class check, class insert, passes), and one once the `Wallet` knows its classes; invalid content in any item still fails before anything is written, and when one write fails, `createBundle()` rejects only after the others have finished, so nothing is still landing on Google afterwards. Concurrent requests on a new `Wallet`, or after its access token expires, now share one token exchange instead of each signing and sending its own.
- b323088: `google.messages` on a generic template now reach Google. They were dropped from the class, so the messages meant for every holder of a generic pass never appeared.
- b323088: `wallet.update(serialNumber, { notify: true })` no longer sends Google's `notifyPreference` for generic passes. Google's `genericObject` has no such field and dropped it without notifying anyone; to notify generic pass holders, use `PassTemplate.sendMessage()` with `messageType: "TEXT_AND_NOTIFY"`.
- b323088: Google passes no longer show the same value twice. A gift card's `balance` and `cardNumber`, and a boarding pass's passenger name, appeared both in their own slot and again as a text module; every field that Google shows in a dedicated slot is now left out of the text modules, as loyalty and event fields already were. A boarding pass's `passengerName` field now also uses the field's `value` when the recipient sets none, instead of failing with `GOOGLE_FLIGHT_MISSING_PASSENGER_NAME`; `values.passengerName` without a template field still works.
- b323088: Google `publish()` no longer wipes class fields passlet does not set. It used to read the class and write it back whole, so nested fields such as a flight's `origin.gate` and `origin.terminal`, the airline name in `flightHeader`, or an event's `dateTime.doorsOpen` were lost, and a gate change made in the Google console or by another system was undone (and could notify holders). `publish()` now patches the class in one request: the fields passlet owns are written or cleared, everything else stays as it is.
- b323088: The published build now imports Node built-ins by their `node:` names (`node:crypto`, `node:zlib`, `node:stream`, `node:http2`) instead of bare `crypto`, `zlib` and `stream`. Bundlers and runtimes that resolve a bare `crypto` or `stream` to a polyfill or an npm package now get Node's own modules, as passlet's "Node built-ins only" promise intends. Every Node version passlet supports resolves these names; nothing changes for code that already runs on Node.

## 3.2.0

### Minor Changes

- 45fa20a: Apple pass updates are lighter on APNs and your servers. `wallet.update()` now keeps its APNs connection open for later updates instead of opening one per call, as Apple asks; the idle connection never keeps your process alive and closes after an hour unused. When the connection drops mid-update, every push APNs already answered still counts, including tokens it reported as unregistered, whose registrations are still removed; pushes the drop took down are retried once on a new connection, then count as `failed`. Apple image URLs are now downloaded once per template instead of on every pass the web service renders (a failed download is retried by the next pass), and a download that takes over 10 seconds fails with `IMAGE_FETCH_NETWORK_ERROR`. New: `apple.webService.onError(error, request)` sees the errors behind the web service's bare 500 responses, and `registrations.updatablePasses(deviceLibraryIdentifier, passesUpdatedSince)` lets a device's poll for changed passes run one query instead of calling `load` for every pass it holds. Importing passlet no longer loads `node:http2` until the first push.
- 45fa20a: With both Apple and Google configured, `create()`, `createBundle()` and `update()` still throw the first failure (Apple's, then Google's) with its own code, but a `WalletError` now carries a new `results` field (exported type `PlatformResults`) holding how each platform settled, so you can tell that Google already patched the object when Apple failed, and Google's error is no longer lost when both fail. Validation messages are now in English (e.g. `barcode.format: Invalid option: expected one of "QR"|"PDF417"|…`) instead of zod/mini's bare "Invalid input". `IssuedPass.apple` and `IssuedBundle.apple` are typed `Uint8Array<ArrayBuffer>`, so they pass straight to `new Response()` under current TypeScript DOM types. The published package now includes its LICENSE.
- 45fa20a: Google Wallet fixes, verified against Google's reference docs. New `PassTemplate.sendMessage(serialNumber, message)` adds a message to an issued pass through Google's AddMessage API, the only way Google documents a `TEXT_AND_NOTIFY` push (at most 3 per pass per day). `publish()` now clears class options the template no longer sets (hero image, messages, app link, Smart Tap issuers, locations, modules) and sends `enableSmartTap: false` to turn Smart Tap off. Classes are always written with `reviewStatus` `DRAFT` or `UNDER_REVIEW`, the only values Google accepts on insert and update. Concurrent first issues from a new template no longer fail with `GOOGLE_CONFLICT`. Access tokens are cached for the `expires_in` Google returns, and a cached token Google rejects with 401 is replaced and the request retried once. Template IDs Google cannot use in a class ID now throw `PASS_CONFIG_INVALID` at construction, and air boarding passes missing flight details throw `GOOGLE_FLIGHT_MISSING_CLASS_FIELDS` at construction instead of on first issue; `expire()` checks the serial number too. Gift card balances are converted to micros exactly and a non-decimal balance throws `CREATE_CONFIG_INVALID` before any request; the balance currency falls back to the balance field's `currencyCode`. Loyalty and offer classes carry `localizedProgramName`, `localizedTitle`, `localizedProvider`, and every class `localizedIssuerName` from `locales.<lang>.name`.

### Patch Changes

- 45fa20a: Apple passes now also emit the deprecated `relevantDate` (first relevance date) for devices before iOS 18, which only read the singular key; `apple.relevantDates` accepts UTC offsets such as `"2025-12-09T13:00-07:00"`; event and flight times without a time zone stay out of Apple's date keys (`relevantDates`, `eventStartDate`, `originalDepartureDate`, …) because Apple needs W3C timestamps, while Google still receives them; `venueName` falls back to the template's `venue.name`. Apple credentials are parsed once when the `Wallet` is built: PEM with literal `\n` escapes is accepted, and a `signerKey` that does not match `signerCert` or a `wwdr` that did not issue it throws `APPLE_INVALID_SIGNER_KEY` / `APPLE_INVALID_WWDR` immediately. Template-only Apple rules (`transitType`, `appLaunchURL` with `associatedStoreIdentifiers`) are now checked when the template is defined.
- 45fa20a: Connections and caches now belong to each `Wallet` instead of being shared module-wide: its APNs connection, its template images and its Google access token. An invalid `google.privateKey` now throws `GOOGLE_INVALID_PRIVATE_KEY` from `new Wallet()` instead of on the first Google request.

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
