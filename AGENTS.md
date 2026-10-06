# Agent instructions

Setup, commands, branches, commits and changesets are in [CONTRIBUTING.md](CONTRIBUTING.md). These are the rules that aren't obvious from the code.

- **Follow Apple's and Google's current documentation.** Read the live pages before changing anything about pass formats, the Apple web service, APNs, or Google Wallet REST calls. Cite the page in a code comment when the behavior isn't obvious.
- **No runtime dependencies.** The published package uses Node built-ins only; `zod/mini` is bundled at build time. Don't add a dependency to `packages/passlet`.
- **Use the providers' vocabulary.** Names follow Apple and Google terms (`eventTicket`, `boardingPass`, `serialNumber`, `deviceLibraryIdentifier`).
- **Test at the interface.** Tests go through `Wallet` and `PassTemplate`, or through a pure builder module (`apple/pass-json`, `google/object-body`). Crypto, archives and JWTs are checked by independent oracles in `test/support`, never by the code under test.
- **Verify against the real services.** Changes to signing, the web service, or Google writes need `pnpm -F passlet test:e2e`, which uses the credentials in `packages/passlet/.env`. Never commit that file or anything generated from it.
- **Every change to `packages/passlet` needs a changeset** (`pnpm changeset`).
