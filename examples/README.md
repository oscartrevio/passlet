# Passlet examples

Three minimal servers that issue the **same** loyalty pass and serve it over HTTP:

| Example                  | Stack                     | Endpoints                                                       |
| ------------------------ | ------------------------- | --------------------------------------------------------------- |
| [`nextjs/`](./nextjs)     | Next.js 15 App Router     | `GET /api/passes/:serial/apple` · `GET /api/passes/:serial/google` |
| [`hono/`](./hono)         | Hono + `@hono/node-server` | `GET /passes/:serial/apple` · `GET /passes/:serial/google`        |
| [`express/`](./express)   | Express 5                 | `GET /passes/:serial/apple` · `GET /passes/:serial/google`        |

Each one does exactly two things:

- **Apple** — responds with the signed `.pkpass` bytes (`Uint8Array`) under `Content-Type: application/vnd.apple.pkpass`.
- **Google** — responds `302` to `https://pay.google.com/gp/v/save/<jwt>`.

## Run one

```bash
cd examples/hono          # or nextjs / express
cp .env.example .env      # fill in your credentials
pnpm install
pnpm dev
open http://localhost:3000/passes/user-123/google
```

Each folder ships a 1×1 placeholder `assets/icon.png` so the examples boot before you
have real artwork. Replace it with a real icon (29×29, 58×58 `@2x`, 87×87 `@3x`) before
shipping — Apple renders it in the Wallet list view.

## The shape of the API

All three examples follow the same three steps:

```ts
const wallet = new Wallet({ apple: {...}, google: {...} }); // once, at boot
const card = wallet.loyalty({ id, name, fields: [...] });   // reusable template
const { apple, google, warnings } = await card.create({     // per recipient
  serialNumber: "user-123",
  values: { points: "1250" },
  barcode: { format: "QR", value: "user-123" },
});
```

- `apple` is a `Uint8Array` — the `.pkpass` archive, or `null` if you left Apple credentials out.
- `google` is a JWT `string` — or `null` if you left Google credentials out.
- `warnings` is a `string[]` of non-fatal notices. Log them.

`new Wallet()` and `wallet.loyalty()` are cheap and side-effect free; only `create()`
does signing and network I/O. Build the template at module scope and call `create()`
per request.

## Environment variables

