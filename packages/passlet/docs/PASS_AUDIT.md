# Passlet — Apple & Google Wallet correctness audit

Audit date: 2026-06-18. Audited against the current official specs:

- **Apple Wallet Passes / PassKit** — `developer.apple.com/documentation/walletpasses/pass` (+ field, barcode, NFC, relevantDates, semantics references) and the archived PassKit Package Format Reference for legacy rules still enforced by Wallet.
- **Google Wallet REST API v1** — `developers.google.com/wallet/reference/rest/v1/*` (class + object resources, JWT, enums).

Scope: field requirements per pass type/variant, functional correctness of the generated `pass.json` / Google class+object bodies / Save-to-Wallet JWT, and a testing strategy. Source reviewed: `packages/passlet/src/**`.

---

## How the library maps to each platform (verified)

| Passlet type | Apple style key | Google class / object |
|---|---|---|
| `loyalty`  | `storeCard`     | `loyaltyClass` / `loyaltyObject` |
| `event`    | `eventTicket`   | `eventTicketClass` / `eventTicketObject` |
| `flight`   | `boardingPass`  | `flightClass` / `flightObject` |
| `coupon`   | `coupon`        | `offerClass` / `offerObject` |
| `giftCard` | `storeCard`     | `giftCardClass` / `giftCardObject` |
| `generic`  | `generic`       | `genericClass` / `genericObject` |

Field-slot mapping (`field.*` builders, `pass.ts`):

| slot | Apple | Google |
|---|---|---|
| header | `headerFields` | `textModulesData` |
| primary | `primaryFields` | `subheader` (label) + `header` (value) |
| secondary | `secondaryFields` | `textModulesData` |
| auxiliary | `auxiliaryFields` | `textModulesData` |
| back | `backFields` | `infoModuleData.labelValueRows` |

---

## What is correct today (verified against spec)

- **Apple top-level required keys** — `formatVersion: 1`, `passTypeIdentifier`, `serialNumber`, `teamIdentifier`, `organizationName`, `description` all present (`apple/index.ts` `buildPassJson`). ✅
- **Apple colors** emitted as `rgb(r, g, b)` strings (`hexToRgb`). ✅
- **Apple barcode** `messageEncoding: "iso-8859-1"`, correct format constants (`PKBarcodeFormat*`). ✅ (but see A-7, A-9)
- **Apple manifest + PKCS#7 detached signature** with SHA-1 hashes and WWDR + signer cert (`signer.ts`). ✅
- **Google required class fields** present for loyalty (`programName`+`programLogo` enforced), offer (`provider`/`title`/`redemptionChannel`), event (`eventName`), giftCard (`issuerName`/`reviewStatus`), generic (no `reviewStatus`, correctly omitted). ✅
- **Google `redemptionChannel`** uppercased to valid enum (`INSTORE`/`ONLINE`/`BOTH`). ✅
- **Google `reviewStatus` on update** — `ensureClass` forces `UNDER_REVIEW` on PUT (except `DRAFT`). This is exactly Google's documented guidance for updating an already-approved class — **correct, not a bug.** ✅
- **Google JWT** — `aud: "google"`, `typ: "savetowallet"`, RS256, object array pluralised correctly. ✅ (but see G-6)
- **Google object base** — `id`, `classId`, `state: "ACTIVE"`. ✅

---

## Findings

Severity: **HIGH** = produces an invalid pass / API rejection / silent data loss on a real pass. **MEDIUM** = wrong or missing behaviour in a real-world variant. **LOW** = spec hygiene / hardening / dead code.

### HIGH

**H-1 — Apple flight passes silently drop all structured flight data.**
`schema.ts:376-405` documents `carrier`, `flightNumber`, `origin`, `destination`, `departure`, `arrival` as *"Apple: shown as display fields; provider maps these to the correct slots."* The Apple provider does **not** implement that mapping — `apple/index.ts` only renders `pass.fields` (`buildSlots`) plus a hard-coded `transitType`. Carrier/flight/origin/destination/departure/arrival never reach `pass.json` in any form (no fields, no `semantics`). An Apple boarding pass shows only whatever display fields the caller manually duplicated. Implementation contradicts the documented contract and loses data. → Either implement the mapping (ideally into `semantics`, see H-4) or fix the schema comments.

