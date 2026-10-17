// Ship piloting: steering with obstacle avoidance, order execution and the
// drone AI. Everything here operates on one ship per call.

import type { SpatialHash } from '../core/spatialHash';
import { damp, dist, distSq, len, type Vec2 } from '../core/vec';
import { TUNING } from '../data/tuning';
import type { Assists } from './assists';
import { isDocked } from './economy';
import { laserRock } from './mining';
import { cargoFree, flagship, isAlive, type ShipStats } from './ships';
import type { GameState, Rock, Ship } from './types';

export interface TickCtx {
  state: GameState;
  rockHash: SpatialHash<Rock>;
  rockById: Map<number, Rock>;
  stats: Map<number, ShipStats>;
  dt: number;
  assists: Assists;
}

/**
 * Autopilot obstacle avoidance: rocks lying in a corridor ahead of the wish
 * direction push the ship sideways (around them, not back), and rocks that
 * are nearly touching push straight away.
 */
function avoidance(
  ctx: TickCtx,
  ship: Ship,
  st: ShipStats,
  dx: number,
  dz: number,
  ignoreId: number | null,
): Vec2 & { danger: number } {
  const look = st.size + 60 + len(ship.vel) * 1.2;
  let ax = 0;
  let az = 0;
  let danger = 0;
  ctx.rockHash.query(ship.pos, look + 50, (r) => {
    if (r.id === ignoreId || !ctx.rockById.has(r.id)) return;
    const rx = r.pos.x - ship.pos.x;
    const rz = r.pos.z - ship.pos.z;
    const d = Math.hypot(rx, rz) || 0.01;
    const gap = d - r.radius - st.size;
    if (gap < 12) {
      const k = (1 - Math.max(0, gap) / 12) * 2;
      ax -= (rx / d) * k;
      az -= (rz / d) * k;
    }
    const along = rx * dx + rz * dz;
    if (along < 0 || along - r.radius > look) return;
    const lateral = rx * -dz + rz * dx; // + means the rock is to the left
    const clearance = r.radius + st.size + 14;
    if (Math.abs(lateral) >= clearance) return;
    const urgency = (1 - Math.max(0, along - r.radius) / look) * (1 - (Math.abs(lateral) / clearance) * 0.5) * 2.2;
    danger = Math.max(danger, urgency / 2.2);
    const side = lateral > 0 ? -1 : 1; // sidestep away from the rock's side
    ax += -dz * side * urgency;
    az += dx * side * urgency;
  });
  return { x: ax, z: az, danger };
}

/**
 * Accelerate along a wish vector (length 0..1), capped at top speed.
 * `avoid` enables autopilot obstacle avoidance (off for manual WASD flight);
 * `ignoreId` exempts the rock being approached for mining.
 */
export function steer(
  ctx: TickCtx,
  ship: Ship,
  st: ShipStats,
  wx: number,
  wz: number,
  avoid = false,
  ignoreId: number | null = null,
): void {
  const { dt } = ctx;
  let want = Math.min(1, Math.hypot(wx, wz));
  let x = wx;
  let z = wz;
  if (avoid && want > 1e-6) {
    // Probe along where we're actually going once moving, else where we want to go.
    const sp = len(ship.vel);
    const [px, pz] = sp > 30 ? [ship.vel.x / sp, ship.vel.z / sp] : [wx / Math.hypot(wx, wz), wz / Math.hypot(wx, wz)];
    const a = avoidance(ctx, ship, st, px, pz, ignoreId);
    x += a.x * Math.max(want, 0.5);
    z += a.z * Math.max(want, 0.5);
    want *= 1 - 0.7 * a.danger; // ease off the throttle while threading a cluster
  }
  const l = Math.hypot(x, z);
  if (l > 1e-6) {
    x = (x / l) * want;
    z = (z / l) * want;
  }
  ship.vel.x += x * st.accel * dt;
  ship.vel.z += z * st.accel * dt;
  ship.thrusting = want > 0.05;
  const sp = len(ship.vel);
  const max = st.speed * Math.max(want, 0.15);
  if (sp > max) {
    const k = max / sp;
    const ease = k + (1 - k) * damp(avoid ? 8 : 4, dt); // ease down rather than snap
    ship.vel.x *= ease;
    ship.vel.z *= ease;
  }
}

/** Arrival steering: decelerates into `target`. Returns true once there. */
export function arrive(
  ctx: TickCtx,
  ship: Ship,
  st: ShipStats,
  target: Vec2,
  stopDist = 12,
  avoidId: number | null = null,
): boolean {
  const dx = target.x - ship.pos.x;
  const dz = target.z - ship.pos.z;
  const d = Math.hypot(dx, dz);
  if (d <= stopDist) return true;
  // Slow down within the braking distance v²/2a.
  const brake = (st.speed * st.speed) / (2 * st.accel) + 20;
  const throttle = Math.min(1, (d - stopDist) / brake + 0.08);
  steer(ctx, ship, st, (dx / d) * throttle, (dz / d) * throttle, ctx.assists.avoid, avoidId);
  return false;
}

