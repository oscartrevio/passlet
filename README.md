<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/oscartrevio/passlet/main/.github/assets/header-dark.svg">
  <img src="https://raw.githubusercontent.com/oscartrevio/passlet/main/.github/assets/header.svg" alt="Passlet" width="100%">
</picture>

**[Passlet](https://github.com/oscartrevio/passlet)** is a library for generating Apple Wallet and Google Wallet passes from a single TypeScript API.

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
// apple → Uint8Array (.pkpass file, serve with Content-Type: application/vnd.apple.pkpass)
// google → JWT string (save link: https://pay.google.com/gp/v/save/<jwt>)
```

Omit `apple` or `google` from the credentials to skip that provider.

## Pass types

```ts
wallet.loyalty(config);
wallet.event(config);
wallet.flight(config);
wallet.coupon(config);
wallet.giftCard(config);
wallet.generic(config);
```

## Credentials

**Apple** — requires an Apple Developer account with a Pass Type ID. [Create one in the Developer portal](https://developer.apple.com/account/resources/identifiers/list/passTypeId), then download your signing certificate and convert it to PEM.

**Google** — requires a Google Wallet issuer account. [Set one up in the Pay & Wallet Console](https://pay.google.com/business/console), create a service account, and download the JSON key.

## License

MIT
