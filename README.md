<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/oscartrevio/passlet/main/.github/assets/header-dark.svg">
  <img src="https://raw.githubusercontent.com/oscartrevio/passlet/main/.github/assets/header.svg" alt="Passlet" width="100%">
</picture>

<h3>Apple Wallet and Google Wallet passes from one TypeScript API</h3>

<p>Issue, update and bundle passes with zero runtime dependencies.</p>

<p>
  <a href="https://www.npmjs.com/package/passlet"><img src="https://img.shields.io/npm/v/passlet?style=flat-square&color=000" alt="npm"></a>
  <a href="https://github.com/oscartrevio/passlet/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/oscartrevio/passlet/ci.yml?branch=main&style=flat-square&label=CI" alt="CI"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-000?style=flat-square" alt="License: MIT"></a>
  <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-strict-000?style=flat-square" alt="TypeScript: strict"></a>
</p>

<p>
  <a href="https://passlet.oscartrev.io"><b>Playground</b></a>
  &nbsp;·&nbsp;
  <a href="https://github.com/oscartrevio/passlet/wiki/Getting-Started">Docs</a>
  &nbsp;·&nbsp;
  <a href="examples/README.md">Examples</a>
  &nbsp;·&nbsp;
  <a href="packages/passlet/CHANGELOG.md">Changelog</a>
</p>

</div>

## What is this?

Apple and Google both put cards in a phone's wallet: loyalty cards, tickets, boarding passes. They agree on nothing else. Apple wants a signed `.pkpass` archive; Google wants a JWT backed by a REST API, with different field names, layouts and rules.

Passlet lets you describe a pass once. One call returns a signed `.pkpass` for Apple and a save link for Google, and one more keeps both up to date on the holder's phone.

## Quick start

```sh
npm install passlet
```

```ts
import { field, Wallet } from "passlet";

const wallet = new Wallet({ apple: appleCredentials, google: googleCredentials });

const rewards = wallet.loyalty({
  id: "rewards",
  name: "Coffee Club",
  apple: { icon: "https://example.com/icon.png" },
  google: { logo: "https://example.com/logo.png" },
  fields: [field.primary("points", "Points")],
});

const pass = await rewards.create({ serialNumber: "member-123", values: { points: "1250" } });
// pass.apple → .pkpass bytes · pass.google → JWT for googleSaveUrl()
```

Runs on the server, Node.js 20.15+. Leave out either wallet to use just one. Getting credentials: [Credentials](https://github.com/oscartrevio/passlet/wiki/Credentials).

## Pass types

| Method | For | Apple | Google |
|---|---|---|---|
| `loyalty()` | Rewards and memberships | Store card | Loyalty |
| `eventTicket()` | Concerts, matches, conferences | Event ticket | Event ticket |
| `boardingPass()` | Flights, trains, buses, ferries | Boarding pass | Flight or transit |
| `coupon()` | Offers and discounts | Coupon | Offer |
| `giftCard()` | Prepaid balances | Store card | Gift card |
| `generic()` | Anything else | Generic | Generic |

## Features

- Apple and Google from one definition: a signed `.pkpass` and a Google save link from the same call
- Fields on the front and back, with date, number and currency formatting
- Barcodes: QR, PDF417, Aztec, Code 128 and more, plus rotating codes on Google
- Images from URLs or bytes: icons, logos, strips, thumbnails and Google hero images
- Translations for every field, in both wallets
- Lock-screen relevance by date and location, and NFC (Apple NFC passes, Google Smart Tap)
- Updates after issue, with a notification on the holder's phone when a value changes
- Several passes in one download, like a family's tickets or every leg of a trip

## Documentation

- [Getting started](https://github.com/oscartrevio/passlet/wiki/Getting-Started): first pass for both wallets
- [Credentials](https://github.com/oscartrevio/passlet/wiki/Credentials): Apple certificates and Google service accounts
- [Pass types](https://github.com/oscartrevio/passlet/wiki/Pass-Types): what each type supports on each wallet
- [Fields and layout](https://github.com/oscartrevio/passlet/wiki/Fields-and-Layout): slots, formatting, change messages
- [Images, barcodes and localization](https://github.com/oscartrevio/passlet/wiki/Images-Barcodes-and-Localization)
- [Serving passes](https://github.com/oscartrevio/passlet/wiki/Serving-Passes): headers, save links, caching
- [Several passes at once](https://github.com/oscartrevio/passlet/wiki/Multiple-Passes): bundles and grouping
- [Updating passes](https://github.com/oscartrevio/passlet/wiki/Updating-Passes): `load`, the web service, notifications
- [Deploying](https://github.com/oscartrevio/passlet/wiki/Deploying) and [External signers](https://github.com/oscartrevio/passlet/wiki/External-Signers)
- [Errors](https://github.com/oscartrevio/passlet/wiki/Errors) and [FAQ](https://github.com/oscartrevio/passlet/wiki/FAQ)
- [Examples](examples/README.md): Express, Hono and Next.js servers
- [Upgrading from v2](https://github.com/oscartrevio/passlet/releases/tag/passlet%403.0.0)
- For agents: [llms.txt](https://passlet.oscartrev.io/llms.txt) and the [skill](https://passlet.oscartrev.io/skill.md)

## Contributing

Issues and PRs welcome. Setup, tests and releases are in [CONTRIBUTING.md](CONTRIBUTING.md); report security issues as described in [SECURITY.md](SECURITY.md).

## License

[MIT](./LICENSE)

---

<div align="center">

Built by [Oscar Treviño](https://www.oscartrev.io)

[X](https://twitter.com/oscartrevio_) | [GitHub](https://github.com/oscartrevio)

</div>
