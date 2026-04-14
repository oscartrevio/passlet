---
"passlet": major
---

Images are now provider-specific

The shared `logo` and `banner` fields have been removed from the top-level pass config. Use provider-specific image fields instead:

**Apple** (`apple.*`) — accepts `ImageSet` (bytes or URL):
- `apple.logo`
- `apple.strip`

**Google** (`google.*`) — URL only:
- `google.logo`
- `google.hero`

**Migration**

```diff
 wallet.loyalty({
   id: "rewards",
   name: "Rewards Card",
-  logo: "https://example.com/logo.png",
-  banner: bannerBytes,
+  apple: {
+    icon: iconBytes,
+    strip: bannerBytes,
+  },
+  google: {
+    logo: "https://example.com/logo.png",
+    hero: "https://example.com/hero.png",
+  },
 });
```
