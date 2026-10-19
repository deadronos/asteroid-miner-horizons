# Offline progress implementation plan (#41)

- **Goal:** credit a capped, simplified estimate of drone and outpost income when a save loads, show a summary,
  and let the player turn it off.
- **Architecture:** pure estimate in `sim/offline.ts`; tuning knobs in `data/tuning.ts`; `GameSession` applies it
  on load from the slot's `savedAt`; a toast field on `LogEntry`; a Gameplay setting.
- **Spec:** [`2026-10-19-offline-progress-design.md`](../specs/2026-10-19-offline-progress-design.md)

## Global Constraints

Pure, deterministic sim with no `Date` or RNG draws in `src/sim`; no save shape change; `npm run check` green; no
new dependencies; `scratch.md` and `docs/balance.md` untouched.

## Review Focus

- The estimate cannot be credited twice for one absence (Task 2: the session saves after crediting).
- The cap and the minimum absence hold; negative clock skew credits nothing (Task 1).
- RNG streams, rocks, ships and run time are untouched (Task 1).
- Outposts never extract past their reserve or overfill storage without a hauler (Task 1).

## Task 1: The estimate

**Files:** `src/sim/offline.ts`, `src/data/tuning.ts`, `src/sim/types.ts`, `tests/offline.test.ts`
**Build:** spec §Design pure estimate and apply.
**Tests:** no fleet earns nothing; drone rate and mix; yield perk; cap; out-of-range belts; outposts with and
without a hauler; bank, run value and stat credited; summary text; short absence is a no-op; RNG untouched.
**Done when:** - [x] tests pass.

## Task 2: Session, setting and toast

**Files:** `src/session.ts`, `src/settings.ts`, `src/ui/menu/SettingsTabs.ts`, `src/ui/Hud.ts`, `README.md`,
`tests/offline.test.ts`
**Build:** credit on startup and on load, then save; `offlineProgress` setting; toast from the log line.
**Tests:** credited once across a reload; credited on a menu load; nothing when the setting is off.
**Done when:** - [x] `npm run check` green.
