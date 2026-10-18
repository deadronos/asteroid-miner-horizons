# Hazards: comets and solar flares

- **Date:** 2026-10-19
- **Issue:** #37 — "Hazards: comets, solar flares (later pirates)"
- **Status:** Approved design (MVP scope: comets + flares; pirates deferred)

## Context / problem

The only dangers are star heat and collisions above `collisionMinSpeed`. Shields, armor and engines therefore
have almost nothing to do once a player stops flying into rocks. #37 proposes comets that cross the belts
(mineable, fast, dangerous) and solar flares near M/B stars with a warning and a shield-based mitigation window.

Acceptance criteria:

1. Hazards are telegraphed.
2. Toggle or difficulty option.
3. Deterministic.

## Goals

- **Comets**: a seeded, fast, heavy rock that crosses the system on a straight line through a belt. It is a real
  `Rock`, so mining, cracking, pickups, collisions and rendering reuse the existing code. A collision at comet
  speed hurts; cracking one pays well.
- **Solar flares**: only in M- and B-class systems. A warning phase, then a short active phase that damages every
  undocked ship within the flare's reach, falling off with distance from the star. Shields soak it first (the
  existing `damageShip` path), and docking at the station is full shelter — that is the mitigation window.
- **Telegraphing**: every hazard has a warning phase with a log line, an alarm sound, a HUD banner with a
  countdown, and a world-space cue (the comet's predicted path; the star brightening).
- **Difficulty**: a `hazards` setting — `off`, `normal`, `harsh` — passed into each tick like `assists`.
- **Determinism**: all hazard rolls come from a dedicated `run.hazards.rng` stream derived from `(seed, system)`.
  With hazards `off`, the sim is byte-identical to today: `run.rng`, rock layout, ids and the balance report do
  not move.

## Non-goals

- Pirates (needs combat components; a later issue).
- Teaching the balance bot or drone AI to dodge or shelter. The harness runs with hazards off by default; a
  one-off measurement with hazards on is recorded in the run log. Drone flare-sheltering is a follow-up.
- Comets cracking belt rocks they pass through, or comets colliding with planets.
- A per-save difficulty. Like `assists`, the level is a player preference.

## Design

### Data (`src/data/tuning.ts`, `src/data/hazards.ts`)

`src/data/hazards.ts` (pure leaf; may import `StarClass`-like literals only, so it declares its own
`'M' | 'G' | 'B'` key type or uses a string record):

```ts
export type HazardLevel = 'off' | 'normal' | 'harsh';
/** Per-level multipliers: interval (× seconds between hazards) and damage (× flare dps, × comet speed). */
export const HAZARD_LEVELS: Record<HazardLevel, { interval: number; damage: number }>;
// off: unused; normal: { interval: 1, damage: 1 }; harsh: { interval: 0.65, damage: 1.4 }

/** Flare profile per star class; G has none. */
export const FLARES: Partial<Record<'M' | 'G' | 'B', { interval: [number, number]; dps: number; reach: number }>>;
// M: { interval: [110, 170], dps: 10, reach: 1300 }  — frequent, weak
// B: { interval: [170, 250], dps: 22, reach: 1700 }  — rare, strong
```

`TUNING` gains (one comment each): `hazardMinSystem: 2`, `hazardFirstDelay: 75` (seconds of grace at the start
of a run before any hazard), `cometInterval: [140, 220]`, `cometWarning: 8`, `cometSpeed: 130`,
`cometEdge: 3200` (spawn/despawn radius), `cometHpMul: 1.6`, `cometYieldMul: 3`, `flareWarning: 10`,
`flareDuration: 6`.

### State (`src/sim/types.ts`) and save v5 → v6

```ts
export interface CometWarning {
  /** Where the comet will appear (on the `cometEdge` circle). */
  from: Vec2;
  /** Velocity it will have; the renderer draws the predicted path from `from` along this. */
  vel: Vec2;
  /** Belt index it is aimed through. */
  belt: number;
  /** Seconds until it appears. */
  timeLeft: number;
}

export interface Flare {
  phase: 'warning' | 'active';
  /** Seconds left in the current phase. */
  timeLeft: number;
}

export interface Hazards {
  /** Dedicated stream: hazard rolls never touch run.rng. */
  rng: Rng;
  /** Seconds until the next comet warning. */
  cometTimer: number;
  comet: CometWarning | null;
  /** Seconds until the next flare warning; unused in G systems. */
  flareTimer: number;
  flare: Flare | null;
  /** Counts this run (balance metrics, HUD). */
  comets: number;
  flares: number;
}
```

- `Run.hazards: Hazards`. `Rock.comet?: true` marks a live comet (and is absent on every other rock, so
  existing saves and snapshots are unchanged).
- `newHazards(seed, number)` in `src/sim/hazards.ts` builds the board: `rng = makeRng((seed ^ 0x51ed270b) +
  number * 2654435761 >>> 0)` (any constant distinct from contracts/modifiers), `cometTimer = hazardFirstDelay +
  range(rng, 0, 30)`, `flareTimer = hazardFirstDelay + range(rng, 20, 60)`, nulls and zero counts.
- `newRun` sets `run.hazards = newHazards(profile.seed, number)` **after** everything that draws from `run.rng`
  (it draws only from its own stream, so placement does not matter for determinism, but keep it last for
  readability).
- `SAVE_VERSION` 5 → 6. `migrations[5]` sets `d.run.hazards = newHazards(d.profile.seed, d.run.system.number)`.
  `fromData` validates `run.hazards` (object, `rng.s` number, `cometTimer`/`flareTimer` finite numbers,
  `comet`/`flare` null or objects with a finite `timeLeft`). Fixture `tests/fixtures/save-v5.json`.

### Tick integration (`src/sim/hazards.ts`, `src/sim/update.ts`)

`TickInput.hazards?: HazardLevel` (default `'off'` when absent, so every existing test and the harness are
unchanged). New tick order:

> commands → orbits → rocks (comets fly straight) → **hazards** → ships (pilot, collide, heat, flare, dock) →
> pickups → belt regrowth → contracts → refinery.

`updateHazards(state, dt, level)` runs once per tick, before `index.rebuild` so a comet that appears this tick is
in the spatial hash:

1. **Always** (any level): despawn comets that are beyond `cometEdge + 200` and moving outward (dot(pos, vel) >
   0). This must run even when `off`, so a comet in flight when the player switches hazards off still leaves.
2. If `level === 'off'` or `system.number < hazardMinSystem`: clear `comet` and `flare` to null and return.
   Timers do not advance.
3. **Comet**:
   - `cometTimer -= dt`; when ≤ 0 and no warning pending, roll a `CometWarning`: pick a belt index, a crossing
     point `P` at the belt's mid radius and a random angle, an entry angle on the `cometEdge` circle; `vel =
     normalize(P − from) × cometSpeed × level.damage`. Reject (and reroll, up to 8 times, then accept) a path
     whose closest approach to the star is under `heatRadius + 150` — a comet should threaten the belts, not die
     in the star. Push `log warn` ("☄ Comet inbound — crossing the <inner|middle|outer> belt in 8s.") and fx
     `{ t: 'hazard', kind: 'comet', phase: 'warn' }`. Reset `cometTimer = range(cometInterval) × level.interval`.
   - Warning pending: `timeLeft -= dt`; when ≤ 0, spawn the comet rock at `from` with `vel`, `comet: true`,
     kind `'ice'`, size 0, radius `range(hazards.rng, 34, 44)`, `hp = rockHp(radius, 'ice') × cometHpMul`, units
     `round(rockYieldK × r² × richness × cometYieldMul)`, `belt = warning.belt`, id from `run.nextId++` (it lives
     in `run.rocks`, so it must share the rock id space; with hazards off no id is ever taken). `comets += 1`.
     Fx `{ t: 'hazard', kind: 'comet', phase: 'start', pos }`. `comet = null`.
   - **No draw from `run.rng`** — `makeRock` draws from `run.rng`, so the comet rock is built directly.
4. **Flare** (only when `FLARES[starClass]` exists):
   - No flare: `flareTimer -= dt`; when ≤ 0, `flare = { phase: 'warning', timeLeft: flareWarning }`, log warn
     ("☀ Solar flare building — dock or get clear of the star within 10s."), fx `hazard/flare/warn`.
   - Warning ends → `phase: 'active', timeLeft: flareDuration`, log major-ish warn ("☀ Solar flare!"), fx
     `hazard/flare/start`.
   - Active ends → `flare = null`, `flares += 1`, `flareTimer = range(interval) × level.interval`, log info
     ("Flare subsided.").

**Comet motion** (rocks loop in `update.ts`): a rock with `comet` skips the orbit-settle blend and just
integrates `pos += vel × dt`. Fragments of a cracked comet are ordinary rocks (no `comet` flag) and settle into
the belt, which is the reward and a nice visual.

**Comet collision** (`collideRocks`): unchanged damage formula — at ~130 u/s relative speed it deals ~40 before
shields/armor, ~60 harsh. Two changes: a comet is not shoved by the ship (skip the `push` on `r.comet`), and the
ship's bounce uses the comet's velocity as is (already relative). No other path needs changes: mining, cracking
and pickups work because it is a `Rock`.

**Flare damage** (in `updateShip`, next to star heat): while `flare.phase === 'active'` and the ship is alive and
not docked, `k = clamp01(1 − (dStar − starRadius) / (reach − starRadius))`; if `k > 0`, `damageShip(state, ship,
dps × level.damage × k × dt)`. Shields absorb first. The level used is the tick's `level`; when hazards are off
the flare is null so nothing applies.

### Outbox

`Fx` gains `{ t: 'hazard'; kind: 'comet' | 'flare'; phase: 'warn' | 'start'; pos?: Vec2 }`. The renderer and
audio switch on it; anything else ignores it.

### Presentation

- **Settings**: `hazards: HazardLevel` (default `'normal'`) in the Gameplay tab as a select ("Hazards: Off /
  Normal / Harsh"). `SettingsStore.merge` must reject an unknown string (typeof check alone would accept any
  string — validate against the three values). `main.ts` passes `hazards` into `tick` like `assists`.
- **HUD banner**: a pure `hazardBanner(run): string | null` in `src/ui/` (tested), e.g. `☄ Comet inbound · 6s`,
  `☀ Flare building · 8s`, `☀ SOLAR FLARE · 4s`; null when nothing is pending. Shown in the top bar (or a small
  banner element beneath it), refreshed in place, keyed so it does not rebuild every frame.
- **Renderer**: during a comet warning, a dashed/fading line from `from` along `vel` (length ≈ 2 × cometEdge),
  scaled with world-units-per-pixel like other overlays. Live comets get a particle tail opposite their velocity
  (cosmetic `Math.random` is allowed in render). `hazard` fx: comet `start` → small burst; flare `warn` → nothing
  extra (banner + alarm); flare `start` → screen shake (respecting the shake setting via the existing shake
  path) and a star-glow boost while `flare.phase === 'active'`.
- **Audio**: `hazard` fx with phase `warn` plays the `alarm` preset once (rate-limited as today); `start` plays
  `impact` (flare) or nothing (comet). `alarmLevel` additionally returns a moderate urgency while the selected
  ship is inside an active flare's reach.

## Testing

- `tests/hazards.test.ts`:
  - `newHazards` is deterministic per `(seed, system)` and does not touch `run.rng`.
  - With `hazards: 'off'` (or absent), 20 000 ticks produce state identical to a run without the feature:
    `run.rng.s`, rock count and ids unchanged, `hazards.comet/flare` null, timers unchanged.
  - With `'normal'`, the same seed and commands replay byte-identically (serialize twice).
  - Hazard scheduling never draws from `run.rng`: call `updateHazards` directly across the tick that issues a
    warning, the tick that spawns a comet and a full flare cycle, and assert `run.rng.s` is unchanged.
  - A comet warning precedes the comet rock by `cometWarning` seconds; the comet's path misses the heat zone;
    the comet flies straight (velocity constant, ignoring collisions) and is removed past the edge.
  - Switching to `'off'` mid-flight: the comet still leaves; pending warnings are cleared.
  - A ship in a comet's path takes collision damage; cracking a comet yields fragments without `comet` and
    conserves units.
  - Flares: none in G systems; in M/B, warning then active; an undocked ship near the star loses shield before
    hull; a docked ship takes nothing; damage is zero beyond `reach`.
  - `hazardMinSystem`: system 1 never schedules.
- `tests/migrations.test.ts`: v5 fixture upgrades with a valid `hazards`; every older fixture still loads.
- `tests/settings.test.ts`: `hazards` defaults to `'normal'`; an invalid stored value falls back.
- `tests/audio.test.ts` / UI seam tests for the banner text and the sfx mapping.
- `alloc.test.ts` stays green (hazard update allocates only on events, never per tick).

## Risks

- **Comet ids from `run.nextId`** shift later rock ids once a comet spawns. Only with hazards on; the balance
  harness runs with them off, so the report does not move. Accepted.
- **Cracking a comet draws `run.rng`** (fragment radii, pickup scatter), like any rock. Only with hazards on.
- **Drones die in flares** because the AI does not shelter. Mitigated by the warning + `off` setting; drone
  sheltering is a follow-up.
- **Settings vs determinism**: the level is an input, not state, so a replay must pass the same level — the same
  contract `assists` already has.
