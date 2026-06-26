---
"passlet": minor
---

Map Google event fields to structured slots: `seat`/`row`/`section`/`gate` now
populate `eventTicketObject.seatInfo` (rendered in Google's dedicated ticket UI
instead of generic text modules), and a new structured event `venue`
(`{ name, address }`) populates `eventTicketClass.venue`.
