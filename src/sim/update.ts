// The fixed-step simulation tick. Order of operations:
// commands → orbits → rocks → hazards → outposts → ships (pilot, collide, heat, dock) → pickups → belt regrowth →
// contracts → refinery → achievements.

import { range } from '../core/rng';
import { damp, dist, integrate, len, type Vec2 } from '../core/vec';
import { HAZARD_LEVELS, FLARES, type HazardLevel } from '../data/hazards';
import { walletValue, RESOURCES, formatWallet, walletTotal } from '../data/resources';
import { TUNING } from '../data/tuning';
import { updateAchievements } from './achievements';
import { DEFAULT_ASSISTS, type Assists } from './assists';
import { haulerThink, updateOutposts } from './automation';
import { applyCommand, type Command } from './commands';
import { contractProgress, updateContracts } from './contracts';
import { isDocked } from './economy';
import { spawnBeltRock } from './generate';
import { flareExposure, updateHazards } from './hazards';
import type { SimIndex } from './index';
import { systemEffects } from './modifiers';
import { droneThink, runOrder, steer, type TickCtx } from './pilot';
import { updateRefinery } from './refining';
import { cargoFree, damageShip, isAlive, isFlagship, isHauler, type ShipStats } from './ships';
import { magnetPull } from './traits';
import type { GameState, Run, Ship } from './types';

export interface TickInput {
  /** WASD vector for the selected ship; (0,0) when idle. */
  thrust: Vec2;
  commands: Command[];
  assists?: Assists;
  /** Hazard difficulty; absent means 'off'. */
  hazards?: HazardLevel;
}

/** Applies and clears queued commands. Also used while paused so menus still work. */
export function applyCommands(state: GameState, commands: Command[]): void {
  for (const c of commands) applyCommand(state, c);
  commands.length = 0;
}

export function tick(state: GameState, dt: number, input: TickInput, index: SimIndex): void {
  applyCommands(state, input.commands);

  const { run } = state;
  run.time += dt;
  state.profile.stats.time += dt;

  for (const p of run.system.planets) {
    p.angle += p.speed * dt;
    for (const m of p.moons) m.angle += m.speed * dt;
  }

  // Rocks drift on slow circular orbits; fragments settle back into them.
  const settle = 1 - damp(0.25, dt);
  for (const r of run.rocks) {
    if (r.comet) {
      integrate(r, dt);
      continue;
    }
    const d = len(r.pos) || 1;
    const tx = (-r.pos.z / d) * TUNING.rockOrbitSpeed;
    const tz = (r.pos.x / d) * TUNING.rockOrbitSpeed;
    r.vel.x += (tx - r.vel.x) * settle;
    r.vel.z += (tz - r.vel.z) * settle;

    if (r.trait === 'magnetic') magnetPull(run, r, dt);
    integrate(r, dt);
  }
  const level = input.hazards ?? 'off';
  updateHazards(state, dt, level);
  index.rebuild(state);
  updateOutposts(state, index, dt);

  const ctx: TickCtx = {
    state,
    index,
    dt,
    assists: input.assists ?? DEFAULT_ASSISTS,
    hazards: level,
  };

  // Index-based so a ship removed in `updateShip` (an in-place `removeItem`)
  // does not shift the next ship into an already-visited slot. A volatile blast
  // can remove several ships in one call, so a removal rewinds the scan and
  // `updatedShipIds` keeps an already-ticked ship from running twice.
  const updated = index.updatedShipIds;
  updated.length = 0;
  for (let i = 0; i < run.ships.length; i++) {
    const ship = run.ships[i]!;
    if (updated.includes(ship.id)) continue;
    updated.push(ship.id);
    const before = run.ships.length;
    updateShip(ctx, ship, index.stats.get(ship.id)!, input.thrust);
    if (run.ships.length !== before) i = -1;
  }

  updatePickups(state, index, dt);
  regrowBelts(state, dt);
  updateContracts(state, dt);
  updateRefinery(state, dt);
  updateAchievements(state);
}

/** True once `ship` has died or been removed from the run, so the rest of its update must stop. */
const shipGone = (run: Run, ship: Ship): boolean => !isAlive(ship) || !run.ships.includes(ship);

