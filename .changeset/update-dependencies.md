---
"passlet": patch
---

chore: update dependencies to latest

Bumps the toolchain and dependencies to their latest versions (TypeScript 6.0,
Biome 2.4.16, ultracite 7.8.2, commitlint 21, vitest, tsup, and others). `jose`
is intentionally held at v5 because v6 is ESM-only and would break the published
CommonJS bundle.
