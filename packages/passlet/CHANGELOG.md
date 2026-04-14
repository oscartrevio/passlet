# passlet

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
