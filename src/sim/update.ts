// The fixed-step simulation tick. Order of operations:
// commands → orbits → rocks → ships (pilot, collide, heat, dock) → pickups → belt regrowth → contracts.

import { range } from '../core/rng';
import { damp, dist, type Vec2 } from '../core/vec';
import { walletValue, RESOURCES, RESOURCE_INFO, walletTotal } from '../data/resources';
import { TUNING } from '../data/tuning';
import { DEFAULT_ASSISTS, type Assists } from './assists';
import { applyCommand, type Command } from './commands';
import { contractProgress, updateContracts } from './contracts';
import { isDocked } from './economy';
import { spawnBeltRock } from './generate';
import type { SimIndex } from './index';
import { droneThink, runOrder, steer, type TickCtx } from './pilot';
import { cargoFree, damageShip, isAlive, isFlagship, type ShipStats } from './ships';
import type { GameState, Ship } from './types';

export interface TickInput {
  /** WASD vector for the selected ship; (0,0) when idle. */
  thrust: Vec2;
  commands: Command[];
  assists?: Assists;
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

  for (const p of run.system.planets) {
    p.angle += p.speed * dt;
    for (const m of p.moons) m.angle += m.speed * dt;
  }

  // Rocks drift on slow circular orbits; fragments settle back into them.
  const settle = 1 - damp(0.25, dt);
  for (const r of run.rocks) {
    const d = Math.hypot(r.pos.x, r.pos.z) || 1;
    const tx = (-r.pos.z / d) * TUNING.rockOrbitSpeed;
    const tz = (r.pos.x / d) * TUNING.rockOrbitSpeed;
    r.vel.x += (tx - r.vel.x) * settle;
    r.vel.z += (tz - r.vel.z) * settle;
    r.pos.x += r.vel.x * dt;
    r.pos.z += r.vel.z * dt;
  }
  index.rebuild(state);

  const ctx: TickCtx = {
    state,
    index,
    dt,
    assists: input.assists ?? DEFAULT_ASSISTS,
  };

  // Safe while ships die mid-loop: removals reassign run.ships rather than mutating it.
  for (const ship of run.ships) updateShip(ctx, ship, index.stats.get(ship.id)!, input.thrust);

  updatePickups(state, index.stats, dt);
  regrowBelts(state, dt);
  updateContracts(state, dt);
}

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
    if (!isFlagship(ship)) droneThink(ctx, ship, st);
  }

  // Inertia with gentle drag so space feels slick but controllable.
  const drag = damp(ship.thrusting ? 0.6 : 1.4, dt);
  ship.vel.x *= drag;
  ship.vel.z *= drag;
  ship.pos.x += ship.vel.x * dt;
  ship.pos.z += ship.vel.z * dt;
  if (!ship.beamOn && Math.hypot(ship.vel.x, ship.vel.z) > 6) {
    const target = Math.atan2(ship.vel.z, ship.vel.x);
    let da = target - ship.angle;
    da = Math.atan2(Math.sin(da), Math.cos(da));
    ship.angle += da * (1 - damp(10, dt));
  }

  collideRocks(ctx, ship, st);

  // Star heat ramps up toward the photosphere.
  const sys = run.system;
  const dStar = Math.hypot(ship.pos.x, ship.pos.z);
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
    if (!isAlive(ship) || !run.ships.includes(ship)) return;
  }

  ship.shield = Math.min(st.maxShield, ship.shield + st.shieldRegen * dt);

  if (isDocked(run, ship) && walletTotal(ship.cargo) > 0) unload(state, ship);
}

function collideRocks(ctx: TickCtx, ship: Ship, st: ShipStats): void {
  const { state } = ctx;
  ctx.index.rockHash.query(ship.pos, st.size + 50, (r) => {
    if (!ctx.index.rockById.has(r.id) || !state.run.ships.includes(ship) || !isAlive(ship)) return;
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
      const push = (-rel * 8) / (r.radius * r.radius);
      r.vel.x -= nx * push * 10;
      r.vel.z -= nz * push * 10;
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
  const parts = RESOURCES.filter((r) => ship.cargo[r] >= 0.5).map(
    (r) => `${Math.floor(ship.cargo[r])}${RESOURCE_INFO[r].icon}`,
  );
  for (const r of RESOURCES)
    if (ship.cargo[r] > 0) contractProgress(state, { t: 'deliver', resource: r, amount: ship.cargo[r] });
  for (const r of RESOURCES) {
    run.bank[r] += ship.cargo[r];
    ship.cargo[r] = 0;
  }
  run.runValue += value;
  if (value > 0) state.out.fx.push({ t: 'dock', pos: { ...ship.pos }, shipId: ship.id, value });
  if (isFlagship(ship) && parts.length)
    state.out.log.push({ level: 'info', text: `${ship.name} unloaded ${parts.join(' ')}.` });
}

function updatePickups(state: GameState, stats: Map<number, ShipStats>, dt: number): void {
  const { run } = state;
  const live = run.ships.filter(isAlive);
  const drag = damp(0.8, dt);
  run.pickups = run.pickups.filter((p) => {
    p.age += dt;
    if (p.age > TUNING.pickupLifetime) return false;
    p.vel.x *= drag;
    p.vel.z *= drag;

    let best: Ship | null = null;
    let bestD = Infinity;
    for (const s of live) {
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
        p.amount -= take;
        state.out.fx.push({ t: 'collect', pos: { ...best.pos }, kind: p.kind, amount: take, shipId: best.id });
        if (p.amount <= 1e-6) return false;
      }
    }
    p.pos.x += p.vel.x * dt;
    p.pos.z += p.vel.z * dt;
    return true;
  });
}

/** Belts slowly regrow so long sessions (and idle drones) never run dry. */
function regrowBelts(state: GameState, dt: number): void {
  const { run } = state;
  run.regrowTimer += dt;
  if (run.regrowTimer < TUNING.beltRegrowInterval) return;
  run.regrowTimer = 0;
  const counts = run.system.belts.map(() => 0);
  for (const r of run.rocks) counts[r.belt] = (counts[r.belt] ?? 0) + 1;
  run.system.belts.forEach((b, i) => {
    if (counts[i]! >= b.initialCount * TUNING.beltRegrowTarget) return;
    // Spawn out of sight of every ship so rocks don't pop in on screen.
    for (let tries = 0; tries < 6; tries++) {
      const rock = spawnBeltRock(run, i, range(run.rng, 0, 1) < 0.5 ? 0 : 1);
      if (run.ships.every((s) => dist(s.pos, rock.pos) > 900)) return;
      run.rocks.pop();
    }
  });
}
