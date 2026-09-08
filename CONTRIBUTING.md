# Contributing to Passlet

Passlet is still early, and there's a lot of room to shape it. Whether it's a bug fix, a new feature, or just better docs — all contributions help move this forward.

## Setup

Prerequisites: Node.js 20+, pnpm 10.33+.

```bash
git clone https://github.com/oscartrevio/passlet.git
cd passlet
pnpm install
pnpm build
```

### Commands

```bash
pnpm dev          # development mode
pnpm dev:web      # web app only
pnpm check-types  # type checking
pnpm check        # linting
pnpm fix          # auto-format
```

### Tests

The library's tests live in `packages/passlet/test/` in three tiers:

```bash
pnpm -F passlet test              # unit + integration (what CI runs)
pnpm -F passlet test:unit         # pure functions: schemas, pass.json, class/object bodies
pnpm -F passlet test:integration  # signing, .pkpass archives, Wallet API flow against a stubbed fetch
pnpm -F passlet test:e2e          # real credentials from packages/passlet/.env; skipped when absent
```

The e2e tier issues passes against Apple's signing chain and Google's Wallet API. Copy `packages/passlet/.env.example` to `.env`, fill in your credentials, and the generated `.pkpass` files land in `packages/passlet/test/e2e/out/` for opening on a device.

## Project structure

```
passlet/
├── apps/web/             # Next.js site
├── packages/passlet/     # Core library
├── packages/ui/          # Shared UI components
└── packages/config/      # Shared configuration
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
