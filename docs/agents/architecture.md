# Architecture

## Layers

Six directories, with a one-way dependency flow. `core` and `data` know nothing about the game; nothing below
imports anything above it. The exact import rules, including the top-level `settings.ts` and `session.ts` that
the presentation layers read, are in [`repo-structure.md`](repo-structure.md#what-may-import-what).

```
                 ┌─▶ src/audio   (Web Audio)
src/core  ──┐    │
src/data  ──┼─▶ src/sim ──┬─▶ src/render  (three.js)
            │            └─▶ src/ui      (DOM HUD)
```

- **`src/core`** — primitives with no project knowledge: seeded `rng`, `vec` helpers, `spatialHash`, `array`,
  `format`, and the touch `gesture` maths.
- **`src/data`** — pure tables and values, no logic: resources, components, hulls, perks, refining recipes,
  contracts, modifiers, hazards, rock traits, achievements, and the global `tuning.ts` knobs. The tables drive
  both the sim and the HUD text, so one number here changes both.
- **`src/sim`** — the deterministic game: state shapes, rules, generation and AI (drones, haulers, outposts),
  hazards, warp routes, achievements, offline progress, and save validation. No DOM, no three.js.
- **`src/render`** — three.js: camera/zoom/fx, instanced rocks, pickups and debris, ships and beams, particles,
  system scenery, parallax backdrop, adaptive quality and WebGL context-loss recovery.
- **`src/ui`** — the DOM HUD, built once per structure change and refreshed in place. `Menu.ts` is the ⚙ modal;
  `menu/` holds its tabs, `panels/` holds the HUD panels. `TitleScreen.ts` is the boot screen and
  `TouchControls.ts` the on-screen controls for touch devices.
- The top-level `src/*.ts` files are the wiring: `main.ts` (bootstrap and the frame loop), `input.ts`,
  `settings.ts`, `pause.ts`, `session.ts`, `reloadGuard.ts`, `debugHook.ts` (whether `window.__amh` is attached).

`src/audio` sits beside the presentation layers: `sfx.ts` holds pure rules for turning sim state into sound,
`music.ts` the pure per-star-class music rules, `AudioEngine.ts` owns the `AudioContext`, and `MusicPlayer.ts`
schedules the generative music into its music bus.

## The tick

`tick(state, dt, input, index)` in `src/sim/update.ts` runs at a fixed 60 Hz (`TUNING.simHz`) and is decoupled
from the render frame rate by the accumulator loop in `main.ts`. Order of operations, from the module header:

> commands → orbits → rocks → hazards → outposts → ships (pilot, collide, heat, dock) → pickups → belt regrowth →
> contracts → refinery → achievements.

The frame loop also handles the paused case: while paused it still calls `applyCommands`, so purchases and
refits in an open menu apply immediately.

## Design rules

- **The sim is pure and deterministic**, so a seed and a command stream replay identically. The rules and the
  RNG-stream pattern that keep it that way are in [`sim-conventions.md`](sim-conventions.md#purity). Renderer
  particles and debris may use `Math.random`; they are cosmetic only.
- **Input and UI never mutate state.** They enqueue `Command`s, which `tick()` applies at the start of the next
  step; the recipe is in [`sim-conventions.md`](sim-conventions.md#adding-a-command).
- **The sim emits `out.fx` / `out.log`.** The renderer turns fx into particles and screen shake and the HUD
  drains the log. This outbox is the only sim → presentation channel.
- **Rendering performance.** Asteroids and pickups use `InstancedMesh`: six shared rock shape pools (two per
  kind), one pickup pool and one debris ring buffer, so the whole field costs a fixed handful of draw calls no
  matter how many rocks exist.
  Collision, AI and avoidance queries go through a spatial hash rebuilt each tick. Overlays (beams, rings, bars)
  scale with world-units-per-pixel so they stay crisp at any zoom.
- **Tuning lives in `src/data/*`.** Component, hull and perk tables drive both the sim and the HUD text.

## The two important boundaries

- **`SimIndex`** (`src/sim/index.ts`) is per-session derived state: the rock spatial hash, a rock id map,
  each ship's stats with the current system's modifiers applied, and scratch vectors. It is rebuilt every tick,
  never persisted, and its instances are reused to avoid per-tick allocation (there is a test for this).
- **`GameState`** (`src/sim/types.ts`) is plain JSON-serialisable data — no classes, no `Map`s — so a save is
  `JSON.stringify` of `{ version, profile, run }`. Transient output lives in `out` and is not persisted. A
  `Profile` survives warps; a `Run` is one star system's progress and is rebuilt on every warp.

## Debug hook

`window.__amh` exposes `{ state(), send(cmd), settings, renderer, input, audio, autoQuality, info(), title }` for
console poking and automated browser checks. `main.ts` attaches that same object through `installDebugHook`
(`src/debugHook.ts`) when the gate is open. A plain production load leaves `window.__amh` unset.

It is on in a dev build (`npm run dev`). A production build (`npm run preview`, the GitHub Pages deploy) opts in
when the `debug` query parameter is present (`/?debug` or `?debug=1`; any present value counts) or when the
`localStorage` key `asteroid-miner-horizons/debug` is `'1'`. Browser tests (#129) should open the built page
with `?debug` — that needs no setup script and survives `location.reload()` — or set the storage key before
navigation (`localStorage.setItem('asteroid-miner-horizons/debug', '1')`) when the URL cannot change. Either
way the full hook is attached. A missing or blocked store leaves it off.
