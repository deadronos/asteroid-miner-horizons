# Suggested next issues

Rewritten 2026-11-21 at v0.14.1, following the November 2026 review (#282). Ordered into actionable batches by
leverage and natural landing boundaries (shared CSS/layout, shared `balance:ci` pass, shared sim/render hot path).
The index of review work is #282; category umbrellas are #277 (code), #278 (performance), #279 (visuals), #280
(UI/UX & accessibility) and #281 (balance, complementing #51). Pre-existing scope work remains under #42 (#173,
#175, #176) and #178. This file is the maintainer's notebook; agents do not edit it unless asked (see AGENTS.md).

## Batch 1 — Quick-win bugs, save safety & layout thrashing (S)

Low-risk, high-signal fixes with tight blast radius; safe to land in one PR wave.

- **#261** — Harden `src/sim/validate.ts` against divide-by-zero (`radius <= 0`, `heatRadius <= starRadius`,
  non-finite refinery totals) and hardcoded flagship hull IDs.
- **#270** — Fix `FleetPanel` toggle tooltips (`btn.title`), gamepad title-screen modal routing (`.modal` before
  `#boot` in `src/input.ts:262`), and `.tooltip` wrapping on narrow viewports.
- **#264** — Cache viewport dimensions on `CameraRig` (eliminating `MapLabels` layout thrashing), cache
  `helpVisible` in `Hud.ts`, dirty-check `bar().set()`, and skip collapsed panel refreshes.

## Batch 2 — HUD layout, accessibility & 3D colour-vision parity (M)

Touches `src/style.css`, HUD panels, and 3D palette wiring together for a cohesive UX/a11y pass.

- **#271** — Stack `.paused`, `.hazard`, `.toasts`, and `#goals` in one flex container anchored to
  `--topbar-bottom`, relocate `.pad-hint` out of `#log`/touch-stick, and fix medium-width `#topbar` overflow.
- **#272** — Add global `:focus-visible`, `@media (prefers-reduced-motion: reduce)`, keyboard-focusable
  `FleetPanel` rows, `Menu` `tablist`/`tab`, `aria-live` regions, `aria-pressed`, and icon-button `aria-label`s.
- **#267** — Drive hardcoded 3D scenery, shader, FX, and ship-overlay colours from `palette()` with live updates,
  and replace the flat `+0.2` rock trait tint with distinct procedural patterns.

## Batch 3 — Balance & progression pass (M–L, single `balance:ci` pass)

Group these so `docs/balance.md` is tuned and regenerated once via `npm run balance:ci`.

- **#275** — Tighten `haulMiner` standoff to cut collision deaths, review slot-3 ice pressure vs disposable
  drones, and add `autoRepair` / `buySlot` / `armor` / `shield` / variant coverage to `scripts/bot.ts`.
- **#276** — Fix the System 2 fuel dip (70 → 65), clamp low-ice RNG outliers, scale derelict salvage with system
  number, differentiate `constructionDrone` from `hauler`, and buff `Survey Array`.
- **#274** — Re-scale Horizon Gate costs into a genuine late-game sink and add cycle scaling / differentiation to
  New Game+.

## Batch 4 — Stress-scale sim & WebGL performance (M)

Targets `npm run bench:stress` (2,000 rocks, 50 ships, 1,000 pickups) and large-fleet frame times.

- **#265** — Add ship/pickup spatial hashing in `SimIndex`, skip pickup sweeps while mining, use `distSq` in
  `magnetPull`, and remove per-tick `rockHash.query` closure & `formationSlot` allocations.
- **#266** — Add `addUpdateRange` + `n === 0` skip to `RockView`'s `InstancePool.commit`, pass read-only
  `SimIndex` views to `Renderer` (`ShipView`/`FxView`), and bypass the half-float MSAA composer on `low` quality.
- **#262** — Move module-global `TICK_CTX`, `beltCounts`, and steering scratch vectors onto `SimIndex`.

## Batch 5 — Visual polish & touch/gamepad parity (M)

Polish pass for game feel, zoom legibility, and non-mouse input completeness.

- **#268** — Fade ship status bars and floating pickup text in map zoom, standardize `wpp` marker widths, and
  clamp asteroid Y-thickness to stop vertical clipping.
- **#269** — Add solar flare `warn` telegraph, dock pulse, laser-variant beam tinting, soft radial DPR-scaled
  particles, damaged-hull derelicts, and lit planet night-side atmospheres / ring banding.
- **#273** — Add gamepad Research/Outpost bindings and range-slider stepping, enlarge touch targets (`>= 36-44 px`),
  replace `window.confirm()` with an in-app modal, and adapt copy to active input mode.

## Batch 6 — Structural refactor before the next pillar (M)

Clean up the largest coordinator files before adding new combat/economy systems.

- **#263** — Decompose `src/input.ts` (remove dead `multi`, add `dispose()`, unify `hud.hasModalOpen()`), split
  `src/sim/pilot.ts` (steering vs drone AI), extract heavy inline handlers from `src/sim/handlers.ts`, and
  evaluate moving browser storage I/O out of `src/sim/save.ts`.

## Next big scope pillars (existing, spec first)

- **#175** — Pirates and combat as the next pillar (large; gives defensive gear from #275 a real combat job).
- **#173** — Contract variety and faction reputation (escort contracts want #175 first).
- **#176** — Station market and trade routes.
