---
"passlet": patch
---

The published build now imports Node built-ins by their `node:` names (`node:crypto`, `node:zlib`, `node:stream`, `node:http2`) instead of bare `crypto`, `zlib` and `stream`. Bundlers and runtimes that resolve a bare `crypto` or `stream` to a polyfill or an npm package now get Node's own modules, as passlet's "Node built-ins only" promise intends. Every Node version passlet supports resolves these names; nothing changes for code that already runs on Node.
