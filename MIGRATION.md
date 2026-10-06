# Migration

## From 2.x to 3.0

v3 adds pass updates, push notifications and multi-pass bundles, and renames the API to Apple's and Google's vocabulary. Node.js 20.15 or later is required.

### Caught by TypeScript

Rename and recompile; the compiler points at every call site.

```diff
- import { Pass, type PassConfig, type CreateConfig, type WalletCredentials } from "passlet";
+ import { PassTemplate, type TemplateConfig, type PassContent, type WalletConfig } from "passlet";

- wallet.event({ ... })
+ wallet.eventTicket({ ... })
- wallet.flight({ ... })
+ wallet.boardingPass({ ... })

- const { apple, google, warnings } = await template.create(content);
+ const { apple, google } = await template.create(content);

- await template.update({ serialNumber, values }, { notify: true });
+ await wallet.update(serialNumber, { notify: true }); // reads the pass through `load`, see below

- await template.delete(serialNumber);
+ await template.expire(serialNumber); // Google has no delete; v2's delete() never removed anything
```

| v2 | v3 |
| --- | --- |
| `Pass` | `PassTemplate` (now exposes `readonly config`) |
| `PassConfig`, `PassType` | `TemplateConfig`, `TemplateType` |
| `EventPassConfig`, `FlightPassConfig` | `EventTicketTemplateConfig`, `BoardingPassTemplateConfig` |
| `LoyaltyPassConfig`, `CouponPassConfig`, `GiftCardPassConfig`, `GenericPassConfig` | `LoyaltyTemplateConfig`, `CouponTemplateConfig`, `GiftCardTemplateConfig`, `GenericTemplateConfig` |
| template `type: "event"` / `"flight"` | `"eventTicket"` / `"boardingPass"` |
| `CreateConfig` | `PassContent` |
| `WalletCredentials` | `WalletConfig` |
| `UpdateOptions` | removed; `wallet.update()` takes `{ notify }` |
| template `apple.groupingIdentifier` | `group` on the pass content |
| `APPLE_MISSING_AUTH_TOKEN` | removed |

### Not caught by TypeScript

These compile and change behavior at runtime. Check them before you deploy.

- **Images must load.** Any image a template names, required or optional, that fails to download rejects `create()` with `IMAGE_FETCH_FAILED` or `IMAGE_FETCH_NETWORK_ERROR`. v2 skipped it and returned a warning.
- **Event ticket strip images.** A strip image together with a background or thumbnail now throws `PASS_CONFIG_INVALID` when the template is built, as Apple's design rules require.
- **Google serial numbers.** With Google configured, `serialNumber` may only contain `A-Z a-z 0-9 . _ -` (Google's object ID rule). Other values throw `CREATE_CONFIG_INVALID`.
- **Google `create()` writes the object.** It creates the pass object through the Wallet REST API and returns a save JWT that refers to it by ID, so the link always shows current data. It uses the same API access v2's `create()` already needed for the class.

### Updating passes

v2 left updates to you. In v3 your database stays the source of truth: give the wallet a `load` function, then call `wallet.update(serialNumber)` after you save a change.

```ts
const wallet = new Wallet({
  apple: { ...appleCredentials, webService: { url, secret, registrations } },
  google,
  load: async (serialNumber) => ({ template: rewards, content: { values }, updatedAt }),
});
```

The template options `apple.webServiceURL` and `apple.authenticationToken` are gone. v2 wrote the same token into every pass; v3 derives a separate token per pass from `secret`, and `wallet.handler` serves Apple's web service with it. Passes already issued with a v2 token keep that token forever (Apple doesn't allow changing it), so keep your existing web service running for them. See [Updating Passes](https://github.com/oscartrevio/passlet/wiki/Updating-Passes).
