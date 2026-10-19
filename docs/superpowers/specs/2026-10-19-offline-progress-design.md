# Offline progress

- **Date:** 2026-10-19
- **Issue:** #41 — "Offline / idle progress (optional)"
- **Status:** Approved design (requested by the maintainer)

## Context / problem

Closing the tab stops everything: drones and outposts earn nothing while the game is closed. The issue asks for a
capped, simplified estimate of drone income on load, a summary, and a setting to turn it off.

## Design

- **When.** `GameSession` credits offline progress whenever it loads a slot: at startup and on ⚙ → Saves → Load.
  The time away is `Date.now() - savedAt` of the slot record, read in `session.ts` (top level, so the sim stays
  free of `Date`). After crediting, the session saves at once, so a reload cannot credit the same absence twice.
- **Pure estimate.** `sim/offline.ts` `offlineGains(state, awaySec)` reads the state only:
  - The time is clamped to `[0, TUNING.offlineCapSec]` (8 h).
  - **Drones** (role `drone`; haulers do not mine) earn
    `dps × offlineUnitsPerDps × offlineEfficiency × yieldMul × seconds` into the bank. `offlineUnitsPerDps` (0.03)
    is the delivery rate per laser dps measured headless in active play; `offlineEfficiency` (0.1) credits a tenth
    of it, since nobody is flying the flagship, docking or taking contracts.
  - The units are split by `droneMix`: the mix of the belts whose band lies within `droneLeash` of the station's
    orbit, weighted by rock count. System modifiers that change a belt's mix carry through.
  - **Outposts** extract at `outpostRate`, never past their reserve. With a hauler in the fleet the output goes to
    the bank (the hauler would ferry it); without one it fills the outpost's storage up to `outpostCapacity`.
- **Apply.** `applyOffline(state, awaySec)` does nothing under `offlineMinSec` (60 s: a reload) or when nothing was
  earned. Otherwise it adds to the bank and `runValue` (as an unload does, so it feeds Horizon Data), updates
  outpost reserves, storage and `automation.extracted`, adds the drone units to the `unitsMined` stat, and pushes a
  `major` log line: `While you were away (3h 05m): fleet banked 412⬢ 160❄.`, with `(cap)` when capped.
- **Summary toast.** `LogEntry` gets an optional `toast: { kicker, title, detail }`; the HUD shows it with the
  achievement toast's styling. Achievement toasts now go through the same `toast(kicker, title, detail)`.
- **Setting.** `offlineProgress` (default on) under ⚙ → Gameplay → Saving.

## Trade-offs

- **No tick replay.** Replaying hours of ticks would stall the load and depend on drones surviving unattended
  (headless runs show idle drones getting destroyed within minutes). A flat rate is predictable and cheap.
- **No RNG, no positions.** Ships, rocks, pickups, run time and every RNG stream are untouched, so the save stays a
  valid mid-tick state and nothing about the run's random sequence moves. The bot never loads a save, so
  `docs/balance.md` is unaffected.
- **No save change.** `savedAt` already exists in every slot record, so `SAVE_VERSION` stays at 11.
- **Not credited:** contracts, the refinery queue, hazards and ship damage. The issue asks for drone income; the
  rest would need the tick.
- **Slot switching counts as time away.** A slot's clock runs from when it was last written, including time spent
  playing another slot. It is the same rule as closing the tab and keeps the session simple.