/** Fly into laser range of a rock and burn it. Returns fragments if it broke. */
export function workRock(ctx: TickCtx, ship: Ship, st: ShipStats, rock: Rock): Rock[] | null {
  const d = dist(ship.pos, rock.pos);
  const reach = st.range + rock.radius;
  if (d > reach) {
    arrive(ctx, ship, st, rock.pos, reach * 0.8, rock.id);
    return null;
  }
  ship.beamOn = true;
  ship.beamTargetId = rock.id;
  ship.angle = Math.atan2(rock.pos.z - ship.pos.z, rock.pos.x - ship.pos.x);
  // Hold station relative to the drifting rock.
  const k = damp(3, ctx.dt);
  ship.vel.x = rock.vel.x + (ship.vel.x - rock.vel.x) * k;
  ship.vel.z = rock.vel.z + (ship.vel.z - rock.vel.z) * k;
  const frags = laserRock(ctx.state, rock, st.dps * ctx.dt);
  if (frags) ctx.rockById.delete(rock.id);
  return frags;
}

function nearestRock(ctx: TickCtx, from: Vec2, radius: number, filter: (r: Rock) => boolean): Rock | null {
  let best: Rock | null = null;
  let bestD = radius * radius;
  ctx.rockHash.query(from, radius, (r) => {
    if (!ctx.rockById.has(r.id) || !filter(r)) return;
    const d = distSq(from, r.pos);
    if (d < bestD) {
      bestD = d;
      best = r;
    }
  });
  return best;
}

/** After a manual mining target breaks, chain onto the closest fragment. */
export function chainTarget(ctx: TickCtx, ship: Ship, st: ShipStats, frags: Rock[]): number | null {
  const near = frags.filter((f) => dist(f.pos, ship.pos) < st.range * 1.6);
  if (near.length) return near.reduce((a, b) => (dist(a.pos, ship.pos) <= dist(b.pos, ship.pos) ? a : b)).id;
  return nearestRock(ctx, ship.pos, st.range * 1.2, () => true)?.id ?? null;
}

/** Executes a ship's manual order. Returns false if it has none. */
export function runOrder(ctx: TickCtx, ship: Ship, st: ShipStats): boolean {
  const o = ship.order;
  if (!o) return false;
  const { run } = ctx.state;
  if (o.kind === 'move') {
    if (arrive(ctx, ship, st, o.to)) ship.order = null;
  } else if (o.kind === 'dock') {
    if (arrive(ctx, ship, st, run.system.station.pos, TUNING.dockRadius * 0.4)) ship.order = null;
  } else {
    const rock = ctx.rockById.get(o.rockId);
    if (!rock) {
      ship.order = null;
      return false;
    }
    const frags = workRock(ctx, ship, st, rock);
    if (frags) {
      const next = ctx.assists.chain ? chainTarget(ctx, ship, st, frags) : null;
      ship.order = next != null ? { kind: 'mine', rockId: next } : null;
    }
  }
  return true;
}

/**
 * Drone brain, used when a drone has no manual order:
 * full → return to station · loose pickups nearby → collect · else mine near the anchor
 * (the flagship in "assist" mode, the station in "auto" mode) · else follow the anchor.
 */
export function droneThink(ctx: TickCtx, ship: Ship, st: ShipStats): void {
  const { run } = ctx.state;
  const station = run.system.station.pos;

  const fs = flagship(run);
  const anchor = ship.aiMode === 'assist' && isAlive(fs) ? fs.pos : station;
  const slot = (ship.id % 6) * ((Math.PI * 2) / 6);
  const home = { x: anchor.x + Math.cos(slot) * 70, z: anchor.z + Math.sin(slot) * 70 };

  if (cargoFree(ship, st) < Math.max(2, st.cargoCap * 0.04)) {
    ship.aiTargetId = null;
    // Without auto-dock a full drone waits by its anchor for a manual dock order.
    if (!ctx.assists.autoDock) arrive(ctx, ship, st, home, 20);
    else if (!isDocked(run, ship)) arrive(ctx, ship, st, station, TUNING.dockRadius * 0.5);
    return;
  }

  // Sweep up debris within a short hop.
  let pickup: Vec2 | null = null;
  let best = 260 * 260;
  for (const p of run.pickups) {
    const d = distSq(ship.pos, p.pos);
    if (d < best && dist(p.pos, anchor) < TUNING.droneLeash) {
      best = d;
      pickup = p.pos;
    }
  }
  if (pickup && best > st.magnet * st.magnet * 0.3) {
    arrive(ctx, ship, st, pickup, 6);
    return;
  }

  if (st.dps > 0) {
    let rock = ship.aiTargetId != null ? ctx.rockById.get(ship.aiTargetId) : undefined;
    if (rock && dist(rock.pos, anchor) > TUNING.droneLeash) rock = undefined;
    if (!rock && ship.aiMode === 'assist' && fs.order?.kind === 'mine') rock = ctx.rockById.get(fs.order.rockId);
    if (!rock) {
      rock =
        nearestRock(ctx, ship.pos, 500, (r) => dist(r.pos, anchor) < TUNING.droneLeash) ??
        nearestRock(ctx, anchor, TUNING.droneLeash, () => true) ??
        undefined;
    }
    if (rock) {
      ship.aiTargetId = rock.id;
      if (workRock(ctx, ship, st, rock)) ship.aiTargetId = null;
      return;
    }
  }

  ship.aiTargetId = null;
  arrive(ctx, ship, st, home, 20);
}