**H-2 — Apple event passes ignore `startsAt`/`endsAt`.**
`schema.ts:355-364` says `startsAt` is the *"Apple: relevant date for lock screen suggestion."* The Apple provider never reads `startsAt`/`endsAt` (`buildEventAppleFields` + `buildAppleCommonFields` only use `apple.relevantDates`). The event time reaches Google (`eventTicketClass.dateTime`) but never Apple. Apple event tickets get no lock-screen relevance unless the caller *also* hand-sets `apple.relevantDates`. Doc/impl mismatch.

**H-3 — Google `giftCardObject` is missing the required `cardNumber`.**
`google/index.ts:301-316` `buildGiftCardObjectFields` emits only `balance`. Google's `giftCardObject` requires `cardNumber` (`id`/`classId`/`state`/`cardNumber`). There is also no schema field to carry it. As written, every gift-card object creation should be rejected by the Wallet API. → Add a `cardNumber` source (e.g. a well-known field key or a top-level prop) and emit it. *(Confirm against the live API — this is the single most likely hard rejection.)*

**H-4 — Google `genericObject` can omit the required `header`.**
`genericObject` requires both `cardTitle` and `header`. `buildObjectBody` sets `cardTitle` for generic, but `header` only comes from `buildDisplayFields` *if a `primary` field exists* (`google/index.ts:325-353`). A generic pass with no `primary` field produces an object with no `header` → API rejection. → Fall back `header` to `pass.name` (or require a primary field for generic).

**H-5 — Google flight `departure` (localScheduledDepartureDateTime) is required but never validated.**
`flightClass` requires `localScheduledDepartureDateTime`. `validateGoogleRequirements` (`google/index.ts:77-85`) checks `carrier/flightNumber/origin/destination` but **not** `departure`; the schema makes it optional. A flight pass without `departure` passes library validation, then fails at the Google API. Note the error message `GOOGLE_FLIGHT_MISSING_CLASS_FIELDS` already *claims* to require it — the check just doesn't. → Add `departure` to the required check.

### MEDIUM

**M-1 — Date/time time-zone semantics are wrong/ambiguous (the `.replace("Z", "")` trick).**
`buildClassTypeFields` strips the trailing `Z` from event `dateTime` and flight `localScheduledDepartureDateTime` (`google/index.ts:155,169,174`). The Zod `z.iso.datetime()` schema accepts only UTC (`Z`) input, so a caller who supplies a genuine UTC instant gets it **relabelled as venue/airport local time** (8:00 UTC → "8:00 local"), shifting the displayed time by the offset. Google's rules differ by type: flight times must have **no** offset (Google rejects offsets, derives tz from the airport); event times *may* carry an offset and Google warns that omitting it disables some rich features. `.replace("Z","")` also wouldn't strip a numeric offset if the schema were ever relaxed. → Decide the contract explicitly: accept offset-bearing local datetimes for events, strip-and-document "local airport time" for flights, and convert rather than relabel.

**M-2 — No Apple `semantics` support anywhere.**
`semantics` / semantic tags are how Apple Wallet unlocks live features (flight tracking, gate/seat, event venue/performer, Siri & lock-screen suggestions). The library emits none. Combined with H-1/H-2, Apple flight and event passes are functionally "dumb" cards. Not required for install, but the main reason to use boarding-pass / event-ticket styles. → Add an optional `semantics` passthrough and/or auto-derive from the structured flight/event props.

**M-3 — `authenticationToken` not enforced with `webServiceURL`.**
Apple requires `authenticationToken` (≥16 chars) whenever `webServiceURL` is set. `apple/index.ts:225` only *includes* the token if the URL is present, but nothing errors when the URL is present and the token is missing → a pass with a web service URL and no usable update auth. → Cross-field validation in the schema.

**M-4 — NFC `encryptionPublicKey` is optional but Apple requires it.**
`schema.ts:142` marks `nfc.encryptionPublicKey` optional. Apple's NFC dictionary requires both `message` (≤64 bytes) and `encryptionPublicKey` (Base64 X.509 ECDH P-256) for NFC to function. There's also no 64-byte cap on `message`. → Make `encryptionPublicKey` required when `nfc` is present; bound `message`.

