<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/oscartrevio/passlet/main/.github/assets/header-dark.svg">
  <img src="https://raw.githubusercontent.com/oscartrevio/passlet/main/.github/assets/header.svg" alt="Passlet" width="100%">
</picture>

**Apple Wallet and Google Wallet passes from one TypeScript API.**

[![npm](https://img.shields.io/npm/v/passlet)](https://www.npmjs.com/package/passlet)
[![CI](https://github.com/oscartrevio/passlet/actions/workflows/ci.yml/badge.svg)](https://github.com/oscartrevio/passlet/actions/workflows/ci.yml)
[![License](https://img.shields.io/npm/l/passlet)](LICENSE)

**[Try the playground →](https://passlet.oscartrev.io)**

## What is this?

Apple and Google both let you put a card in someone's phone wallet: a loyalty card, a ticket, a boarding pass. They just disagree on everything else. Apple wants a signed zip file. Google wants a JWT and a REST API. The field names, layouts and rules are different.

Passlet lets you describe a pass once. You get a signed `.pkpass` file for Apple and a save link for Google from the same call.

## Install

```sh
npm install passlet
```

Passlet runs on the server (Node.js 20.15+). Your signing keys must never reach the browser.

## Quick start

```ts
import { field, googleSaveUrl, Wallet } from "passlet";

const wallet = new Wallet({
  apple: {
    passTypeIdentifier: process.env.APPLE_PASS_TYPE_ID,
    teamId: process.env.APPLE_TEAM_ID,
    signerCert: process.env.APPLE_SIGNER_CERT,
    signerKey: process.env.APPLE_SIGNER_KEY,
    wwdr: process.env.APPLE_WWDR,
  },
  google: {
    issuerId: process.env.GOOGLE_ISSUER_ID,
    clientEmail: process.env.GOOGLE_CLIENT_EMAIL,
    privateKey: process.env.GOOGLE_PRIVATE_KEY,
  },
});

const rewards = wallet.loyalty({
  id: "rewards",
  name: "Coffee Club",
  color: "#3c2415",
  apple: { icon: "https://example.com/icon.png" },
  google: { logo: "https://example.com/logo.png" },
  fields: [
    field.primary("points", "Points"),
    field.secondary("tier", "Tier", "Member"),
  ],
});

const { apple, google } = await rewards.create({
  serialNumber: "member-123",
  values: { points: "1250" },
  barcode: { format: "QR", value: "member-123" },
});

// apple: the .pkpass bytes. Send them with APPLE_PASS_CONTENT_TYPE.
// google: a JWT. Redirect to googleSaveUrl(google).
```

Only using one wallet? Leave out the other provider's credentials and options. Getting the credentials takes a few steps on each side: see [Credentials](https://github.com/oscartrevio/passlet/wiki/Credentials).

## Pass types

| Method | For | Apple style | Google type |
| --- | --- | --- | --- |
| `wallet.loyalty()` | Rewards and memberships | Store card | Loyalty |
| `wallet.eventTicket()` | Tickets | Event ticket | Event ticket |
| `wallet.boardingPass()` | Flights, trains, buses, boats | Boarding pass | Flight or transit |
| `wallet.coupon()` | Offers and discounts | Coupon | Offer |
| `wallet.giftCard()` | Prepaid balances | Store card | Gift card |
| `wallet.generic()` | Anything else | Generic | Generic |

## Features

- **One template, both wallets.** Fields, barcodes, images, colors, dates and locations are mapped to each platform's format for you.
- **Typed end to end.** Each pass type only accepts its own options, and mistakes throw before anything is signed.
- **Passes stay current.** Change your data and call `wallet.update(serial)`: Google passes are updated in place and Apple devices download the new pass from a built-in web service, with notifications on both wallets.
- **Several passes at once.** `wallet.createBundle()` issues up to 10 passes as one Apple `.pkpasses` bundle and one Google save link, for family tickets and multi-leg trips.
- **Keys can stay in your KMS.** Apple passes can be signed by AWS KMS, Google Cloud KMS or an HSM through an external signer.
- **Localized.** One `locales` map becomes Apple `.lproj` strings and Google translations.
- **Errors you can act on.** Every `WalletError` has a stable `code` plus `why` and `fix`.
- **One small dependency.** Signing and packaging use Node's built-in `crypto` and `zlib`. The only dependency is `zod`.

## Documentation

The [wiki](https://github.com/oscartrevio/passlet/wiki) covers everything past the quick start:

- [Getting Started](https://github.com/oscartrevio/passlet/wiki/Getting-Started) and [Credentials](https://github.com/oscartrevio/passlet/wiki/Credentials)
- [Pass Types](https://github.com/oscartrevio/passlet/wiki/Pass-Types), [Fields and Layout](https://github.com/oscartrevio/passlet/wiki/Fields-and-Layout), [Images, Barcodes and Localization](https://github.com/oscartrevio/passlet/wiki/Images-Barcodes-and-Localization)
- [Serving Passes](https://github.com/oscartrevio/passlet/wiki/Serving-Passes), [Several Passes at Once](https://github.com/oscartrevio/passlet/wiki/Multiple-Passes) and [Updating Passes](https://github.com/oscartrevio/passlet/wiki/Updating-Passes)
- [Deploying](https://github.com/oscartrevio/passlet/wiki/Deploying) and [External Signers](https://github.com/oscartrevio/passlet/wiki/External-Signers)
- [Errors](https://github.com/oscartrevio/passlet/wiki/Errors) and [FAQ](https://github.com/oscartrevio/passlet/wiki/FAQ)

Runnable servers for Express, Hono and Next.js are in [examples](examples/README.md). Agents can read [llms.txt](https://passlet.oscartrev.io/llms.txt) or install the [skill](https://passlet.oscartrev.io/skill.md).

Upgrading from v2? Follow the [3.0.0 release notes](https://github.com/oscartrevio/passlet/releases/tag/passlet%403.0.0).

## Contributing

Issues and pull requests are welcome. [CONTRIBUTING.md](CONTRIBUTING.md) covers setup, tests and releases. Report security issues privately as described in [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)
