---
"passlet": patch
---

Treat event and flight display datetimes as local venue/airport wall-clock
time. `startsAt`/`endsAt`/`departure`/`arrival` now accept ISO datetimes with or
without a UTC offset; any offset is preserved for Apple semantics and stripped
for Google (which derives the timezone from the venue/airport and rejects an
offset on flight times). This fixes flight class creation when an offset was
provided and removes the previous UTC-relabelling ambiguity.