**M-5 — `relevantDates` shape is incomplete.**
`relevantDateSchema` (`schema.ts:103-112`) supports only `startDate` (required) + optional `endDate`. Apple's RelevantDates entry is either a single `date` **or** `startDate`+`endDate`, and **`endDate` is required when `startDate` is given.** So the single-moment form is unavailable and the interval form can emit an unpaired `startDate`. → Model as a union; require `endDate` with `startDate`.

**M-6 — Google event seat/gate/section/row not mapped to structured fields; venue absent.**
`eventTicketObject.seatInfo` (`seat`/`row`/`section`/`gate`) and `eventTicketClass.venue` (`name`+`address`) are first-class Google UI slots. The library routes these through `textModulesData`/`subheader` instead (the `EventFieldKey` type even advertises `seat`/`row`/`section`/`gate`). They render, but not in the native ticket layout. → Map well-known event keys to `seatInfo`; add a venue source.

**M-7 — `messages.messageType` enum is wrong/passed through unmapped.**
`googleMessageSchema` allows `"expireNotification"` and passes `messages` straight into the class/object body (`google/index.ts:250-252`, `397`). Google's enum is `TEXT` / `TEXT_AND_NOTIFY` / `EXPIRATION_NOTIFICATION` — `"expireNotification"` is not a valid value, and `EXPIRATION_NOTIFICATION` is itself documented as unsupported. A caller selecting it gets an API error. → Drop/rename to the valid enum; map casing.

**M-8 — Save-to-Wallet JWT has no `origins`.**
The web "Add to Google Wallet" button requires an `origins` array (approved domains) to render; the JWT payload (`google/index.ts:457-465`) omits it and there's no way to supply it. Direct save links may still work, but the embeddable button won't. → Add an optional `origins` credential/config and include it.

**M-9 — `logoText` is force-defaulted and wrong for poster event tickets.**
`apple/index.ts:246` sets `logoText: a?.logoText ?? pass.name` for **every** pass, so every pass gets logo text even when the caller wants none (e.g. logo image only). Apple also documents that `logoText` *does not work* on poster event tickets (use `eventLogoText`); the library still emits it. → Don't default `logoText` to the pass name; omit it for poster event tickets (when `preferredStyleSchemes`/`eventLogoText` indicate the poster layout).

### LOW

- **L-1** `barcodes` array only — Apple recommends also emitting the deprecated singular `barcode` for iOS 8/watchOS fallback. (`apple/index.ts:191`)
- **L-2** `changeMessage` not validated to contain the required `%@` placeholder; without it Wallet won't show the change. (`schema.ts:69`)
- **L-3** When `dateStyle`/`timeStyle` is set, Apple needs the field `value` to be an ISO-8601 datetime *with time zone*; when `numberStyle` is set, `value` must be a raw number. The library passes free-form strings unchecked. (`schema.ts:70-73`)
- **L-4** `row` is only valid on `eventTicket` `auxiliaryFields` (values 0/1); schema allows it on any slot/type. Apple ignores the invalid cases. (`schema.ts:75`)
- **L-5** `textAlignment` is invalid on `primaryFields` and `backFields`; passed through regardless. (`apple/index.ts:106`)
- **L-6** Apple event tickets: `strip` is mutually exclusive with `background`/`thumbnail`; no guard/warning. (`apple/index.ts:269-275`)
- **L-7** `icon@2x` is effectively required for Retina; only base `icon` is enforced. Consider a warning when no `@2x` is supplied. (`apple/index.ts:261-266`)
- **L-8** `appLaunchURL` requires `associatedStoreIdentifiers`; documented in a comment but not validated. (`schema.ts:146-148`)
- **L-9** Barcode `messageEncoding` is hard-coded `iso-8859-1`; QR payloads carrying non-Latin-1/UTF-8 data will be mangled. Consider `utf-8` for QR/Aztec. (`apple/index.ts:197`)
- **L-10** Dead code / drift: `transitType ?? "air"` in `buildPassTypeContent` is unreachable (validation throws first); `GOOGLE_FLIGHT_MISSING_PASSENGER_NAME` and `APPLE_UNSUPPORTED_BARCODE_FORMAT` error codes are defined but never thrown (flight passenger name only warns; barcode format is constrained by the Zod enum). Decide enforce-vs-warn and remove the unused branch.
- **L-11** Google `flightObject.passengerName` falls back to `""` (empty string) with a warning; an empty required string may be rejected by the API. (`google/index.ts:289-296`)

---

