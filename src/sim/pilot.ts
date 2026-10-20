// Ship piloting: steering with obstacle avoidance, order execution and the
// drone AI. Everything here operates on one ship per call.

import type { HazardLevel } from '../data/hazards';
import { damp, dist, distSq, len, type Vec2 } from '../core/vec';
import { TUNING } from '../data/tuning';
import type { Assists, FleetAuto } from './assists';
import { isDocked } from './economy';
import { cometPathEscape, flareShelter, inFlareZone } from './hazards';
import type { SimIndex } from './index';
import { needsRepair } from './fleetAuto';
import { laserRock } from './mining';
import { flagship, isAlive, isHoldFull, type ShipStats } from './ships';
import { canMine, volatileSafeDistance } from './traits';
import type { GameState, Rock, Ship } from './types';

export interface TickCtx {
  state: GameState;
  index: SimIndex;
  dt: number;
  assists: Assists;
  /** Autorepair threshold and spending reserve. */
  auto: FleetAuto;
  /** Hazard level for this tick; scales flare damage. */
  hazards: HazardLevel;
}

/**
 * Autopilot obstacle avoidance: rocks lying in a corridor ahead of the wish
 * direction push the ship sideways (around them, not back), and rocks that
 * are nearly touching push straight away.
 */
function avoidance(ctx: TickCtx, ship: Ship, st: ShipStats, dx: number, dz: number, ignoreId: number | null): number {
  const look = st.size + 60 + len(ship.vel) * 1.2;
  let ax = 0;
  let az = 0;
  let danger = 0;
  ctx.index.rockHash.query(ship.pos, look + 50, (r) => {
    if (r.id === ignoreId || !ctx.index.rockById.has(r.id)) return;
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
  ctx.index.avoid.x = ax;
  ctx.index.avoid.z = az;
  return danger;
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
    let px: number;
    let pz: number;
    if (sp > 30) {
      px = ship.vel.x / sp;
      pz = ship.vel.z / sp;
    } else {
      const w = Math.hypot(wx, wz);
      px = wx / w;
      pz = wz / w;
    }
    const danger = avoidance(ctx, ship, st, px, pz, ignoreId);
    const a = ctx.index.avoid;
    x += a.x * Math.max(want, 0.5);
    z += a.z * Math.max(want, 0.5);
    want *= 1 - 0.7 * danger; // ease off the throttle while threading a cluster
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
    // Volatile rocks need a wider berth, but never past firing range.
    const stand = Math.min(
      rock.trait === 'volatile' ? Math.max(reach * 0.8, volatileSafeDistance(rock)) : reach * 0.8,
      reach,
    );
    arrive(ctx, ship, st, rock.pos, stand, rock.id);
    return null;
  }
  ship.beamOn = true;
  ship.beamTargetId = rock.id;
  ship.angle = Math.atan2(rock.pos.z - ship.pos.z, rock.pos.x - ship.pos.x);
  // Hold station relative to the drifting rock.
  const k = damp(3, ctx.dt);
  ship.vel.x = rock.vel.x + (ship.vel.x - rock.vel.x) * k;
  ship.vel.z = rock.vel.z + (ship.vel.z - rock.vel.z) * k;
  let frags = laserRock(ctx.state, rock, st.dps * ctx.dt, st.laserTier);
  if (frags) ctx.index.rockById.delete(rock.id);
  if (st.splash > 0) {
    // Wide Beam: the same beam also grazes every other live rock inside the splash radius.
    const dmg = st.dps * ctx.dt * TUNING.splashMul;
    ctx.index.rockHash.query(rock.pos, st.splash + 60, (n) => {
      if (n.id === rock.id || !ctx.index.rockById.has(n.id) || ctx.index.outpostRocks.has(n.id)) return;
      if (dist(n.pos, rock.pos) > st.splash + n.radius) return;
      const nf = laserRock(ctx.state, n, dmg, st.laserTier);
      if (nf) {
        ctx.index.rockById.delete(n.id);
        (frags ??= []).push(...nf);
      }
    });
  }
  return frags;
}

/** A rock this ship's laser can cut that is not an outpost's host. */
const minable = (ctx: TickCtx, st: ShipStats, r: Rock): boolean => canMine(st, r) && !ctx.index.outpostRocks.has(r.id);

function nearestRock(ctx: TickCtx, from: Vec2, radius: number, filter: (r: Rock) => boolean): Rock | null {
  let best: Rock | null = null;
  let bestD = radius * radius;
  ctx.index.rockHash.query(from, radius, (r) => {
    if (!ctx.index.rockById.has(r.id) || !filter(r)) return;
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
  let best: Rock | null = null;
  let bestD = Infinity;
  for (const f of frags) {
    const d = dist(f.pos, ship.pos);
    if (d < st.range * 1.6 && d < bestD) {
      best = f;
      bestD = d;
    }
  }
  if (best) return best.id;
  return nearestRock(ctx, ship.pos, st.range * 1.2, (r) => minable(ctx, st, r))?.id ?? null;
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
    const rock = ctx.index.rockById.get(o.rockId);
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

/** True if `pos` lies in the flare zone or a comet path (see `sim/hazards`). */
export function unsafe(ctx: TickCtx, pos: Vec2): boolean {
  const { run } = ctx.state;
  return inFlareZone(run, pos) || cometPathEscape(run, ctx.index.comets, pos, TUNING.cometDodgePad, ctx.index.escape);
}

/**
 * Hazard reflexes ahead of the rest of the drone brain: step straight out of a comet path, else shelter from a
 * flare by docking (and staying docked) or fleeing past its reach. Returns true if it steered the drone.
 */
export function dodgeHazards(ctx: TickCtx, ship: Ship, st: ShipStats, full: boolean): boolean {
  const { run } = ctx.state;
  const esc = ctx.index.escape;
  if (cometPathEscape(run, ctx.index.comets, ship.pos, TUNING.cometDodgePad + st.size, esc)) {
    steer(ctx, ship, st, esc.x, esc.z, ctx.assists.avoid);
    return true;
  }
  if (!inFlareZone(run, ship.pos)) return false;
  if (flareShelter(run, ship.pos, full && ctx.assists.autoDock, esc) === 'dock')
    arrive(ctx, ship, st, run.system.station.pos, TUNING.dockRadius * 0.5);
  else arrive(ctx, ship, st, esc, 20);
  return true;
}

/**
 * Writes ship `id`'s parking spot into `out` and returns it: one of six slots on a ring of `radius` around `anchor`,
 * so ships waiting at the same anchor spread out. Writes into `out` so the per-tick path does not allocate.
 */
export function formationSlot(out: Vec2, anchor: Vec2, id: number, radius: number): Vec2 {
  const slot = (id % 6) * ((Math.PI * 2) / 6);
  out.x = anchor.x + Math.cos(slot) * radius;
  out.z = anchor.z + Math.sin(slot) * radius;
  return out;
}

/**
 * Drone brain, used when a drone has no manual order:
 * comet path or flare → get clear · hull below the autorepair threshold → repair at the station (#140) · full →
 * return to station · loose pickups nearby → collect · else mine near the
 * anchor (the flagship in "assist" mode, the station in "auto" mode) · else follow the anchor. Targets in a comet
 * path or flare zone are skipped, and an unsafe anchor is waited out in place.
 */
export function droneThink(ctx: TickCtx, ship: Ship, st: ShipStats): void {
  const { run } = ctx.state;
  const station = run.system.station.pos;

  const fs = flagship(run);
  const anchor = ship.aiMode === 'assist' && isAlive(fs) ? fs.pos : station;
  const home = formationSlot(ctx.index.home, anchor, ship.id, 70);

  const full = isHoldFull(ship, st);
  if (dodgeHazards(ctx, ship, st, full)) {
    ship.aiTargetId = null;
    return;
  }

  if (needsRepair(ship, st, ctx.auto)) {
    ship.aiTargetId = null;
    if (!isDocked(run, ship)) arrive(ctx, ship, st, station, TUNING.dockRadius * 0.5);
    return;
  }

  if (full) {
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
    if (d < best && dist(p.pos, anchor) < TUNING.droneLeash && !unsafe(ctx, p.pos)) {
      best = d;
      pickup = p.pos;
    }
  }
  if (pickup && best > st.magnet * st.magnet * 0.3) {
    arrive(ctx, ship, st, pickup, 6);
    return;
  }

  if (st.dps > 0) {
    let rock = ship.aiTargetId != null ? ctx.index.rockById.get(ship.aiTargetId) : undefined;
    if (rock && (!minable(ctx, st, rock) || dist(rock.pos, anchor) > TUNING.droneLeash || unsafe(ctx, rock.pos)))
      rock = undefined;
    if (!rock && ship.aiMode === 'assist' && fs.order?.kind === 'mine') {
      rock = ctx.index.rockById.get(fs.order.rockId);
      if (rock && (!minable(ctx, st, rock) || unsafe(ctx, rock.pos))) rock = undefined;
    }
    if (!rock) {
      rock =
        nearestRock(
          ctx,
          ship.pos,
          500,
          (r) => minable(ctx, st, r) && dist(r.pos, anchor) < TUNING.droneLeash && !unsafe(ctx, r.pos),
        ) ??
        nearestRock(ctx, anchor, TUNING.droneLeash, (r) => minable(ctx, st, r) && !unsafe(ctx, r.pos)) ??
        undefined;
    }
    if (rock) {
      ship.aiTargetId = rock.id;
      if (workRock(ctx, ship, st, rock)) ship.aiTargetId = null;
      return;
    }
  }

  ship.aiTargetId = null;
  if (unsafe(ctx, home)) steer(ctx, ship, st, 0, 0);
  else arrive(ctx, ship, st, home, 20);
}