function updateShip(ctx: TickCtx, ship: Ship, st: ShipStats, thrust: Vec2): void {
  const { state, dt } = ctx;
  const { run } = state;

  if (!isAlive(ship)) {
    ship.respawn -= dt;
    if (ship.respawn <= 0) {
      ship.respawn = 0;
      ship.pos = { ...run.system.station.pos };
      ship.hull = st.maxHull;
      ship.shield = st.maxShield;
      state.out.log.push({ level: 'info', text: `${ship.name} rebuilt at the station.` });
    }
    return;
  }

  ship.beamOn = false;
  ship.thrusting = false;
  ship.collisionCd = Math.max(0, ship.collisionCd - dt);

  const manual = ship.id === run.selectedId && (thrust.x !== 0 || thrust.z !== 0);
  if (manual) {
    ship.order = null;
    steer(ctx, ship, st, thrust.x, thrust.z);
  } else if (!runOrder(ctx, ship, st)) {
    if (isHauler(ship)) haulerThink(ctx, ship, st);
    else if (!isFlagship(ship)) droneThink(ctx, ship, st);
  }

  // Inertia with gentle drag so space feels slick but controllable.
  const drag = damp(ship.thrusting ? 0.6 : 1.4, dt);
  ship.vel.x *= drag;
  ship.vel.z *= drag;
  integrate(ship, dt);
  if (!ship.beamOn && len(ship.vel) > 6) {
    const target = Math.atan2(ship.vel.z, ship.vel.x);
    let da = target - ship.angle;
    da = Math.atan2(Math.sin(da), Math.cos(da));
    ship.angle += da * (1 - damp(10, dt));
  }

  collideRocks(ctx, ship, st);
  if (shipGone(run, ship)) return;

  // Star heat ramps up toward the photosphere.
  const sys = run.system;
  const dStar = len(ship.pos);
  if (dStar < sys.heatRadius) {
    const k = 1 - (dStar - sys.starRadius) / (sys.heatRadius - sys.starRadius);
    damageShip(state, ship, TUNING.starHeatDps * Math.max(0.2, k) * dt);
    if (
      ship.id === run.selectedId &&
      Math.floor(run.time) !== Math.floor(run.time - dt) &&
      Math.floor(run.time) % 3 === 0
    ) {
      state.out.log.push({ level: 'warn', text: `${ship.name} is overheating near the star!` });
    }
    if (shipGone(run, ship)) return;
  }

  const flareProfile = FLARES[sys.starClass];
  const k = flareProfile ? flareExposure(run, ship) : 0;
  if (flareProfile && k > 0) {
    damageShip(state, ship, flareProfile.dps * HAZARD_LEVELS[ctx.hazards].damage * k * dt);
    if (shipGone(run, ship)) return;
  }

  ship.shield = Math.min(st.maxShield, ship.shield + st.shieldRegen * dt);

  if (isDocked(run, ship) && walletTotal(ship.cargo) > 0) unload(state, ship);
}

function collideRocks(ctx: TickCtx, ship: Ship, st: ShipStats): void {
  const { state } = ctx;
  ctx.index.rockHash.query(ship.pos, st.size + 50, (r) => {
    if (!ctx.index.rockById.has(r.id) || shipGone(state.run, ship)) return;
    const dx = ship.pos.x - r.pos.x;
    const dz = ship.pos.z - r.pos.z;
    const d = Math.hypot(dx, dz) || 0.01;
    const overlap = r.radius + st.size - d;
    if (overlap <= 0) return;
    const nx = dx / d;
    const nz = dz / d;
    ship.pos.x += nx * overlap;
    ship.pos.z += nz * overlap;
    const rel = (ship.vel.x - r.vel.x) * nx + (ship.vel.z - r.vel.z) * nz;
    if (rel < 0) {
      ship.vel.x -= rel * nx * 1.5;
      ship.vel.z -= rel * nz * 1.5;
      // Small rocks get shoved around by the hit.
      if (!r.comet) {
        const push = (-rel * 8) / (r.radius * r.radius);
        r.vel.x -= nx * push * 10;
        r.vel.z -= nz * push * 10;
      }
      if (-rel > TUNING.collisionMinSpeed && ship.collisionCd <= 0) {
        ship.collisionCd = TUNING.collisionCooldown;
        state.out.fx.push({ t: 'impact', pos: { x: ship.pos.x - nx * st.size, z: ship.pos.z - nz * st.size } });
        damageShip(state, ship, (-rel - TUNING.collisionMinSpeed) * 0.35 + 3);
      }
    }
  });
}

