# ⛏️ Asteroid Miner Horizons

A top-down sci-fi mining sim rendered with Three.js. Fly a prospector ship through a
procedurally generated star system, crack asteroids with a mining laser, haul ore and
ice back to the station, fit your hulls with components, build a drone fleet, then
warp to a fresh system and spend Horizon Data on permanent research.

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # headless sim tests (vitest)
npm run build      # typecheck + production build into dist/
npm run preview    # serve the production build
npm run lint       # oxlint (warnings fail); npm run lint:fix auto-fixes
npm run format     # oxfmt formats in place; format:check only verifies
npm run check      # everything CI runs except the build
npm run bench      # headless tick benchmark: mean/p95 ms per tick
npm run balance    # bot plays 10 seeds × 5 warps → docs/balance.md
```

Linting and formatting use the [Oxc](https://oxc.rs) toolchain: `oxlint` (config in
`.oxlintrc.json`) and `oxfmt` (config in `.oxfmtrc.json`, Prettier-compatible options).
GitHub Actions (`.github/workflows/ci.yml`) runs format check, lint, typecheck, tests and the
build on every push to `main` and on every pull request. For editor integration, install
the Oxc extension (VS Code / Cursor). It picks up both config files.

Requires Node 20+. Built with TypeScript 7, Vite 8 and three r186.

## How to play

| Input                      | Action                                                                                           |
| -------------------------- | ------------------------------------------------------------------------------------------------ |
| `WASD` / arrows            | Fly the selected ship directly (cancels its order)                                               |
| Click empty space          | Move order (autopilot steers around rocks)                                                       |
| Click asteroid             | Mine: the ship closes to laser range and burns it; it automatically moves on to the fragments    |
| Click station              | Dock and unload cargo into the station bank                                                      |
| Click ship / `Tab` / `1–9` | Select a ship                                                                                    |
| Right-click                | Order the selected ship without changing the selection                                           |
| Mouse wheel                | Zoom (toward the cursor when not following)                                                      |
| Drag                       | Pan (camera stops following) · `F` follows again                                                 |
| `M`                        | System map toggle                                                                                |
| `R`                        | Research (prestige) panel · `P` pause · `H` hides help · `Esc` closes menus, else stops the ship |
| ⚙ button                   | Menu: save slots, settings, key rebinding                                                        |

All keys can be rebound in ⚙ → Controls.

**The loop:** mine → collect debris (fly close; the tractor pulls it in) → dock to unload
→ spend the bank on components and ships → automate with drones → stockpile ice → warp.

## Game systems

- **Star systems** are generated from `(profile seed, system number)`. Each has a star
  (M, G or B class, whose heat zone damages ships), 3–5 planets with moons and
  occasional rings, an ore-rich inner belt, an ice-rich outer belt and, from system 3 on,
  a crystal belt. The station orbits between the belts. Belts slowly regrow out of sight.
- **Asteroids** come in large, medium and small. Cracking passes 70% of a rock's units
  to its fragments (3 for a large, 2 for a medium) and drops the rest as debris; small
  rocks drop everything. Units are conserved (there's a test for this). Crystal rocks
  are tougher and only appear after the first warp.
- **Hulls & slots**: every ship has a hull (base stats plus N generic slots). Each slot
  takes one component at tier 1–3: Mining Laser, Ion Engine, Deflector Shield,
  Composite Armor, Cargo Pod, or Sensor & Tractor Array. Effects stack, so two lasers
  give twice the DPS. Refits, repairs and scrapping require the ship to be docked.
  Removing a part refunds half its value.
- **Fleet**: buy Mining Drones (2 slots) or Harvesters (3 slots). Drones auto-mine, sweep
  up debris and return to unload when full. In **Assist** mode they work near the
  flagship; in **Auto** mode they work near the station. Select one to give it manual
  orders. The flagship can be refitted onto the 6-slot **Excavator** hull.
- **Damage**: collisions above a speed threshold and star heat hit shields first, then
  hull. Armor reduces damage. A lost flagship is rebuilt at the station (its cargo is
  lost); lost drones are gone.
- **Warp / prestige**: warping costs ice from the bank, and the cost rises 35% per warp.
  It resets the bank, ships and components and generates the next system. It grants
  **Horizon Data** = ⌊√(value delivered this run / 60)⌋. Research spends it on permanent
  perks: yield, laser damage, speed, fleet capacity, a starter kit, and cheaper warps.
- **Saves**: the ⚙ menu has three save slots in `localStorage`. The running game
  autosaves to its slot every 10 s and when the tab is hidden or closed. Filled slots can
  be loaded, exported as text (to copy) or downloaded as a `.json` file, and deleted. The
  running slot can instead be restarted as a new game. Empty slots can start a new game,
  import a `.json` file, or take pasted save text. Imports are validated and give a
  readable error. The ⚙ menu also has a Controls tab.
- **Settings** (⚙ menu, stored separately from saves so they apply to every slot):
  - _Gameplay_: pause while menus are open or the window is unfocused (P pauses
    manually; menus keep working while paused), autosave interval, confirmations, and
    the autopilot assists (rock avoidance, drone auto-unload, fragment chaining).
  - _Graphics_: Low/Medium/High quality (resolution cap, star and particle density),
    nebula, anti-aliasing (applies on reload), screen shake, FPS counter.
  - _Interface_: HUD scale, always-on ship bars, help box, event log verbosity, camera
    follow, zoom speed, edge panning.
  - _Controls_: rebind every action (primary + secondary key). A key bound to another
    action is moved, and the help box follows your bindings.
  - _Audio_: volume sliders reserved for when sound arrives.

## Architecture

```
src/
  core/      rng (seeded mulberry32), vec helpers, spatial hash
  data/      pure data: resources, components, hulls, perks, tuning knobs
  sim/       deterministic simulation — no DOM, no three.js
    types.ts     JSON-serialisable GameState (profile + run + transient outbox)
    create.ts    new game / new run (per system)
    generate.ts  star systems, belts, rock spawning
    commands.ts  Command union + validation; the only way input changes state
    economy.ts   read-only queries (costs, "why is this disabled")
    pilot.ts     steering, obstacle avoidance, orders, drone AI
    mining.ts    laser damage, cracking, debris drops
    ships.ts     derived stats, damage, ship construction
    update.ts    fixed-step tick
    save.ts      save slots, import/export format + validation
  render/    three.js: Renderer (camera/zoom/fx), instanced rocks & pickups,
             ships + beams, particles, system scenery, parallax backdrop
  ui/        DOM HUD built once per structure change, refreshed in place;
             Menu.ts is the ⚙ modal (Saves, Gameplay, Graphics, Interface, Controls, Audio)
  input.ts   keyboard/pointer → Commands via rebindable actions; world-space picking
  settings.ts  preferences store (defaults, validation, key bindings)
  main.ts    bootstrap + 60 Hz fixed-step loop
