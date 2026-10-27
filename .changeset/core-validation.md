---
"passlet": major
---

**Breaking.** Validation no longer bundles `zod/mini`: passlet checks templates and content with its own small validator. `dist/index.js` is 43% smaller than in 3.2.0 (205 KB → 116 KB, 33 KB gzipped), `import("passlet")` takes 15 ms instead of 25 ms, and building a template takes a quarter of the time. Unknown keys are still dropped and every default still applies; what changed for you:

- Messages are passlet's own, in English, and name the failing path once: `barcode.format: must be one of "QR", "PDF417", …`, `id: must not be empty` (was `TemplateConfig missing: id`), `google.valueAdded: accepts at most 10 entries`. A problem with the content as a whole reads `content: …`. `issues` still lists every failing path.
- `expiresAt`, `validFrom` and Google message `displayInterval` dates now take any W3C timestamp, as Apple and Google do: a UTC offset (`"2026-12-09T13:00:00-07:00"`) and minute precision (`"2026-12-09T13:00-07:00"`) were rejected before. A time zone is still required. `startsAt`, `endsAt`, `departure` and `arrival` also take minute precision with a zone.
- Apple image URLs must be `http:` or `https:`, since passlet downloads them. Google `links[].uri` and `valueAdded[].uri` must carry a scheme (`https:`, `tel:`, `mailto:`, `geo:`, an app deep link), as Google requires; an empty string was the only thing rejected before.
- A beacon `proximityUUID` may be any 8-4-4-4-12 hex UUID, not only RFC 9562 versions, and email options take any `name@domain.tld`.
- An Apple `relevantDates` entry with both `date` and `startDate`/`endDate` is rejected at that entry, since Apple defines each entry as one or the other; it was read as `{ date }` before.
