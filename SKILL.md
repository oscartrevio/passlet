---
name: passlet
description: Generate Apple Wallet and Google Wallet passes with the passlet library. Use when issuing loyalty cards, event tickets, boarding passes, coupons, gift cards, or generic passes.
license: MIT
metadata:
  author: oscartrevio
---

## Setup

Install `passlet` and follow the [README](https://github.com/oscartrevio/passlet#credentials) for credentials. Generate passes on the server; never expose private keys in client code. Reuse a configured `Wallet` and its templates across requests.

Configure `apple`, `google`, or both. Apple needs a Pass Type ID certificate, its unencrypted PEM private key (or an external signer), the WWDR PEM certificate, and matching pass/team identifiers. Google needs an issuer ID and the `client_email` / `private_key` from a service-account JSON key. Grant that email Developer access in the Wallet issuer account.

## Define and issue

Use `wallet.loyalty`, `wallet.eventTicket`, `wallet.boardingPass`, `wallet.coupon`, `wallet.giftCard`, or `wallet.generic`. Templates hold shared configuration; `create()` supplies recipient data.

```ts
import { readFile } from "node:fs/promises";
import { field } from "passlet";

const pass = wallet.eventTicket({
  id: "summer-fest",
  name: "Summer Fest",
  color: "#1c1917",
  apple: {
    icon: {
      base: await readFile("./assets/icon.png"),
      retina: await readFile("./assets/icon@2x.png"),
    },
  },
  fields: [
    field.primary("event", "Event", "Summer Fest"),
    field.secondary("seat", "Seat"),
    field.back("terms", "Terms", "No refunds."),
  ],
});

const { apple, google } = await pass.create({
  serialNumber: "ticket-2444",
  values: { seat: "A12" },
  barcode: { format: "QR", value: "TICKET-2444" },
});
```

- Keep the template `id` stable and each recipient/ticket's `serialNumber` unique.
- Field builders are `header`, `primary`, `secondary`, `auxiliary`, and `back`. Their third argument is a default value or formatting options.
- `values` override defaults; an omitted key keeps its default, and `null` hides the field.
- Use `color` for the shared six-digit hex background. Apple-specific colors and images belong under `apple`; Google images belong under `google`.
- Apple accepts image bytes or URLs and requires `apple.icon`. Google accepts hosted URLs, not image uploads; loyalty and transit passes require `google.logo`.
- Barcode formats are case-sensitive: `QR`, `PDF417`, `Aztec`, `Code128`, `Code39`, `Codabar`, `EAN13`, `ITF`. Use the exported types rather than inventing fallbacks.
- Air flights need carrier, flight number, airports, departure time, and `values.passengerName` for Google. Boarding passes need `transitType` for Apple; ground transport opts into `google.transit`.

## Deliver and maintain

`apple` is a `Uint8Array`; serve the bytes with `APPLE_PASS_CONTENT_TYPE` and a `.pkpass` filename. `google` is a JWT; use `googleSaveUrl(google)` for a redirect or save button. Unconfigured providers return `null`, so check outputs before using them.

Use HTTPS and `Cache-Control: no-store, private`. Authenticate recipients before issuing their passes; signed files and save URLs contain recipient data. Any named image that fails to load rejects `create()`; there are no warnings.

To issue several passes in one download (family tickets, multi-leg trips), call `wallet.createBundle([{ template, content }, ...])` with 1 to 10 items and unique serial numbers. `apple` is always a `.pkpasses` bundle; serve it with `APPLE_PASSES_CONTENT_TYPE` and a `.pkpasses` filename. `google` is one JWT covering every pass. Set `content.group` to group related passes. Bundle limit violations throw `PASS_BUNDLE_INVALID`.

Google `create()` creates a missing shared class but does not overwrite an existing class. After changing the template, call `await pass.publish()` from setup or deployment code, not on each download. Publication affects all passes sharing that class and requires Google credentials.

To update issued passes, keep content in your database and give `new Wallet()` a `load(serialNumber)` that returns `{ template, content: { values, ... }, updatedAt }` or `null`; build `content` with the same function you use for `create()`. Bump `updatedAt` on every change, save first, then call `await wallet.update(serialNumber, { notify: true })`. Google objects are patched (created if missing); `notify` only alerts for Google's allowlisted fields (loyalty `points`, event `seat`/`row`/`section`/`gate`), at most 3 per pass per day. For Apple, set `apple.webService: { url, secret, registrations }` (one secret of 32+ chars from `openssl rand -base64 32`, kept in your secret manager and never changed, since every issued pass's token derives from it; `push: { cert, key }` is required with an external signer). Implement `registrations` (`add`, `devices`, `remove`, `serialNumbers`) on a real database, never an in-memory map on serverless. Mount `wallet.handler` at `url` (Next.js: `app/api/.../[...path]/route.ts` exporting `GET`/`POST`/`DELETE` with `runtime = "nodejs"`; Express: `app.use(prefix, toNodeListener(wallet.handler))` before body parsers). Apple alerts only for fields with a `changeMessage` containing `%@`. With Google configured, serial numbers may contain only `A-Z a-z 0-9 . _ -`; prefer `crypto.randomUUID()`. `pass.expire(serialNumber)` acts on Google only (Google's API cannot delete passes); void an Apple pass by returning `apple: { voided: true }` from `load` and calling `wallet.update()`.

## Failures

Catch `WalletError` around template construction and asynchronous operations. Its contract is `code`, `status`, `message`, `why`, and `fix`. Branch on `code`, never message text. `status` is the upstream HTTP rejection status or the catalog default; do not blindly forward provider credentials errors to clients.

Schema failures include `issues` with field paths and reasons. Google HTTP failures may include `retryAfter` in seconds. There are no automatic retries. Keep the underlying `cause`, keys, pass files, and JWTs out of public logs and responses.

Use the [README error catalog](https://github.com/oscartrevio/passlet#handle-failures) and [runnable server examples](https://github.com/oscartrevio/passlet/tree/main/examples) rather than maintaining a second credential or HTTP integration recipe.
