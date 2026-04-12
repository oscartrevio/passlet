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

## Project structure

```
passlet/
├── apps/web/             # Next.js site
├── packages/passlet/     # Core library
├── packages/ui/          # Shared UI components
├── packages/config/      # Shared configuration
└── packages/env/         # Environment variables
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
- There's a clear description of what changed and why

Don't worry about making it perfect — we're happy to work through feedback together.

## Questions

Open an [issue](https://github.com/oscartrevio/passlet/issues) or start a [discussion](https://github.com/oscartrevio/passlet/discussions).
