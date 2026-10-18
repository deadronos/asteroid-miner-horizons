# Architecture

## Layers

Six directories, with a one-way dependency flow. `core` and `data` know nothing about the game; nothing below
imports anything above it.

```
                 ┌─▶ src/audio   (Web Audio; imports core + sim)
src/core  ──┐    │
src/data  ──┼─▶ src/sim ──┬─▶ src/render  (three.js; imports core + data + sim)
            │            └─▶ src/ui      (DOM HUD; imports data + sim)
```

- **`src/core`** — primitives with no project knowledge: seeded `rng`, `vec` helpers, `spatialHash`, `array`.
- **`src/data`** — pure tables and values, no logic: resources, components, hulls, perks, refining recipes,
  contracts, modifiers, and the global `tuning.ts` knobs. The tables drive both the sim and the HUD text, so
  one number here changes both.
- **`src/sim`** — the deterministic game: state shapes, rules, generation and AI. No DOM, no three.js.
- **`src/render`** — three.js: camera/zoom/fx, instanced rocks and pickups, ships and beams, particles, system
  scenery, parallax backdrop.
- **`src/ui`** — the DOM HUD, built once per structure change and refreshed in place. `Menu.ts` is the ⚙ modal;
  `menu/` holds its tabs, `panels/` holds the HUD panels.
- The top-level `src/*.ts` files are the wiring: `main.ts` (bootstrap and the frame loop), `input.ts`,
  `settings.ts`, `pause.ts`, `session.ts`.

`src/audio` sits beside the presentation layers: `sfx.ts` holds pure rules for turning sim state into sound,
and `AudioEngine.ts` owns the `AudioContext`.

## The tick

`tick(state, dt, input, index)` in `src/sim/update.ts` runs at a fixed 60 Hz (`TUNING.simHz`) and is decoupled
from the render frame rate by the accumulator loop in `main.ts`. Order of operations, from the module header:

> commands → orbits → rocks → ships (pilot, collide, heat, dock) → pickups → belt regrowth → contracts → refinery.

The frame loop also handles the paused case: while paused it still calls `applyCommands`, so purchases and
refits in an open menu apply immediately.

## Design rules

- **The sim is pure and deterministic.** All randomness goes through `run.rng`, which is stored in the save, so
  the same seed and the same commands replay identically. Renderer particles may use `Math.random`; they are
  cosmetic only.
- **Input and UI never mutate state.** They enqueue `Command`s, which `tick()` applies at the start of the next
  step. Invalid commands are rejected with a log message.
- **The sim emits `out.fx` / `out.log`.** The renderer turns fx into particles and screen shake and the HUD
  drains the log. This outbox is the only sim → presentation channel.
- **Rendering performance.** Asteroids and pickups use `InstancedMesh`: six shared rock shape pools (two per
  kind) plus one pickup pool, so the whole field costs seven draw calls no matter how many rocks exist.
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

The only non-determinism sits at the edges, never inside a tick: `newGame`'s default random seed and the
`savedAt` timestamps in `src/sim/save.ts`.

## Debug hook

`window.__amh` exposes `{ state(), send(cmd), settings, renderer, audio }` for console poking and automated
browser checks. `npm run dev`, then use it from the devtools console.
