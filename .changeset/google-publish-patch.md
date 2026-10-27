---
"passlet": patch
---

Google `publish()` no longer wipes class fields passlet does not set. It used to read the class and write it back whole, so nested fields such as a flight's `origin.gate` and `origin.terminal`, the airline name in `flightHeader`, or an event's `dateTime.doorsOpen` were lost, and a gate change made in the Google console or by another system was undone (and could notify holders). `publish()` now patches the class in one request: the fields passlet owns are written or cleared, everything else stays as it is.
