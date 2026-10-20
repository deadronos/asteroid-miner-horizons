# Slot expansion

- **Date:** 2026-10-20
- **Issue:** #141 — "Give every hull enough slots to fit each module type at least once"
- **Status:** Implemented

## Goal

Every hull can carry one of each of the six component types, and ships have a long, gradual growth path that
autoupgrade (#140) can follow. Early-game balance must not move.

## Decisions (from the maintainer)

- **Slots are bought per ship**, not granted up front and not unlocked fleet-wide. Hulls keep their starting
  slot counts; a docked ship can expand one slot at a time.
- **Caps:** 6 on every hull, 8 on the Excavator, so the flagship refit still buys room.

## Rules

- `HullDef.maxSlots` is the cap; `HullDef.slots` stays the starting count.
- A ship's slot count is just `ship.slots.length`. Buying a slot pushes `null`, so **the save shape is unchanged**
  and no migration is needed.
- `slotCost(ship)` prices the next slot by its number n: `slotBaseCost × slotCostGrowth^(n − 3)`, rounded per
  resource (`{ ore: 120, ice: 60 }`, ×1.7). The price depends only on the slot number, so a Harvester's 4th slot
  costs the same as a Drone's 4th. Returns null at the cap.
- `buySlot { shipId }` follows the refit rules: docked and alive (`refitBlock`), otherwise a `warn`. Over the cap
  or under-funded is a `warn` too.
- A flagship refit keeps bought slots: the new count is `min(new.maxSlots, max(new.slots, old count))`; parts that
  no longer fit are refunded at half value, as before. Slot purchases themselves are not refunded.

## Balance

The bot never buys slots, so `docs/balance.md` is unchanged (verified: regenerated report is identical apart from
the header). Tuning the slot price is left to play-testing and to #140 once the bot uses autoupgrade.

## UI

The ship panel title shows `n/max slots`; below the slot rows a "New slot" row offers `Buy <cost>` until the cap.
The shipyard tooltip says "N slots (up to M)".
