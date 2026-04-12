# passlet

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
