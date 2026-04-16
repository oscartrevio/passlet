---
name: passlet
description: Generate Apple Wallet and Google Wallet passes using the passlet library. Use when building apps that need to issue loyalty cards, event tickets, boarding passes, coupons, gift cards, or generic passes for one or both wallet platforms from a single unified API.
license: MIT
metadata:
  author: oscartrevio
  version: "1.0.0"
---

Install `passlet` (`npm install passlet`) and generate wallet passes following these rules.

## Package: passlet

Repository: https://github.com/oscartrevio/passlet | License: MIT
Unified Apple Wallet + Google Wallet pass generation from a single API. Supports loyalty cards, event tickets, boarding passes, coupons, gift cards, and generic passes. Handles credential management, pass formatting, and platform differences automatically.

## Wallet Setup

Always create a `wallet.ts` singleton file and import from it everywhere. Never instantiate `Wallet` inside a request handler or component — it's expensive and holds credentials.

Create `lib/wallet.ts` (or `src/lib/wallet.ts`, `utils/wallet.ts`, etc. — match the project's convention):

```ts
// lib/wallet.ts
import { Wallet } from "passlet";

export const wallet = new Wallet({
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
```

Then import `wallet` wherever passes are created:

```ts
import { wallet } from "@/lib/wallet";
import { field } from "passlet";
```

Only need one platform? Omit the other block from `wallet.ts` entirely — Passlet skips that platform automatically.

## Pass Types

Each method maps automatically to the correct Apple pass style and Google Wallet class:

```ts
wallet.loyalty(config)   // Rewards cards, memberships, point systems
wallet.event(config)     // Concerts, conferences, sports, ticketed events
wallet.flight(config)    // Boarding passes with gate, seat, departure info
wallet.coupon(config)    // Discounts, promos, limited-time offers
wallet.giftCard(config)  // Prepaid cards with balance tracking
wallet.generic(config)   // Credentials, IDs, parking passes, keys
```

## Creating a Pass

```ts
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

const { apple, google } = await pass.create({ serialNumber: "user-123" });
```

- `apple` → `Uint8Array` — the `.pkpass` file. Serve with `Content-Type: application/vnd.apple.pkpass`.
- `google` → JWT string. Build the save URL as `https://pay.google.com/gp/v/save/{jwt}`.

## Fields

Fields define what shows on the pass. Use the `field` helper — Passlet translates to each platform's layout model.

```ts
import { field } from "passlet";

field.primary("key", "Label", "Value")     // Large, prominent — use sparingly (1–2 max)
field.secondary("key", "Label", "Value")   // Detail row, visible on front
field.auxiliary("key", "Label", "Value")   // Secondary detail row, visible on front
field.back("key", "Label", "Value")        // Reverse side (Apple) / expandable section (Google)
```

Field placement quick reference:
- `primary` → pass title / main value (points balance, event name, passenger name)
- `secondary` → key details (date, tier, gate, seat)
- `auxiliary` → supporting info (doors open, boarding time, promo code)
- `back` → fine print, terms, support contact

## Barcodes

```ts
barcode: {
  format: "QR",         // "QR" | "PDF417" | "AZTEC" | "CODE128"
  value: "ABC-12345",
  altText: "ABC-12345", // Text shown below the barcode
}
```

Passlet normalizes formats across platforms. Unsupported formats fall back to the closest platform equivalent automatically.

## Visual Customization

```ts
wallet.loyalty({
  id: "my-card",
  name: "My Card",
  backgroundColor: "#1c1917",
  foregroundColor: "#fafaf9",
  labelColor: "#a8a29e",
  icon: readFileSync("./assets/icon.png"),   // Uint8Array or Buffer
  logo: readFileSync("./assets/logo.png"),   // Uint8Array or Buffer
  fields: [ /* ... */ ],
});
```

Colors accept any hex value. Passlet handles Apple asset bundling and Google image hosting references automatically.

## Credentials Setup

### Apple

Requires an Apple Developer account with a Pass Type ID.

1. [Create a Pass Type ID](https://developer.apple.com/account/resources/identifiers/list/passTypeId)
2. Create and download the signing certificate from the Apple Developer portal
3. Export as `.p12`, then convert to PEM:

```bash
openssl pkcs12 -in certificate.p12 -clcerts -nokeys -out signerCert.pem
openssl pkcs12 -in certificate.p12 -nocerts -out signerKey.pem
```

4. Download the [Apple WWDR G4 certificate](https://www.apple.com/certificateauthority/)

Store all four values (`passTypeIdentifier`, `teamId`, `signerCert`, `signerKey`, `wwdr`) as environment variables — never hardcode.

### Google

Requires a Google Wallet issuer account.

1. [Sign up for the Google Pay & Wallet Console](https://pay.google.com/business/console)
2. Create a service account with the Google Wallet API enabled
3. Download the JSON key — use `client_email` and `private_key` from the file

## Serving Passes

```ts
// Express example
app.get("/pass/:id", async (req, res) => {
  const { apple, google } = await pass.create({ serialNumber: req.params.id });

  if (req.headers["user-agent"]?.includes("iPhone")) {
    res.setHeader("Content-Type", "application/vnd.apple.pkpass");
    res.send(Buffer.from(apple));
  } else {
    const saveUrl = `https://pay.google.com/gp/v/save/${google}`;
    res.redirect(saveUrl);
  }
});
```

## Pass Type × Field Recommendations

| Pass Type   | Primary             | Secondary              | Auxiliary             |
|-------------|---------------------|------------------------|-----------------------|
| `loyalty`   | Points balance      | Tier, member name      | Expiry, next reward   |
| `event`     | Event name          | Date, venue            | Doors open, seat      |
| `flight`    | Passenger name      | Gate, seat, flight no. | Boarding time, class  |
| `coupon`    | Discount value      | Offer description      | Expiry, promo code    |
| `giftCard`  | Balance             | Card number            | Expiry                |
| `generic`   | Holder / ID name    | Key identifier         | Supporting detail     |

## Anti-Patterns — AVOID

- Instantiating `new Wallet()` inside a request handler or component — always use the `wallet.ts` singleton
- Hardcoding credentials in source — always use environment variables
- Omitting `serialNumber` on `.create()` — each issued pass should have a unique serial
- Using `field.primary()` for more than 1–2 values — primary fields have very limited display space
- Assuming barcode formats are identical across platforms — let Passlet handle normalization
- Serving the raw `google` JWT directly — always wrap it in `https://pay.google.com/gp/v/save/{jwt}`

## Before implementing, confirm with the user:

- Which pass type best fits their use case (`loyalty`, `event`, `flight`, `coupon`, `giftCard`, `generic`)
- Whether they need Apple, Google, or both (affects which credentials are required)
- Whether passes need to be updated after issuance (pass updates are on the roadmap, not yet available)
