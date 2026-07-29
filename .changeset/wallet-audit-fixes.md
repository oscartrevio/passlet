---
"passlet": minor
---

Vendor-documentation audit: fixes, new Wallet features, and golden-file contract tests.

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
