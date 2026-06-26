---
"passlet": minor
---

Add an optional `origins` field to `GoogleCredentials`. When set, it is included
as the `origins` claim in the "Add to Google Wallet" JWT — required for the
embeddable web save button to render.