## Required-field matrix (use as the test oracle)

### Apple `pass.json`
- **Always required:** `formatVersion`, `passTypeIdentifier`, `serialNumber`, `teamIdentifier`, `organizationName`, `description`, exactly one style key, `icon.png` in bundle.
- **boardingPass:** `transitType` (one of `PKTransitType{Air,Train,Bus,Boat,Generic}`).
- **Each field:** `key`, `value` required.
- **Each barcode:** `format`, `message`, `messageEncoding` required.

### Google class (create)
| type | required class fields |
|---|---|
| loyalty | `id`, `issuerName`, `reviewStatus`, `programName`, `programLogo` |
| offer | `id`, `issuerName`, `reviewStatus`, `provider`, `title`, `redemptionChannel` |
| giftCard | `id`, `issuerName`, `reviewStatus` |
| eventTicket | `id`, `issuerName`, `reviewStatus`, `eventName` |
| flight | `id`, `issuerName`, `reviewStatus`, `flightHeader`, `origin`, `destination`, `localScheduledDepartureDateTime` |
| generic | `id` only (no `reviewStatus`) |

### Google object (create)
| type | required object fields |
|---|---|
| loyalty / offer / eventTicket | `id`, `classId`, `state` |
| giftCard | `id`, `classId`, `state`, **`cardNumber`** |
| flight | `id`, `classId`, `state`, **`passengerName`**, **`reservationInfo`** |
| generic | `id`, `classId`, **`cardTitle`**, **`header`** (`state` optional) |

---

## Testing strategy

The current `*.test.ts` suite covers builders, locales, and signing; `scripts/smoke.ts` exercises every type against live credentials but only asserts "didn't throw." Recommended layers:

**1. Make the body builders pure and exported (prerequisite).**
`buildClassBody`/`buildObjectBody` (Google) and `buildPassJson` (Apple) are internal and, for Google, entangled with network I/O (`ensureClass`). Export the pure builders so they can be snapshot-tested without signing or HTTP. This is the highest-leverage change for testability.

**2. Required-field contract tests (catches H-3/H-4/H-5).**
Encode the matrix above as a data-driven test: for every type/variant, build the body and assert each required key is present and non-empty. This is the regression net for spec drift.

**3. Golden snapshot tests per type × variant.**
Snapshot the full `pass.json`, Google class body, and Google object body for each type (and flight transit variants, coupon channels, loyalty/giftCard structured fields, locales). Diffs surface unintended changes.

**4. Apple `.pkpass` structural validation (offline, CI-safe).**
Unzip the generated archive and assert: `pass.json` parses; `manifest.json` SHA-1 matches every file byte-for-byte; the `signature` is a valid PKCS#7 *detached* signature over `manifest.json` and chains to the WWDR + signer cert (verify with `node-forge`); `icon.png` present. This validates exactly what Apple's installer checks, with no device.

**5. Google JWT verification.**
Decode the Save JWT with `jose` using the service-account public key; assert header `alg: RS256`, claims `aud/typ/iss/iat`, and `payload.{type}Objects[0]` shape. Add a check for `origins` once M-8 lands.

**6. Schema unit tests for the new validations** (M-3, M-4, M-5, L-2): negative cases that must throw `PASS_CONFIG_INVALID`.

**7. Live integration (network, nightly / opt-in).**
- **Google** has a real REST API and no separate sandbox. Use a dedicated **test issuer ID**; have CI `create` then `GET` the class/object back and assert the server echoes the required fields (this would have caught H-3). `scripts/smoke.ts` is the seed — extend it from "didn't throw" to "GET confirms fields," and decode the JWT. Open the save link manually / preview in the Google Pay & Wallet Console.
- **Apple** has no validation API. For rendering, drag the `.pkpass` into the iOS Simulator (opens in Wallet) or email it to a device; there's no automated device check, so rely on layer 4 for CI and keep a manual device checklist (flight/event/poster variants especially, given H-1/H-2/M-2).

**8. Cross-platform consistency tests.**
Assert that a single `PassConfig` yields equivalent semantic content on both platforms (e.g. event time present on Apple *and* Google) — directly targets the H-1/H-2 doc/impl gaps.

Suggested CI gate: layers 1–6 on every PR; layer 7 (Google live) nightly against the test issuer; layer 4 as the Apple correctness proxy.
