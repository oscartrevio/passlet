---
"passlet": major
---

**Breaking.** passlet is now published as an ES module only, and needs Node.js `^20.19.0 || >=22.12.0`. Those versions load ES modules with `require()`, so CommonJS apps keep calling `require("passlet")` unchanged (Node 22.12 prints a one-time `ExperimentalWarning` for it; later 22.x releases don't); only Node 20.15–20.18 and 22.0–22.11 must upgrade (Node 20 itself reached end of life in April 2026). Dropping the CommonJS copy halves the package (`index.cjs` and `index.d.cts` are gone) and removes the dual-package hazard where an app that loaded passlet both ways got two `WalletError` classes, so `instanceof WalletError` and the check that a template belongs to its `Wallet` failed across them.
