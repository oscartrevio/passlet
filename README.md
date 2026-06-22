<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/oscartrevio/passlet/main/.github/assets/header-dark.svg">
  <img src="https://raw.githubusercontent.com/oscartrevio/passlet/main/.github/assets/header.svg" alt="Passlet" width="100%">
</picture>

<p align="center">
  <a href="https://www.npmjs.com/package/passlet">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://shieldcn.dev/group/npm/passlet+npm/passlet/downloads+github/license/oscartrevio/passlet.svg?variant=secondary&size=xs&mode=dark">
      <img src="https://shieldcn.dev/group/npm/passlet+npm/passlet/downloads+github/license/oscartrevio/passlet.svg?variant=secondary&size=xs&mode=light" alt="npm">
    </picture>
  </a>
</p>

**[Passlet](https://github.com/oscartrevio/passlet)** is a library for generating Apple Wallet and Google Wallet passes from a single API.

## The problem

Creating wallet passes is painful.

Apple Wallet and Google Wallet have nothing in common.
Apple uses .pkpass files — a signed ZIP bundle with a JSON manifest, PKCS#7 certificates, and SHA hashes for every asset. Google uses a REST API with service accounts, JWTs, and a completely different data model. Different field names. Different auth flows. Different everything.

If your app supports both, you're building two separate systems.

Passlet fixes that. One API that handles the signing, formatting, and platform translation for you — whether you need one wallet or both.

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
});
```

Field groups (`primary`, `secondary`, `auxiliary`, `back`) map to Apple's layout zones and Google's equivalent row structure. Primary fields render large and prominent. Secondary and auxiliary fill the detail rows. Back fields go on the reverse side (Apple) or expandable section (Google).

## Issuing passes

A pass config is a reusable template. Issue it to a recipient with `create()`, passing a unique `serialNumber` and any per-recipient data:

```ts
const card = wallet.loyalty({
  id: "my-rewards",
  name: "Rewards Card",
  fields: [
    field.primary("points", "Points"), // value supplied per recipient
    field.secondary("tier", "Tier", "Gold"), // static default for everyone
  ],
});

const { apple, google, warnings } = await card.create({
  serialNumber: "user-123", // unique per recipient
  values: { points: "1250" }, // fills field values for this holder
  barcode: { format: "QR", value: "user-123" },
  expiresAt: "2026-12-31T23:59:59Z", // optional ISO datetime
});
```

- **`values`** maps field keys to the value shown for this recipient. Set a key to `null` to hide that field for them; fields left without a default value are filled here.
- **`warnings`** lists non-fatal issues (e.g. a missing optional image) — worth logging.
- Reuse the same `card` template across as many recipients as you like.

## Barcodes

Pass the barcode to `create()` so every recipient can carry their own code:

```ts
await card.create({
  serialNumber: "user-123",
  barcode: {
    format: "QR", // "QR" | "PDF417" | "Aztec" | "Code128"
    value: "ABC-12345",
    altText: "ABC-12345", // text shown below the barcode
  },
});
```

Passlet normalizes barcode formats across platforms. If a format isn't supported on one platform, it falls back to the closest equivalent.

## Structured data

Some pass types take structured properties beyond display fields. Passlet maps them to the right slots on each platform automatically.

```ts
const boarding = wallet.flight({
  id: "aa-100",
  name: "American Airlines",
  transitType: "air", // "air" | "train" | "bus" | "boat"
  carrier: "AA", // 2-letter IATA carrier code
  flightNumber: "100",
  origin: "JFK", // 3-letter IATA airport codes
  destination: "LAX",
  departure: "2026-08-01T08:00:00Z",
  arrival: "2026-08-01T11:30:00Z",
  fields: [
    field.primary("origin", "From", "New York"),
    field.primary("destination", "To", "Los Angeles"),
    field.auxiliary("gate", "Gate", "B22"),
    field.auxiliary("seat", "Seat", "14C"),
  ],
});

await boarding.create({
  serialNumber: "ticket-001",
  values: { passengerName: "Jane Doe" }, // per-recipient
  barcode: { format: "PDF417", value: "AA100JFKLAX" },
});
```

Other types with structured props:

- **`event`** — `startsAt` / `endsAt` ISO datetimes drive lock-screen relevance
- **`coupon`** — `redemptionChannel: "online" | "instore" | "both"`
- **`giftCard`** — `currency: "USD"` (ISO 4217) to format the balance

## Visual customization

```ts
import { readFileSync } from "node:fs";

