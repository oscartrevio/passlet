<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/oscartrevio/passlet/main/.github/assets/header-dark.svg">
  <img src="https://raw.githubusercontent.com/oscartrevio/passlet/main/.github/assets/header.svg" alt="Passlet" width="100%">
</picture>

**Apple Wallet and Google Wallet passes from one TypeScript API.**

Define a template. Fill in a recipient's details. Get a signed `.pkpass` file and a Google Wallet save link.

[Playground](https://passlet.oscartrevio.xyz) · [Examples](examples/) · [npm](https://www.npmjs.com/package/passlet)

## Install

```sh
npm install passlet
```

Run Passlet on the **server**, never in a client component. Signing credentials must stay private.

## Create a pass

[Set up your credentials](#credentials) first. This example uses both platforms; omit either credential block to use just one.

Save the script as `pass.mjs`. Place `signerCert.pem`, `signerKey.pem`, `wwdr.pem`, `service-account.json`, and your PNG icons (`icon.png`, `icon@2x.png`) beside it. Set `APPLE_PASS_TYPE_ID`, `APPLE_TEAM_ID`, `GOOGLE_ISSUER_ID`, and `GOOGLE_LOGO_URL` in your environment. The logo URL must be publicly accessible.

```js
import { readFile, writeFile } from "node:fs/promises";
import { field, googleSaveUrl, Wallet } from "passlet";

const serviceAccount = JSON.parse(await readFile("./service-account.json", "utf8"));

const wallet = new Wallet({
  apple: {
    passTypeIdentifier: process.env.APPLE_PASS_TYPE_ID,
    teamId: process.env.APPLE_TEAM_ID,
    signerCert: await readFile("./signerCert.pem", "utf8"),
    signerKey: await readFile("./signerKey.pem", "utf8"),
    wwdr: await readFile("./wwdr.pem", "utf8"),
  },
  google: {
    issuerId: process.env.GOOGLE_ISSUER_ID,
    clientEmail: serviceAccount.client_email,
    privateKey: serviceAccount.private_key,
  },
});

const rewards = wallet.loyalty({
  id: "rewards",
  name: "Coffee Club",
  color: "#3c2415",
  apple: {
    icon: {
      base: await readFile("./icon.png"),
      retina: await readFile("./icon@2x.png"),
    },
  },
  google: { logo: process.env.GOOGLE_LOGO_URL },
  fields: [
    field.primary("points", "Points"),
    field.secondary("tier", "Tier", "Member"),
  ],
});

const { apple, google, warnings } = await rewards.create({
  serialNumber: "member-123",
  values: { points: "1250" },
  barcode: { format: "QR", value: "member-123" },
});

if (apple) await writeFile("./rewards.pkpass", apple);
if (google) console.log(googleSaveUrl(google));
if (warnings.length) console.warn(warnings);
```

Run `node pass.mjs`, or `node --env-file=.env pass.mjs` if you keep the environment variables in a `.env` file.

- `apple` is the signed file as a `Uint8Array`; `google` is a signed JWT. An unconfigured provider returns `null`.
- `warnings` reports non-fatal issues, such as an unavailable optional image. A required image failure rejects the call.
- Keep the template `id` stable. Give each recipient or ticket its own `serialNumber`; lifecycle operations use that same number.

For one platform, also remove its unused file reads and template options. Reuse the configured wallet and template across requests.

## Shape the pass

| Method | Use it for |
| --- | --- |
| `wallet.loyalty(config)` | Rewards and memberships |
| `wallet.event(config)` | Event tickets |
| `wallet.flight(config)` | Flights; ground transport with `google.transit` |
| `wallet.coupon(config)` | Offers and discounts |
| `wallet.giftCard(config)` | Prepaid balances |
| `wallet.generic(config)` | Other passes |

Use `field.header`, `field.primary`, `field.secondary`, `field.auxiliary`, and `field.back` to arrange information. The third argument is a default value or a formatting options object:

```ts
field.secondary("balance", "Balance", { value: "25", currencyCode: "USD" });
field.back("terms", "Terms", "Valid at participating locations.");
```

Recipient `values` override those defaults. An omitted key keeps its default; `null` hides the field. Platform-specific options live under `apple` and `google`—the wallets do not have identical layouts or requirements.

Apple requires `apple.icon` on every pass and `transitType` on boarding passes. Google requires a public `google.logo` URL for loyalty and transit passes. Air flights also require carrier, flight number, airports, departure time, and a recipient `passengerName`.

See the [exported types](packages/passlet/src/index.ts) and [pass schemas](packages/passlet/src/types/schemas.ts) for images, localization, barcodes, dates, locations, and platform options.

## Serve and update

| Output | Deliver it as |
| --- | --- |
| Apple | Raw bytes with `Content-Type: application/vnd.apple.pkpass` (`APPLE_PASS_CONTENT_TYPE`) and a `.pkpass` filename |
| Google | A redirect or button linking to `googleSaveUrl(google)` |

Use HTTPS and `Cache-Control: no-store, private`. Pass files and save links contain recipient data; do not put them in shared caches or public logs. See the runnable [Express, Hono, and Next.js examples](examples/README.md).

### Google template publication

`create()` creates a missing Google class but **never overwrites an existing one**. After changing a template's shared configuration, publish it explicitly from your setup or deployment code:

```ts
await rewards.publish();
```

This updates the shared class for all of its passes. Do not publish on every download. Calling `publish()` without Google credentials throws `GOOGLE_NOT_CONFIGURED`.

For a pass already saved to Google Wallet:

```ts
await rewards.update({ serialNumber: "member-123", values: { points: "1500" } });
await rewards.expire("member-123");
await rewards.delete("member-123");
```

These lifecycle methods affect Google only; with Apple-only credentials they do nothing. Apple updates require your own [pass web service and push notifications](https://developer.apple.com/documentation/walletpasses). Passlet generates and signs the replacement file, but does not host that service or send APNs notifications. To issue a voided Apple pass, pass `apple: { voided: true }` to `create()`.

## Credentials

### Apple Wallet

1. [Register a Pass Type ID](https://developer.apple.com/account/resources/identifiers/list/passTypeId) with an Apple Developer account and create its signing certificate.
2. Export the certificate **with its private key** as `certificate.p12`. Convert it to PEM:

   ```sh
   openssl pkcs12 -in certificate.p12 -clcerts -nokeys -out signerCert.pem
   openssl pkcs12 -in certificate.p12 -nocerts -nodes -out signerKey.pem
   ```

3. Download the [Apple WWDR G4 intermediate certificate](https://www.apple.com/certificateauthority/) and convert the downloaded DER certificate:

   ```sh
   openssl x509 -inform DER -in AppleWWDRCAG4.cer -out wwdr.pem
   ```

4. Set `APPLE_PASS_TYPE_ID` and `APPLE_TEAM_ID` to the identifiers in the signing certificate. Supply your app's PNG icon in standard and @2x sizes.

The private key must be unencrypted PEM; protect it with filesystem permissions or a secret manager. Passlet also supports an `AppleExternalSigner` for keys held outside your process. Never commit certificates, private keys, or `.env` files.

### Google Wallet

1. Create an issuer account in the [Google Pay & Wallet Console](https://pay.google.com/business/console) and set `GOOGLE_ISSUER_ID` to its issuer ID.
2. Enable the Google Wallet API in Google Cloud, create a service account, and download its JSON key as `service-account.json`.
3. **Grant that service-account email Developer access in your Wallet issuer account.** A Cloud service account alone does not grant issuer access.
4. Set `GOOGLE_LOGO_URL` to your hosted logo. In demo mode, add your test accounts in the Wallet Console; request publishing access before issuing to the public.

Use `client_email` and `private_key` from the JSON unchanged. Passlet also accepts literal `\n` escapes in the key. Google's [REST authentication guide](https://developers.google.com/wallet/generic/getting-started/auth/rest) covers account permissions.

## Handle failures

Catch `WalletError` around **both template construction and async operations**. Branch on `code`, not message text.

```ts
import { WalletError } from "passlet";

try {
  await rewards.create({ serialNumber: "member-123", values: { points: "1250" } });
} catch (error) {
  if (!(error instanceof WalletError)) throw error;
  const { code, status, message, why, fix } = error;
  console.error({ code, status, message, why, fix });
  for (const issue of error.issues) {
    console.error(issue.path.join("."), issue.message);
  }
}
```

Every error exposes **`code`, `status`, `message`, `why`, and `fix`**. `status` is the upstream HTTP status when available, otherwise the catalog default below. It is diagnostic metadata—not an instruction to forward provider authentication errors to your users.

Validation errors include `issues`. Google HTTP failures may include `retryAfter` in seconds; Passlet does not retry automatically. Messages omit raw provider responses and image URLs. Treat the underlying `cause` as private diagnostic data.

<details>
<summary>Error catalog</summary>

The code is the key in the exported `WALLET_ERROR_CODES` catalog. Each entry contains its default status, message, reason, and remedy.

| Code | Status | Message | Why | Fix |
| --- | --- | --- | --- | --- |
| `PASS_CONFIG_INVALID` | 400 | Invalid pass template. | The template does not satisfy the pass schema. | Correct each field listed in issues before constructing the template. |
| `CREATE_CONFIG_INVALID` | 400 | Invalid recipient data. | The issuance or update data does not satisfy the recipient schema. | Correct each field listed in issues before retrying the operation. |
| `APPLE_INVALID_SIGNER_CERT` | 500 | Invalid Apple signing certificate. | signerCert could not be parsed as a PEM certificate. | Export your Pass Type ID certificate as PEM and pass its contents as signerCert. |
| `APPLE_INVALID_SIGNER_KEY` | 500 | Invalid Apple signing key. | signerKey could not be parsed as an unencrypted PEM private key. | Export the private key matching signerCert as unencrypted PEM. |
| `APPLE_INVALID_WWDR` | 500 | Invalid Apple WWDR certificate. | wwdr could not be parsed as a PEM certificate. | Download the Apple WWDR G4 intermediate certificate and convert DER to PEM. |
| `APPLE_SIGNING_FAILED` | 500 | Apple pass signing failed. | The signer could not produce the pass's detached PKCS#7 signature. | Check the certificate/key pair; for an external signer, check the digest and RSA padding. |
| `APPLE_MISSING_ICON` | 400 | Apple pass icon is missing. | Apple Wallet requires an icon on every pass. | Set apple.icon to PNG bytes or an accessible image URL, with an @2x variant. |
| `APPLE_BOARDING_MISSING_TRANSIT_TYPE` | 400 | Boarding pass transit type is missing. | Apple boarding passes require a transitType. | Set transitType to air, train, bus, boat, or generic. |
| `APPLE_MISSING_AUTH_TOKEN` | 400 | Apple update authentication token is missing or too short. | A pass using webServiceURL needs an authenticationToken of at least 16 characters. | Set apple.authenticationToken to a secure token with at least 16 characters. |
| `APPLE_APP_LAUNCH_URL_REQUIRES_STORE_IDS` | 400 | Associated App Store identifiers are missing. | Apple requires associatedStoreIdentifiers when appLaunchURL is set. | Set apple.associatedStoreIdentifiers to your app's numeric App Store IDs. |
| `GOOGLE_INVALID_PRIVATE_KEY` | 500 | Invalid Google service-account private key. | privateKey could not be imported as a PKCS#8 PEM private key. | Use private_key unchanged from the service-account JSON, not the filename or entire JSON. |
| `GOOGLE_SIGNING_FAILED` | 500 | Google JWT signing failed. | The service-account key could not sign the OAuth assertion or Wallet JWT. | Check that the service-account key is a valid RSA private key usable with RS256. |
| `GOOGLE_API_ERROR` | 502 | Google rejected the Wallet request. | The Wallet API returned an error not covered by a more specific code. | Check status and verify the pass fields against Google's resource requirements. |
| `GOOGLE_AUTH_FAILED` | 401 | Google authentication failed. | Google rejected the service-account assertion or access token. | Check clientEmail, the active service-account key, and the system clock. |
| `GOOGLE_ACCESS_DENIED` | 403 | Google denied access to the issuer. | The credentials do not have permission to perform this Wallet operation. | Enable the Wallet API and grant the service-account email Developer access to your issuer. |
| `GOOGLE_NOT_FOUND` | 404 | Google Wallet resource was not found. | The requested class or saved pass object does not exist for this issuer. | Check the issuer, template ID, and serial number; a pass must be saved before updating it. |
| `GOOGLE_CONFLICT` | 409 | Google Wallet resource already exists. | Another resource already uses the requested ID. | Use the existing resource or a different ID; publish shared template changes explicitly. |
| `GOOGLE_RATE_LIMITED` | 429 | Google request quota was exceeded. | Google is limiting requests for the issuer or project. | Reduce request volume and wait before retrying; respect retryAfter when provided. |
| `GOOGLE_UNAVAILABLE` | 503 | Google Wallet is temporarily unavailable. | Google returned a server error. | Retry later with backoff and respect retryAfter when provided. |
| `GOOGLE_NETWORK_ERROR` | 502 | Could not reach Google. | The OAuth or Wallet request failed before a complete response could be read. | Check DNS, TLS, proxies, and network access to Google's OAuth and Wallet endpoints. |
| `GOOGLE_INVALID_RESPONSE` | 502 | Google returned an invalid response. | A successful response was malformed or missing required data. | Check for an upstream service or proxy failure before retrying. |
| `GOOGLE_NOT_CONFIGURED` | 500 | Google Wallet is not configured. | Template publication was requested without Google credentials. | Configure google credentials on Wallet before calling publish(). |
| `GOOGLE_MISSING_LOGO` | 400 | Google Wallet logo is missing. | Google loyalty and transit classes require a publicly accessible logo URL. | Set google.logo to a hosted image URL; image bytes are not supported by Google. |
| `GOOGLE_FLIGHT_MISSING_CLASS_FIELDS` | 400 | Google flight details are incomplete. | The flight class is missing required header or departure data. | Set carrier, flightNumber, origin, destination, and departure on the flight template. |
| `GOOGLE_FLIGHT_MISSING_PASSENGER_NAME` | 400 | Google flight passenger name is missing. | Google requires passengerName on each flight pass object. | Set values.passengerName when issuing the flight pass. |
| `IMAGE_FETCH_NETWORK_ERROR` | 502 | Could not download the image. | The image request failed before its bytes could be read. | Check the image URL and network access, or supply Apple image bytes directly. |
| `IMAGE_FETCH_FAILED` | 502 | The image server rejected the download. | The image URL returned a non-success HTTP status. | Check that the URL is accessible and has not expired; inspect status for the response code. |

</details>

[All error codes](packages/passlet/src/errors.ts) · [Contributing](CONTRIBUTING.md) · [MIT license](LICENSE)
