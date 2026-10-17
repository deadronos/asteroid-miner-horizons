# ⛏️ Asteroid Miner Horizons

A top-down 2D space sim rendered with Three.js: fly a mining ship (and grow a fleet),
strip asteroid belts with a mining laser, haul ore and ice, upgrade ship components,
and warp to fresh star systems for stacking prestige bonuses.

## Quick start

```bash
cd asteroid-miner-horizons
npm install
npm run dev      # play at http://localhost:5173
npm run build    # typecheck + production build into dist/
npm run preview  # serve the production build
```

Requires Node 18+.

## Controls

| Input | Action |
|---|---|
| `WASD` / arrows | Thrust the selected ship |
| Left-click empty space | Click-to-move order (selected ship) |
| Left-click asteroid | Mining laser: ship closes to range, beam fires continuously |
| Left-click ship / `Tab` | Select ship (fleet) |
| Mouse wheel | Zoom (120–1500 units) |
| `Esc` | Cancel current orders |

## Systems

- **Star system** — one star (heat damage close in), 4 orbiting planets with moons,
  two asteroid belts: inner ore-rich, outer ice-rich. ~260 mineable rocks per system.
- **Mining** — the laser deals continuous damage in range. Large rocks crack into
  medium fragments, mediums into smalls; destroyed rocks drop **ore** (orange) and
  **ice** (cyan) debris. Fly within magnet radius to tractor debris in.
- **Ship & components** — every ship has hull + regenerating shield and five
  upgradeable slots: **engines** (speed), **mining laser** (DPS/range),
  **shield** (capacity/regen), **armor** (damage reduction), **sensors** (pickup range).
  Upgrades and repairs cost ore; hull damage comes from collisions and star heat.
- **Fleet** — buy autonomous mining drones (ore + ice). Drones follow the flagship,
  assist its mining target, work nearby rocks, and haul their own pickups.
  Click a fleet row or press `Tab` to take direct control.
- **Warp / prestige** — ice fuels the warp drive. Warping generates a brand-new
  system and grants a permanent stacking bonus (+10% yield, +5% speed per warp).
  Cost rises slightly each jump.

## Architecture

2D sim on the `{ x, z }` plane, rendered top-down with an orthographic Three.js camera.

| File | Role |
|---|---|
| `src/config.ts` | Tuning constants + component catalogue (costs, effects) |
| `src/world.ts` | Pure sim: system generation, movement, mining, cracking, pickups, drones, warp, economy |
| `src/render.ts` | Three.js scene: star/planets/moons, asteroids, ships, beams, pickups, camera, picking |
| `src/ui.ts` | DOM HUD: top bar, fleet panel, component shop, event log |
| `src/main.ts` | Bootstrap: input, fixed-step loop (60 Hz sim), `window.__amh` debug hook |
| `src/style.css` | Full-window layout + HUD styling |

`world.ts` has no rendering or DOM imports, so the sim can be unit-tested headlessly.
`window.__amh` exposes `{ state, orderMine, orderMove, step }` for automated smoke checks.

## Roadmap ideas

- Enemy pirates / combat weapons, station trading, map/mission objectives,
  save persistence via localStorage, sound effects, mobile touch controls.
