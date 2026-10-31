# Doctrine pairs run log (#50)

- **Date:** 2026-10-31
- **Issue:** #50 — Choice-based research perks
- **Branch:** `cursor/doctrine-perks-387b`
- **Spec:** [`2026-10-31-doctrine-perks-design.md`](../specs/2026-10-31-doctrine-perks-design.md)
- **Plan:** [`2026-10-31-doctrine-perks.md`](2026-10-31-doctrine-perks.md)

## Setup

Node 22.23.4 for `npm run check`. The balance report was generated with Node 24.22.2 on linux x64, the CI runtime. Baseline before the change, on `ce6d0cf`:

```
 Test Files  76 passed (76)
      Tests  1112 passed (1112)
```

## Verification

`npm run check` (format, lint, typecheck, vitest):

```
 Test Files  77 passed (77)
      Tests  1134 passed (1134)
   Start at  02:52:50
   Duration  21.07s (tests 90%, import 8%, transform 2%, worker 1%)
```

`npm run build` and `npm run bundle-size`: 231.81 kB gzip, budget 240 kB.

Browser: new game, Research opens on the Swarm button, Enter chooses it (fleet cap 5 → 6, log line states the trade-off), Tab + Enter swaps to Ace Pilot (cap back to 5, flagship DPS 26 → 33, speed 135 → 124), Shift+Tab and Enter on the locked Swarm button logs `Swarm Doctrine is locked: Ace Pilot is chosen. Respec at warp.` ArrowDown moves focus. Trade-offs are sentences, not colour.

## Deviations

- **Bot pick rule.** The first draft always took side 0. That made every seed the same build, and the early-outpost row (#206) fell to 14/30. Splitting by seed parity (even side 0, odd side 1) is the rule that landed: runs differ, and the report shows both packages. The outpost row is still under its line (13/30, 43%). Every other checked row passes, including the opening (28/30), mid-game active play (54%), fleet utilisation, and the builder share. The row fails because each side taxes damage, speed, or cargo, and the bot warps as soon as it has the fuel, so fewer seeds have outpost output by the end of system 4. Softening two costs made it worse (the bot left sooner). Left as a reported miss rather than a special case in the bot.
- **Allocation budget.** Seed 12345 is odd, so the measured fleet is the Ace / Courier / Brawler package. Mean fell from the previous ~39 KB to ~22 KB. The budget moved from 48 KB to 28 KB, still about 25% over the Node 24 sample.

## Per task

| Task | Result |
| --- | --- |
| 1 Data, stats, command | Effects read the table inside `writeShipStats` and `fleetCap`. One headless test per side. |
| 2 Save v15 | v14 migrates to all-null. `save-v15.json` is seed 4242, hazards on, stopped once system 2 had a second ship, belt trimmed to eight rocks. Round-trips. |
| 3 Panel, bot, docs | Keyboard and the existing gamepad focus cycle (real buttons, not `disabled` while locked). Balance regenerated on Node 24. |
