---
"passlet": minor
---

Drop `node-forge`, `jose` and `jszip`: passlet now depends only on `zod`. Apple signatures, Google JWTs and `.pkpass` archives are built with Node's own `crypto` and `zlib`, producing the same output as before. This also removes the `node-forge` security advisory from your dependency tree.

Other changes:

- CommonJS consumers now get the CommonJS type declarations (`index.d.cts`); before, `require("passlet")` resolved ESM types.
- Google `privateKey` now also accepts a PKCS#1 (`BEGIN RSA PRIVATE KEY`) PEM.
- `engines` now declares Node.js `>=20.15`.