function unload(state: GameState, ship: Ship): void {
  const { run } = state;
  const value = walletValue(ship.cargo);
  const parts = formatWallet(ship.cargo);
  for (const r of RESOURCES)
    if (ship.cargo[r] > 0) contractProgress(state, { t: 'deliver', resource: r, amount: ship.cargo[r] });
  for (const r of RESOURCES) {
    run.bank[r] += ship.cargo[r];
    ship.cargo[r] = 0;
  }
  run.runValue += value;
  if (value > 0) state.out.fx.push({ t: 'dock', pos: { ...ship.pos }, shipId: ship.id, value });
  if (isFlagship(ship) && parts) state.out.log.push({ level: 'info', text: `${ship.name} unloaded ${parts}.` });
}

function updatePickups(state: GameState, index: SimIndex, dt: number): void {
  const { run } = state;
  const stats = index.stats;
  const drag = damp(0.8, dt);
  const pickups = run.pickups;
  let kept = 0;
  for (let i = 0; i < pickups.length; i++) {
    const p = pickups[i]!;
    p.age += dt;
    if (p.age > TUNING.pickupLifetime) continue; // dropped: age > lifetime
    p.vel.x *= drag;
    p.vel.z *= drag;

    let best: Ship | null = null;
    let bestD = Infinity;
    for (const s of run.ships) {
      if (!isAlive(s)) continue; // was `const live = run.ships.filter(isAlive)`
      const st = stats.get(s.id)!;
      const d = dist(s.pos, p.pos);
      if (d < st.magnet && d < bestD && cargoFree(s, st) > 0.01) {
        best = s;
        bestD = d;
      }
    }
    if (best) {
      const st = stats.get(best.id)!;
      const pull = TUNING.tractorSpeed * (0.4 + 0.6 * (1 - bestD / st.magnet));
      p.vel.x = best.vel.x + ((best.pos.x - p.pos.x) / bestD) * pull;
      p.vel.z = best.vel.z + ((best.pos.z - p.pos.z) / bestD) * pull;
      if (bestD < TUNING.pickupCollectRadius + st.size) {
        const take = Math.min(cargoFree(best, st), p.amount);
        best.cargo[p.kind] += take;
        state.profile.stats.unitsMined += take;
        p.amount -= take;
        state.out.fx.push({ t: 'collect', pos: { ...best.pos }, kind: p.kind, amount: take, shipId: best.id });
        if (p.amount <= 1e-6) continue; // consumed: dropped
      }
    }
    integrate(p, dt);
    pickups[kept++] = p;
  }
  pickups.length = kept;
}

/** Belts slowly regrow so long sessions (and idle drones) never run dry. */
function regrowBelts(state: GameState, dt: number): void {
  const { run } = state;
  run.regrowTimer += dt;
  if (run.regrowTimer < TUNING.beltRegrowInterval * systemEffects(run.system.modifiers).regrowInterval) return;
  run.regrowTimer = 0;
  const counts = run.system.belts.map(() => 0);
  for (const r of run.rocks) counts[r.belt] = (counts[r.belt] ?? 0) + 1;
  run.system.belts.forEach((b, i) => {
    if (counts[i]! >= b.initialCount * TUNING.beltRegrowTarget) return;
    // Spawn out of sight of every ship so rocks don't pop in on screen.
    for (let tries = 0; tries < 6; tries++) {
      const rock = spawnBeltRock(run, state.profile.seed, i, range(run.rng, 0, 1) < 0.5 ? 0 : 1);
      if (run.ships.every((s) => dist(s.pos, rock.pos) > 900)) return;
      run.rocks.pop();
    }
  });
}