Every example reads the same set (see each folder's `.env.example`).

### Apple

| Variable                     | Where it comes from                                                |
| ---------------------------- | ------------------------------------------------------------------ |
| `APPLE_PASS_TYPE_IDENTIFIER` | Your Pass Type ID, e.g. `pass.com.yourcompany.rewards`             |
| `APPLE_TEAM_ID`              | 10-character Apple Team ID                                          |
| `APPLE_SIGNER_CERT`          | PEM **contents** of the pass signing certificate                    |
| `APPLE_SIGNER_KEY`           | PEM **contents** of the matching private key                        |
| `APPLE_WWDR`                 | PEM **contents** of the Apple WWDR G4 intermediate certificate      |

1. Create a [Pass Type ID](https://developer.apple.com/account/resources/identifiers/list/passTypeId) and download its signing certificate.
2. Export it as `.p12`, then convert to the PEM pair Passlet expects:

   ```bash
   openssl pkcs12 -in certificate.p12 -clcerts -nokeys -out signerCert.pem
   openssl pkcs12 -in certificate.p12 -nocerts -out signerKey.pem
   ```

   If `signerKey.pem` is passphrase-protected, strip the passphrase
   (`openssl rsa -in signerKey.pem -out signerKey.pem`) — Passlet takes an
   unencrypted key.

3. Download the [Apple WWDR G4 certificate](https://www.apple.com/certificateauthority/). It ships as DER (`.cer`); convert it:

   ```bash
   openssl x509 -inform der -in AppleWWDRCAG4.cer -out wwdr.pem
   ```

Passlet wants the PEM **text**, not a path. In `.env`, wrap each value in quotes and
keep the `\n` escapes, or load the files with `readFileSync(..., "utf8")` at boot.

### Google

| Variable              | Where it comes from                                        |
| --------------------- | ---------------------------------------------------------- |
| `GOOGLE_ISSUER_ID`    | Pay & Wallet Console → Google Wallet API → Settings         |
| `GOOGLE_CLIENT_EMAIL` | `client_email` in the service-account JSON key              |
| `GOOGLE_PRIVATE_KEY`  | `private_key` in the same JSON key (PKCS#8 PEM)             |
| `GOOGLE_LOGO_URL`     | Publicly reachable HTTPS URL of your logo (required)        |

1. Sign up at the [Google Pay & Wallet Console](https://pay.google.com/business/console).
2. In Google Cloud, enable the **Google Wallet API** and create a service account.
3. Grant that service-account email access to your issuer account in the Wallet Console.
4. Store `private_key` with its literal `\n` escapes and restore real newlines at runtime:

   ```ts
   privateKey: process.env.GOOGLE_PRIVATE_KEY!.replace(/\\n/g, "\n");
   ```

   A key with collapsed or doubled newlines fails with `GOOGLE_INVALID_PRIVATE_KEY`.

Set `google.origins` to the domains that embed your "Add to Google Wallet" button,
otherwise the web save button won't render.

**Credentials are server-only.** Never generate a pass in the browser, never ship a
signing key to the client.

## Header rules

### Apple (`.pkpass`)

```http
Content-Type: application/vnd.apple.pkpass
Content-Disposition: attachment; filename="user-123.pkpass"
Content-Length: 24576
Cache-Control: no-store, private
```

- **The MIME type must be exactly `application/vnd.apple.pkpass`.** Not
  `application/octet-stream`, not `application/zip`, no `; charset=utf-8` suffix. iOS
  Safari decides whether to open the "Add Pass" sheet purely from this header — get it
  wrong and the user gets a raw download or a blank page.
- `Content-Disposition: attachment` with a `.pkpass` **filename**, quoted. iOS keys off
  the content type, but Android/desktop browsers and email clients key off the
  extension. Sanitize the filename if the serial number is user-controlled.
- Send the bytes verbatim. Don't run the response through a JSON serializer, don't
  re-encode as base64, don't let a framework helper (`res.send`, `res.json`) guess a
  type for you.
- `Content-Length` is optional but helps clients that dislike chunked binary responses.

### Google (save link)

```http
HTTP/1.1 302 Found
Location: https://pay.google.com/gp/v/save/<jwt>
Cache-Control: no-store, private
```

The save URL is nothing more than the JWT from `create()` appended to
`https://pay.google.com/gp/v/save/`. You can either redirect (as these examples do) or
return the URL as JSON and let the client render an official
["Add to Google Wallet" button](https://developers.google.com/wallet/generic/resources/brand-guidelines).

## Common pitfalls

- **Caching.** Passes are per-recipient and signed; a shared cache or CDN will hand user
  A's pass to user B. Always send `Cache-Control: no-store, private`. In Next.js also set
  `export const dynamic = "force-dynamic"` — route handlers can otherwise be statically
  cached at build time, and a cached `302` to a stale Google JWT is a very confusing bug.
- **Runtime.** Passlet signs with `node-forge` / `jszip` and needs Node APIs. In Next.js
  set `export const runtime = "nodejs"` (the Edge runtime will fail). On Cloudflare
  Workers you need `nodejs_compat`.
- **Apple needs an `icon`.** Missing it throws `WalletError("APPLE_MISSING_ICON")`.
  Google needs a `logo` **URL** (`GOOGLE_MISSING_LOGO`) — Google does not accept binary
  uploads, only hosted images, and Apple slots take bytes, not URLs.
- **Certificate mismatch.** `APPLE_PASS_TYPE_IDENTIFIER` and `APPLE_TEAM_ID` must match
  the certificate exactly. A mismatch still produces a `.pkpass`, but iOS silently
  refuses to add it — no error, just a dead file.
- **Serve over HTTPS.** iOS will download a pass from `http://localhost` during
  development, but real devices and email links need TLS. To test on a phone, tunnel
  (`ngrok`, `cloudflared`) rather than using your LAN IP.
- **Unique serial numbers.** `serialNumber` identifies the pass for its whole life.
  Reusing one overwrites the previous holder's Google object and confuses Apple's update
  flow. Use your own user/ticket ID.
- **`values: { key: null }` hides a field** for that recipient — it does not clear the
  label. Omit the key entirely to fall back to the template's default value.
- **Check `warnings`.** `create()` resolves successfully with warnings for things like a
  missing optional image. They're the fastest signal that a pass will look wrong.
- **Errors are typed.** Catch `WalletError` and switch on `err.code` (`PASS_CONFIG_INVALID`,
  `CREATE_CONFIG_INVALID`, `APPLE_INVALID_SIGNER_CERT`, `GOOGLE_API_ERROR`, …) instead of
  matching on message strings. Config errors surface at template construction — which, in
  these examples, means at boot rather than mid-request.
