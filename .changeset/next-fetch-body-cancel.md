---
"passlet": patch
---

Fix Google `create()` hanging inside Next.js when the pass's class doesn't exist yet, and failed Google requests hanging instead of throwing. Next.js's patched `fetch` hands back one branch of a teed body, and awaiting `cancel()` on that branch never settles. Passlet now releases response bodies it won't read without waiting on them. Apple image fetch failures do the same.
