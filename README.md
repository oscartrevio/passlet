<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/oscartrevio/passlet/main/.github/assets/header-dark.svg">
  <img src="https://raw.githubusercontent.com/oscartrevio/passlet/main/.github/assets/header.svg" alt="Passlet" width="100%">
</picture>

<p align="center">
  <a href="https://www.npmjs.com/package/passlet"><img src="https://img.shields.io/npm/v/passlet?style=flat-square" alt="npm"></a>
  <a href="https://www.npmjs.com/package/passlet"><img src="https://img.shields.io/npm/dt/passlet?style=flat-square" alt="dt"></a>
  <a href="https://img.shields.io/npm/l/passlet"><img src="https://img.shields.io/npm/l/passlet?style=flat-square" alt="license"></a>
</p>

**[Passlet](https://github.com/oscartrevio/passlet)** is a library for generating Apple Wallet and Google Wallet passes from a single API.

## The problem

Creating wallet passes is painful.

Apple Wallet and Google Wallet have nothing in common.
Apple uses .pkpass files — a signed ZIP bundle with a JSON manifest, PKCS#7 certificates, and SHA hashes for every asset. Google uses a REST API with service accounts, JWTs, and a completely different data model. Different field names. Different auth flows. Different everything.

If your app supports both, you're building two separate systems.

Passlet fixes that. One API that handles the signing, formatting, and platform translation for you — whether you need one wallet or both.

> [!WARNING]
> **Early release** — API may change between minor versions.

## Install

```bash
npm install passlet
```

## Quickstart

```ts
import { Wallet, field } from "passlet";

const wallet = new Wallet({
  apple: {
    passTypeIdentifier: process.env.APPLE_PASS_TYPE_ID!,
    teamId: process.env.APPLE_TEAM_ID!,
    signerCert: process.env.APPLE_SIGNER_CERT!,
    signerKey: process.env.APPLE_SIGNER_KEY!,
    wwdr: process.env.APPLE_WWDR!,
  },
  google: {
    issuerId: process.env.GOOGLE_ISSUER_ID!,
    clientEmail: process.env.GOOGLE_CLIENT_EMAIL!,
    privateKey: process.env.GOOGLE_PRIVATE_KEY!,
  },
});

const pass = wallet.loyalty({
  id: "my-rewards",
  name: "Rewards Card",
  fields: [
    field.primary("points", "Points", "1250"),
    field.secondary("tier", "Tier", "Gold"),
  ],
});

const { apple, google } = await pass.create({ serialNumber: "user-123" });
```

`apple` is a `Uint8Array` — the `.pkpass` file, ready to serve with `Content-Type: application/vnd.apple.pkpass`.

`google` is a JWT string — build the save link as `https://pay.google.com/gp/v/save/{jwt}`.

Only need one platform? Omit `apple` or `google` from the wallet config and Passlet skips it.

## Pass types

```ts
wallet.loyalty(config); // Rewards cards, memberships, point systems
wallet.event(config); // Concerts, conferences, sports, any ticketed event
wallet.flight(config); // Boarding passes with gate, seat, departure info
wallet.coupon(config); // Discounts, promos, limited-time offers
wallet.giftCard(config); // Prepaid cards with balance tracking
wallet.generic(config); // Anything else — credentials, IDs, parking, keys
```

Every type maps automatically to the correct Apple pass style and Google Wallet class. You don't touch platform-specific schemas.

## Fields

Fields define what shows on the pass. Passlet handles the translation to each platform's layout model.

```ts
import { field } from "passlet";

const pass = wallet.event({
  id: "summer-fest",
  name: "Summer Fest",
  fields: [
    field.primary("event", "Event", "Summer Fest"),
    field.secondary("date", "Date", "Aug 29, 2026"),
    field.secondary("location", "Location", "Monterrey, MX"),
    field.auxiliary("door", "Doors Open", "6:00 PM"),
    field.auxiliary("seat", "Seat", "GA"),
  ],
  barcode: {
    format: "QR",
    value: "TICKET-2444",
    altText: "TICKET-2444",
  },
});
```

Field groups (`primary`, `secondary`, `auxiliary`, `back`) map to Apple's layout zones and Google's equivalent row structure. Primary fields render large and prominent. Secondary and auxiliary fill the detail rows. Back fields go on the reverse side (Apple) or expandable section (Google).

## Barcodes

```ts
barcode: {
  format: "QR",        // "QR" | "PDF417" | "AZTEC" | "CODE128"
  value: "ABC-12345",
  altText: "ABC-12345", // Text shown below the barcode
}
```

Passlet normalizes barcode formats across platforms. If a format isn't supported on one platform, it falls back to the closest equivalent.

## Visual customization

```ts
wallet.loyalty({
  id: "my-card",
  name: "My Card",
  backgroundColor: "#1c1917",
  foregroundColor: "#fafaf9",
  labelColor: "#a8a29e",
  icon: readFileSync("./assets/icon.png"),
  logo: readFileSync("./assets/logo.png"),
  fields: [
    /* ... */
  ],
});
```

Colors accept any hex value. Images accept `Uint8Array` or `Buffer`. Passlet handles the asset bundling for Apple and image hosting references for Google.

## Credentials

### Apple

Requires an Apple Developer account with a Pass Type ID.

1. [Create a Pass Type ID](https://developer.apple.com/account/resources/identifiers/list/passTypeId) in the Apple Developer portal
2. Create and download the signing certificate
3. Export as `.p12`, convert to PEM:

```bash
openssl pkcs12 -in certificate.p12 -clcerts -nokeys -out signerCert.pem
openssl pkcs12 -in certificate.p12 -nocerts -out signerKey.pem
```

4. Download the [Apple WWDR certificate](https://www.apple.com/certificateauthority/) (G4)

### Google

Requires a Google Wallet issuer account.

1. [Sign up for the Google Pay & Wallet Console](https://pay.google.com/business/console)
2. Create a service account with the Google Wallet API enabled
3. Download the JSON key — use `client_email` and `private_key` from the file

## Roadmap

- [ ] Pass updates and push notifications (APNs + Google API)
- [ ] CLI for quick pass generation
- [X] Pass playground

## Contributing

PRs welcome. If you've dealt with wallet pass APIs before, you know why this needs to exist.

## License

MIT
