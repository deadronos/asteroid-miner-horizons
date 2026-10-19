# ⛏️ Asteroid Miner Horizons

A top-down sci-fi mining sim rendered with Three.js. Fly a prospector ship through a
procedurally generated star system, crack asteroids with a mining laser, haul ore and
ice back to the station, fit your hulls with components, build a drone fleet, then
warp to a fresh system and spend Horizon Data on permanent research.

**Play it online:** <https://deadronos.github.io/asteroid-miner-horizons/>

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
build on every push to `main` and on every pull request. Releases are tag-driven: pushing a `v*`
tag runs `.github/workflows/release.yml`, which repeats those checks, builds once, publishes that
build to GitHub Pages and cuts a GitHub Release with the build attached. Nothing else publishes —
`main` is never live. For editor integration, install the Oxc extension (VS Code / Cursor). It
picks up both config files.

Requires Node 22.12+. Built with TypeScript 7, Vite 8 and three r186.

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
→ spend the bank on components and ships → automate with drones → refine ice into fuel → warp.

## Game systems

- **Star systems** are generated from `(profile seed, system number)`. Each has a star
  (M, G or B class, whose heat zone damages ships), 3–5 planets with moons and
  occasional rings, an ore-rich inner belt, an ice-rich outer belt and, from system 3 on,
  a crystal belt. The station orbits between the belts. Belts slowly regrow out of sight.
- **Asteroids** come in large, medium and small. Cracking passes 70% of a rock's units
  to its fragments (3 for a large, 2 for a medium) and drops the rest as debris; small
  rocks drop everything. Units are conserved (there's a test for this). Crystal rocks
  are tougher and only appear after the first warp.
- **Hazards**: from system 2 on, space gets dangerous. A **comet** is an icy, fast rock
  that crosses a belt in a straight line: it hits ships hard, and cracking one pays out
  far more than a normal rock. A dashed line on the map shows its path for 8 seconds
  before it appears. At M and B stars (never G) a **solar flare** can also burn every
  undocked ship near the star; a banner counts down the warning, the alarm sounds, and
  a docked ship takes nothing, so dock or fly clear. Both are announced in the banner
  under the top bar and in the log. The ⚙ Gameplay tab sets them to Off, Normal or
  Harsh (more often, hits harder). Drones without a manual order look after
  themselves: they step out of a comet's path, leave comets alone, and dock or fly
  clear when a flare builds.
- **Hulls & slots**: every ship has a hull (base stats plus N generic slots). Each slot
  takes one component at tier 1–3: Mining Laser, Ion Engine, Deflector Shield,
  Composite Armor, Cargo Pod, or Sensor & Tractor Array. Mining Laser and Ion Engine
  each offer a sidegrade variant chosen when installing — Focused/Wide Beam and
  Standard Drive/Vector Thruster. Effects stack, so two lasers give twice the DPS.
  Refits, repairs and scrapping require the ship to be docked. Removing a part refunds
  half its value.
- **Fleet**: buy Mining Drones (2 slots) or Harvesters (3 slots). Drones auto-mine, sweep
  up debris and return to unload when full. In **Assist** mode they work near the
  flagship; in **Auto** mode they work near the station. Select one to give it manual
  orders. The flagship can be refitted onto the 6-slot **Excavator** hull.
- **Damage**: collisions above a speed threshold and star heat hit shields first, then
  hull. Armor reduces damage. A lost flagship is rebuilt at the station (its cargo is
  lost); lost drones are gone.
- **Warp / prestige**: warping costs fuel from the bank, and the cost rises 35% per warp.
  It resets the bank, ships and components and generates the next system. It grants
  **Horizon Data** = ⌊√(value delivered this run / 60)⌋. Research spends it on permanent
  perks: yield, laser damage, speed, fleet capacity, a starter kit, and cheaper warps.
- **Saves**: the ⚙ menu has three save slots in `localStorage`. The running game
  autosaves to its slot every 10 s (in the browser's next idle moment) and when the tab is
  hidden or closed. Filled slots can be loaded, exported as compact text (to copy) or
  downloaded as a `.json` file, and deleted. Exports round positions and timers to six
  significant digits; the slots themselves keep full precision. The
  running slot can instead be restarted as a new game. Empty slots can start a new game,
  import a `.json` file, or take pasted save text. Imports are validated and give a
  readable error. The ⚙ menu also has a Controls tab.
- **Settings** (⚙ menu, stored separately from saves so they apply to every slot):
  - _Gameplay_: pause while menus are open or the window is unfocused (P pauses
    manually; menus keep working while paused), autosave interval, confirmations, the
    hazard level (Off / Normal / Harsh), and the autopilot assists (rock avoidance,
    drone auto-unload, fragment chaining).
  - _Graphics_: Low/Medium/High quality (resolution cap, star and particle density),
    nebula, anti-aliasing (applies on reload), screen shake, FPS counter.
  - _Interface_: HUD scale, always-on ship bars, help box, event log verbosity, camera
    follow, zoom speed, edge panning.
  - _Controls_: rebind every action (primary + secondary key). A key bound to another
    action is moved, and the help box follows your bindings.
  - _Audio_: master/effects/music volume. Sounds are positioned by where they are on
    screen: off to one side means panned that way and quieter, and zooming out softens
    the whole mix. Ambient music is generated live, with no audio files: warm and slow
    around M stars, neutral at G, cold and sparse at B, crossfading on every warp and
    playing on through pauses. Beam hums go quiet while the game is paused. The low-hull /
    overheat alarm also goes quiet whenever you pause (`P`, or while a menu is open), but
    keeps sounding while the window stays visible and loses focus (a hidden tab suspends
    all audio).

## Architecture

`src/sim` is the deterministic game — pure TypeScript, with no DOM and no three.js. `src/render` draws it with
three.js, and `src/ui` is the DOM HUD; both read sim state and send `Command`s but never mutate it. `src/core`
holds primitives (seeded RNG, vectors, spatial hash) and `src/data` holds the tunable tables.

```
src/core ──┐
src/data ──┼──▶ src/sim ──┬──▶ src/render   (three.js)
           │             └──▶ src/ui       (DOM HUD)
```

Where to go next: [`AGENTS.md`](AGENTS.md) is the entry point for coding agents and the fastest orientation for
anyone; [`docs/agents/architecture.md`](docs/agents/architecture.md) covers the layers, the tick and the design
rules; [`docs/agents/repo-structure.md`](docs/agents/repo-structure.md) covers what lives where.

`window.__amh` exposes `{ state(), send(cmd), settings, renderer, audio }` for console poking and automated
checks.

## Ideas for later

Pirates and combat modules, trade contracts at the station, idle/offline progress,
more hull classes and specialised drones (haulers, escorts), touch/pinch controls.
