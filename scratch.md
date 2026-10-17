# Suggested next issues (after #11)

All nine children of #11 have landed (#2–#10, last one PR #60), so the code cleanup is finished. The earlier "measuring tools" and "quick wins" picks are done too: #12, #43, #19, #21, #22, #29, #30.

## 0. Housekeeping (5 min)

- Close umbrella **#11**. Its body already says "Complete."
- Tick the closed children in the other umbrellas, whose checklists are out of date: #18 (#12), #28 (#19, #21, #22), #34 (#29, #30), #51 (#43).

## 1. Next up: #35 Station contracts → #36 Refining

- Both are ⭐ and `priority: high` in #42. The core loop works, but the mid-game has no goals, and this is now the biggest gap.
- The groundwork is in place: the handler map (#7) makes new commands like accept/deliver contract a single entry, data-driven effects (#6) and save migrations (#8) let new state be added without breaking saves, and the split Menu/HUD (#2, #3) gives contracts their own tab or panel.
- The balance bot (#43) can measure the extra income from contracts before we tune reward sizes.
- Order: contracts first, then refining (ore→alloy, ice→fuel). Refined goods make better contract targets.

## 2. Then: #47 System modifiers + #44 Warp cost vs income

- #47 is the other ⭐ / `priority: high` pick (in #51). It adds variety to each warp, so systems stop playing the same.
- In the current `docs/balance.md`, time per system grows (system 5 takes 16:12, 1.48× the previous system). Warp cost is outpacing income, so #44 should be tuned alongside #47 using the bot report.
- Doing this after contracts/refining means the tuning accounts for the new income sources.

## 3. Ongoing / fill-in work

- **Performance #13 (per-tick allocations) → #14–#16.** The benchmark (#12) is in CI, so we can measure. The game still holds 60 fps, so this isn't urgent, but it should land before #39 (hauler drones/outposts) grows the entity count.
- **Audio #31 (laser hum + low-hull alarm).** Small, builds on the #29/#30 engine, touches nothing else. A good break from bigger work.

**If you only want one thing:** #35 Station contracts.