wallet.loyalty({
  id: "my-card",
  name: "My Card",
  color: "#1c1917", // background — Apple backgroundColor / Google hexBackgroundColor
  apple: {
    icon: readFileSync("./assets/icon.png"), // required for Apple passes
    logo: readFileSync("./assets/logo.png"),
    foregroundColor: "#fafaf9",
    labelColor: "#a8a29e",
  },
  google: {
    logo: "https://cdn.example.com/logo.png", // required for Google passes (URL only)
  },
  fields: [
    /* ... */
  ],
});
```

Top-level `color` sets the background on both platforms. Apple image slots (`icon`, `logo`, `strip`, …) plus `foregroundColor` / `labelColor` live under `apple` and accept `Uint8Array` or `Buffer`. Google needs hosted image **URLs** under `google` — binary uploads aren't supported. Apple requires an `icon`; Google requires a `logo`.

## Serving passes

`apple` is raw `.pkpass` bytes; `google` is a JWT for a save link. A Next.js route handler can serve either:

```ts
// app/api/passes/[id]/route.ts
import { NextResponse } from "next/server";
import { wallet } from "@/lib/wallet"; // your configured Wallet instance

export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const { apple, google } = await wallet
    .loyalty({ id: "rewards", name: "Rewards Card", fields: [] })
    .create({ serialNumber: params.id });

  // Apple: stream the .pkpass file
  return new NextResponse(apple, {
    headers: {
      "Content-Type": "application/vnd.apple.pkpass",
      "Content-Disposition": `attachment; filename="${params.id}.pkpass"`,
    },
  });

  // Google: redirect to the save link instead
  // return NextResponse.redirect(`https://pay.google.com/gp/v/save/${google}`);
}
```

Always generate passes on the server — your signing keys must never reach the client.

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

1. [Sign up for the Google Pay & Wallet Console](https://pay.google.com/business/console) — your **Issuer ID** is shown under *Google Wallet API › Settings*
2. In Google Cloud, enable the **Google Wallet API** and create a service account
3. Download the service account JSON key — use `client_email` and `private_key` from the file

> [!TIP]
> Store `private_key` with its literal `\n` escapes, then restore real newlines at runtime — `process.env.GOOGLE_PRIVATE_KEY!.replace(/\\n/g, "\n")`. A key with collapsed or doubled newlines fails to import with `GOOGLE_INVALID_PRIVATE_KEY`.

## Error handling

Passlet throws a typed `WalletError` with a stable `code` you can switch on:

```ts
import { Wallet, WalletError } from "passlet";

try {
  await pass.create({ serialNumber: "user-123" });
} catch (err) {
  if (err instanceof WalletError) {
    console.error(err.code, err.message);
  }
}
```

Common codes:

| Code                                                 | Meaning                                                  |
| ---------------------------------------------------- | -------------------------------------------------------- |
| `PASS_CONFIG_INVALID`                                | Pass config failed validation (message names the field) |
| `CREATE_CONFIG_INVALID`                              | The `create()` config failed validation                 |
| `APPLE_INVALID_SIGNER_CERT` / `_SIGNER_KEY` / `_WWDR` | A PEM credential couldn't be parsed                      |
| `APPLE_MISSING_ICON`                                 | Apple passes require an `icon` image                     |
| `GOOGLE_INVALID_PRIVATE_KEY`                         | The service-account `private_key` isn't valid PKCS#8 PEM |
| `GOOGLE_MISSING_LOGO`                                | Google passes require a `logo` URL                       |
| `GOOGLE_API_ERROR`                                   | The Google Wallet REST API rejected the request          |

Config errors throw at construction (`PASS_CONFIG_INVALID`) or at `create()` time; signing and API errors surface from `create()`.

## Updating, expiring & deleting

For passes already saved to Google Wallet, manage their lifecycle via the REST API:

```ts
await pass.update({ serialNumber: "user-123", values: { points: "1500" } }); // push new values
await pass.expire("user-123"); // mark expired
await pass.delete("user-123"); // remove
```

These operate on Google passes. Apple passes update through your own [pass web service](https://developer.apple.com/documentation/walletpasses) (on the roadmap), so `update` / `delete` are no-ops for Apple — you can void an Apple pass at issue time with `apple: { voided: true }` in `create()`.

## Roadmap

- [ ] Pass updates and push notifications (APNs + Google API)
- [ ] CLI for quick pass generation
- [X] Pass playground

## Contributing

PRs welcome. If you've dealt with wallet pass APIs before, you know why this needs to exist.

## License

[MIT](LICENSE) © [Oscar Treviño](https://github.com/oscartrevio)