tests/       vitest: determinism, mass conservation, mining loop, progression,
             warp, save round-trip + import validation, save slots, settings + key
             rebinding, assist toggles, autopilot
```

Design rules:

- **The sim is pure and deterministic.** All randomness goes through `run.rng`, which is
  stored in the save, so the same seed and commands replay identically. The renderer's
  particles may use `Math.random`; they are cosmetic only.
- **Input and UI never mutate state.** They enqueue `Command`s, which `tick()` applies at
  the start of the next step. Invalid commands are rejected with a log message.
- **The sim emits `out.fx` / `out.log`.** The renderer turns fx into particles and screen
  shake, and the HUD drains the log.
- **Rendering performance**: asteroids and pickups use `InstancedMesh` (7 draw calls
  for everything). Collision, AI and avoidance queries go through a spatial hash
  rebuilt each tick. Overlays (beams, rings, bars) scale with world-units-per-pixel
  so they stay crisp at any zoom.
- **Tuning** lives in `src/data/*`. Component, hull and perk tables drive both the sim
  and the HUD text.

`window.__amh` exposes `{ state(), send(cmd) }` for console poking and automated checks.

## Ideas for later

Pirates and combat modules, trade contracts at the station, idle/offline progress,
more hull classes and specialised drones (haulers, escorts), sound, touch/pinch controls.
