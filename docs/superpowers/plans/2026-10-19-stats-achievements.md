# Stats and achievements implementation plan (#40)

- **Goal:** lifetime stats in the profile, threshold achievements, an unlock toast and a ⚙ → Stats tab.
- **Architecture:** table in `data/achievements.ts`; counters bumped at their events; `updateAchievements` at the
  end of the tick; save v10 → v11; HUD toast from the log line; new menu tab.
- **Spec:** [`2026-10-19-stats-achievements-design.md`](../specs/2026-10-19-stats-achievements-design.md)

## Global Constraints

Pure, deterministic sim; no RNG draws; no per-tick allocation; a save change bumps `SAVE_VERSION` with a
migration and fixture; `npm run check` green; no new dependencies.

## Review Focus

- The run is unchanged by the feature: same bot run, same `run` and `run.rng.s` as before (Task 1).
- A rejected command counts nothing (Task 1).
- Each achievement unlocks once, even when several thresholds are reached in one tick (Task 1).
- An old save loads with seeded stats; a malformed stat or achievement list is rejected (Task 2).

## Task 1: Stats, achievements and the tick

**Files:** `src/data/achievements.ts`, `src/sim/achievements.ts`, `src/sim/types.ts`, `src/sim/create.ts`,
`src/sim/update.ts`, `src/sim/mining.ts`, `src/sim/handlers.ts`, `src/sim/contracts.ts`, `src/sim/refining.ts`,
`src/sim/hazards.ts`, `src/sim/ships.ts`, `tests/achievements.test.ts`
**Build:** spec §Design stats and achievements.
**Tests:** each counter; rejected commands; single unlock with its log line; every unlock in one pass leaves the
run untouched; progress capping.
**Done when:** - [x] tests pass.

## Task 2: Save v11

**Files:** `src/sim/migrations.ts`, `src/sim/save.ts`, `tests/migrations.test.ts`, `tests/fixtures/save-v10.json`
**Build:** migration 10 → 11 with seeded stats; stats and achievement validation.
**Tests:** fixtures load; seeded values; profile and run otherwise unchanged; first-tick unlocks; malformed data
rejected.
**Done when:** - [x] tests pass.

## Task 3: Toast and Stats tab

**Files:** `src/ui/Hud.ts`, `src/ui/Menu.ts`, `src/ui/menu/StatsTab.ts`, `src/style.css`, `README.md`
**Build:** toast on an achievement log line; Stats tab from pure row helpers; README section.
**Tests:** digit grouping, play-time format, stat rows, achievement order and progress text.
**Done when:** - [x] `npm run check` green.
