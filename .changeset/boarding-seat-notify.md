---
"passlet": patch
---

On Google air boarding passes, the `seat` field is now sent as `boardingAndSeatingInfo.seatNumber`, shown in the card's seat slot, so `wallet.update(serial, { notify: true })` can notify the holder of a seat change.
