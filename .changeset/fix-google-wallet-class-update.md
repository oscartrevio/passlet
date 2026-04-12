---
"passlet": patch
---

Fix Google Wallet class updates rejecting with `Invalid review status Optional[APPROVED]` or `Review status must be set`. The class update now properly merges the existing remote class using a `PUT` request and normalizes the `reviewStatus` attribute to `UNDER_REVIEW`.