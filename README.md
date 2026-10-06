<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/oscartrevio/passlet/main/.github/assets/header-dark.svg">
  <img src="https://raw.githubusercontent.com/oscartrevio/passlet/main/.github/assets/header.svg" alt="Passlet" width="100%">
</picture>

Apple Wallet and Google Wallet passes from one TypeScript API.
Issue, update and bundle passes with zero runtime dependencies.

[![npm](https://img.shields.io/npm/v/passlet)](https://www.npmjs.com/package/passlet)
[![CI](https://github.com/oscartrevio/passlet/actions/workflows/ci.yml/badge.svg)](https://github.com/oscartrevio/passlet/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue.svg)](https://www.typescriptlang.org/)

**[Live playground →](https://passlet.oscartrev.io)**

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

- One template for both wallets: fields, barcodes, images, colors, dates, locations and translations mapped for you
- Live updates: `wallet.update(serial)` patches Google and pushes Apple devices through a built-in web service, with lock-screen notifications
- Bundles: `wallet.createBundle()` issues up to 10 passes as one `.pkpasses` file and one Google save link
- Per-pass Apple tokens, external signers (AWS KMS, Google Cloud KMS, HSM), and errors with a stable `code`, `why` and `fix`
- Zero runtime dependencies: 0.5 MB installed, loads in ~35 ms; ESM + CJS; strict types

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
