# Contributing to Passlet

Passlet is still early, and there's a lot of room to shape it. Whether it's a bug fix, a new feature, or just better docs — all contributions help move this forward.

## Setup

Prerequisites: Node.js 22.18+ (changesets needs >=22.11; the repo's `.ts` scripts run through Node's type stripping), pnpm 10.33+. CI tests the library on the two `engines` floors, Node 20.19 and 22.12, and on Node 24 and 26.

```bash
git clone https://github.com/oscartrevio/passlet.git
cd passlet
pnpm install
```

Library work needs no build: tests and type checks run against `packages/passlet/src`. `pnpm build` builds every workspace, including the Next.js site; to build only the library, run `pnpm -F passlet build`.

### Commands

```bash
pnpm dev          # development mode
pnpm dev:web      # web app only
pnpm check-types  # type checking
pnpm check        # lint and format check with Biome (what CI runs)
pnpm fix          # pnpm check, applying Biome's safe lint fixes and formatting
```

The pre-commit hook runs `pnpm fix` on staged files.

### Tests

The library's tests live in `packages/passlet/test/` in three tiers:

```bash
pnpm -F passlet test              # unit + integration (what CI runs)
pnpm -F passlet test:unit         # pure functions: schemas, pass.json, class/object bodies
pnpm -F passlet test:integration  # signing, .pkpass archives, Wallet API flow against a stubbed fetch
pnpm -F passlet test:e2e          # real credentials from packages/passlet/.env; skipped when absent
```

The integration tier also starts local servers on loopback: an HTTP/2 stand-in for APNs and a `node:http` server for `toNodeListener`.

The e2e tier issues passes against Apple's signing chain and Google's Wallet API. Copy `packages/passlet/.env.example` to `packages/passlet/.env`, fill in your credentials, and run `pnpm -F passlet test:e2e`. The generated `.pkpass` files land in `packages/passlet/test/e2e/out/` for opening on a device. Changes to signing, the Apple web service or Google writes need an e2e run.

Google request bodies are checked against `packages/passlet/test/support/google-discovery.json`, a trimmed copy of Google's Wallet Objects discovery document. Refresh it with `pnpm -F passlet update-google-schema` when Google's reference changes; the diff shows exactly which fields Google added, renamed or deprecated.

### Performance

```bash
pnpm -F passlet bench                                # benchmarks through the public API
pnpm -F passlet bench --outputJson /tmp/before.json  # save a baseline...
pnpm -F passlet bench --compare /tmp/before.json     # ...and compare a later run against it
pnpm -F passlet build && pnpm -F passlet check-size  # bundle size budget (CI runs it)
```

Benchmarks sign with 2048-bit keys, like real certificates. Timings on shared machines are noisy, so they stay out of CI; compare runs on your own machine. The size budget lives in `packages/passlet/scripts/check-size.mjs` and fails when `dist/index.js` grows past it, raw or gzipped. Lower it when the bundle shrinks; raise it only in the PR that needs the bytes, saying why.

## Project structure

```
passlet/
├── apps/web/             # Next.js site
├── packages/passlet/     # Core library
├── packages/ui/          # Shared UI components
├── packages/config/      # Shared configuration
└── examples/             # Express, Hono and Next.js servers; CI type-checks them against each commit
```

Most contributions will land in `packages/passlet` — that's where the core library lives.

## Making changes

Branch off `main`:

```bash
git checkout -b feat/your-change
```

Use prefixes: `feat/`, `fix/`, `docs/`, `refactor/`, `test/`, `chore/`.

### Commits

We follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(wallet): add support for event passes
fix(barcode): correct altText handling
docs(readme): update installation instructions
```

### Changesets

If your change affects the published package, run:

```bash
pnpm changeset
```

This keeps the changelog and versioning accurate.

## Pull requests

One change per PR when possible. Before opening, make sure:

- `pnpm check-types` passes
- `pnpm check` passes
- `pnpm -F passlet test` passes

Don't worry about making it perfect — we're happy to work through feedback together.

## Questions

Open an [issue](https://github.com/oscartrevio/passlet/issues) or start a [discussion](https://github.com/oscartrevio/passlet/discussions).
