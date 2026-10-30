// Ship piloting: steering with obstacle avoidance, order execution and the
// drone AI. Everything here operates on one ship per call.

import type { HazardLevel } from '../data/hazards';
import { damp, dist, distSq, len, type Vec2, hypot2 } from '../core/vec';
import { TUNING } from '../data/tuning';
import type { Assists, FleetAuto } from './assists';
import { isDocked } from './economy';
import { cometPathEscape, flareShelter, inCometPath, inFlareZone } from './hazards';
import type { SimIndex } from './index';
import { needsRepair } from './fleetAuto';
import { laserRock } from './mining';
import { flagship, isAlive, isHoldFull, type ShipStats } from './ships';
import { setStatus } from './status';
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
function avoidance(
  ctx: TickCtx,
  ship: Ship,
  st: ShipStats,
  dx: number,
  dz: number,
  ignoreId: number | null,
  out: Vec2,
): number {
  const look = st.size + 60 + len(ship.vel) * 1.2;
  let ax = 0;
  let az = 0;
  let danger = 0;
  ctx.index.rockHash.query(ship.pos, look + 50, (r) => {
    if (r.id === ignoreId || !ctx.index.rockById.has(r.id)) return;
    const rx = r.pos.x - ship.pos.x;
    const rz = r.pos.z - ship.pos.z;
    const d = hypot2(rx, rz) || 0.01;
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
  out.x = ax;
  out.z = az;
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
  let want = Math.min(1, hypot2(wx, wz));
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
      const w = hypot2(wx, wz);
      px = wx / w;
      pz = wz / w;
    }
    const a = { x: 0, z: 0 };
    const danger = avoidance(ctx, ship, st, px, pz, ignoreId, a);
    x += a.x * Math.max(want, 0.5);
    z += a.z * Math.max(want, 0.5);
    want *= 1 - 0.7 * danger; // ease off the throttle while threading a cluster
  }
  const l = hypot2(x, z);
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

/**
 * Star detour: when the straight line to `target` would cross the star's heat zone, steers for the point on a safe
 * circle beside the line's closest approach instead and returns true. It re-aims every tick, so the route bends
 * round the star in an arc. The safe circle shrinks to the target's own distance from the star, so a point inside
 * it (a player's move order) is still reached, just by the shortest path that does not dip deeper.
 */
function starDetour(ctx: TickCtx, ship: Ship, st: ShipStats, target: Vec2, avoidId: number | null): boolean {
  const safe = Math.min(ctx.state.run.system.heatRadius + TUNING.starRoutePad + st.size, len(target));
  const dx = target.x - ship.pos.x;
  const dz = target.z - ship.pos.z;
  const l2 = dx * dx + dz * dz || 1;
  // Closest point to the star (the origin) on the segment ship → target.
  const t = Math.max(0, Math.min(1, -(ship.pos.x * dx + ship.pos.z * dz) / l2));
  const cx = ship.pos.x + dx * t;
  const cz = ship.pos.z + dz * t;
  const c = hypot2(cx, cz);
  if (c >= safe - 1e-6) return false;
  // Straight through the centre: pick the side to the ship's left of the line.
  const l = Math.sqrt(l2);
  const nx = c > 1e-6 ? cx / c : -dz / l;
  const nz = c > 1e-6 ? cz / c : dx / l;
  const wp = { x: nx * (safe + TUNING.starRoutePad), z: nz * (safe + TUNING.starRoutePad) };
  steer(ctx, ship, st, wp.x - ship.pos.x, wp.z - ship.pos.z, ctx.assists.avoid, avoidId);
  return true;
}

/**
 * Arrival steering: decelerates into `target`, detouring round the star's heat zone on the way (see `starDetour`).
 * Returns true once there.
 */
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
  const d = hypot2(dx, dz);
  if (d <= stopDist) return true;
  if (starDetour(ctx, ship, st, target, avoidId)) return false;
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
  const safe = rock.trait === 'volatile' ? volatileSafeDistance(rock) : 0;
  if (d > reach) {
    // Volatile rocks need a wider berth, but never past firing range.
    arrive(ctx, ship, st, rock.pos, Math.min(Math.max(reach * 0.8, safe), reach), rock.id);
    return null;
  }
  if (d < safe - TUNING.volatileBackOffSlack && safe < reach) {
    // Too close to a volatile rock to cut it: back out to the safe distance first.
    backOff(ctx, ship, st, rock.pos, d);
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

/** Full throttle straight away from `from`, which lies `d` away. */
function backOff(ctx: TickCtx, ship: Ship, st: ShipStats, from: Vec2, d: number): void {
  if (d > 1e-6) steer(ctx, ship, st, (ship.pos.x - from.x) / d, (ship.pos.z - from.z) / d, ctx.assists.avoid);
  else steer(ctx, ship, st, 1, 0, ctx.assists.avoid);
}

/** True if `pos` lies inside the safe distance of a breaking volatile rock other than `exceptId`. */
export function nearBlast(ctx: TickCtx, pos: Vec2, exceptId: number | null = null): boolean {
  const danger = ctx.index.volatileDanger;
  for (let i = 0; i < danger.length; i++) {
    const r = danger[i]!;
    if (r.id !== exceptId && ctx.index.rockById.has(r.id) && dist(pos, r.pos) < volatileSafeDistance(r)) return true;
  }
  return false;
}

/**
 * Blast reflex for the drone and hauler AI: inside the safe distance of a volatile rock that is close to breaking
 * (see `SimIndex.volatileDanger`), back straight out. Returns true if it steered the ship. It uses the same slack as
 * `workRock`'s stand-off, so a drone cutting that rock from its stand distance carries on.
 */
export function dodgeBlast(ctx: TickCtx, ship: Ship, st: ShipStats): boolean {
  const danger = ctx.index.volatileDanger;
  for (let i = 0; i < danger.length; i++) {
    const r = danger[i]!;
    if (!ctx.index.rockById.has(r.id)) continue;
    const d = dist(ship.pos, r.pos);
    if (d >= volatileSafeDistance(r) - TUNING.volatileBackOffSlack) continue;
    backOff(ctx, ship, st, r.pos, d);
    return true;
  }
  return false;
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
  return inFlareZone(run, pos) || inCometPath(run, ctx.index.comets, pos, TUNING.cometDodgePad);
}

/**
 * Hazard reflexes ahead of the rest of the drone brain: step straight out of a comet path, else shelter from a
 * flare by docking (and staying docked) or fleeing past its reach. Returns true if it steered the drone.
 */
export function dodgeHazards(ctx: TickCtx, ship: Ship, st: ShipStats, full: boolean): boolean {
  const { run } = ctx.state;
  const esc = { x: 0, z: 0 };
  if (cometPathEscape(run, ctx.index.comets, ship.pos, TUNING.cometDodgePad + st.size, esc)) {
    setStatus(ctx.state.out, ship.id, 'avoidComet');
    steer(ctx, ship, st, esc.x, esc.z, ctx.assists.avoid);
    return true;
  }
  if (!inFlareZone(run, ship.pos)) return false;
  setStatus(ctx.state.out, ship.id, 'flare');
  const shelter = { x: 0, z: 0 };
  if (flareShelter(run, ship.pos, full && ctx.assists.autoDock, shelter) === 'dock')
    arrive(ctx, ship, st, run.system.station.pos, TUNING.dockRadius * 0.5);
  else arrive(ctx, ship, st, shelter, 20);
  return true;
}

/**
 * Returns ship `id`'s parking spot: one of six slots on a ring of `radius` around `anchor`,
 * so ships waiting at the same anchor spread out. Returns a fresh vector each call.
 */
export function formationSlot(anchor: Vec2, id: number, radius: number): Vec2 {
  const slot = (id % 6) * ((Math.PI * 2) / 6);
  return { x: anchor.x + Math.cos(slot) * radius, z: anchor.z + Math.sin(slot) * radius };
}

/**
 * Drone brain, used when a drone has no manual order:
 * comet path or flare → get clear · inside a breaking volatile rock's blast → back out · hull below the autorepair threshold → repair at the station (#140) · full →
 * return to station · loose pickups nearby → collect · else mine near the
 * anchor (the flagship in "assist" mode, the station in "auto" mode) · else follow the anchor. Targets in a comet
 * path, a flare zone or a breaking volatile rock's blast are skipped, and an unsafe anchor is waited out in place.
 */
export function droneThink(ctx: TickCtx, ship: Ship, st: ShipStats): void {
  const { run } = ctx.state;
  const station = run.system.station.pos;

  const fs = flagship(run);
  const anchor = ship.aiMode === 'assist' && isAlive(fs) ? fs.pos : station;
  const home = formationSlot(anchor, ship.id, 70);

  const full = isHoldFull(ship, st);
  if (dodgeHazards(ctx, ship, st, full)) {
    ship.aiTargetId = null;
    return;
  }

  const out = ctx.state.out;
  if (dodgeBlast(ctx, ship, st)) {
    setStatus(out, ship.id, 'heading');
    return;
  }

  if (needsRepair(ship, st, ctx.auto)) {
    ship.aiTargetId = null;
    if (!isDocked(run, ship)) {
      setStatus(out, ship.id, 'returning');
      arrive(ctx, ship, st, station, TUNING.dockRadius * 0.5);
    } else setStatus(out, ship.id, 'repairing');
    return;
  }

  if (full) {
    ship.aiTargetId = null;
    // Without auto-dock a full drone waits by its anchor for a manual dock order.
    if (!ctx.assists.autoDock) {
      setStatus(out, ship.id, 'idle');
      arrive(ctx, ship, st, home, 20);
    } else if (!isDocked(run, ship)) {
      setStatus(out, ship.id, 'returning');
      arrive(ctx, ship, st, station, TUNING.dockRadius * 0.5);
    } else setStatus(out, ship.id, 'unloading');
    return;
  }

  // Sweep up debris within a short hop.
  let pickup: Vec2 | null = null;
  let best = 260 * 260;
  for (const p of run.pickups) {
    const d = distSq(ship.pos, p.pos);
    if (d < best && dist(p.pos, anchor) < TUNING.droneLeash && !unsafe(ctx, p.pos) && !nearBlast(ctx, p.pos)) {
      best = d;
      pickup = p.pos;
    }
  }
  if (pickup && best > st.magnet * st.magnet * 0.3) {
    setStatus(out, ship.id, 'collecting');
    arrive(ctx, ship, st, pickup, 6);
    return;
  }

  if (st.dps > 0) {
    let rock = ship.aiTargetId != null ? ctx.index.rockById.get(ship.aiTargetId) : undefined;
    if (
      rock &&
      (!minable(ctx, st, rock) ||
        dist(rock.pos, anchor) > TUNING.droneLeash ||
        unsafe(ctx, rock.pos) ||
        nearBlast(ctx, rock.pos, rock.id))
    )
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
          (r) =>
            minable(ctx, st, r) &&
            dist(r.pos, anchor) < TUNING.droneLeash &&
            !unsafe(ctx, r.pos) &&
            !nearBlast(ctx, r.pos, r.id),
        ) ??
        nearestRock(
          ctx,
          anchor,
          TUNING.droneLeash,
          (r) => minable(ctx, st, r) && !unsafe(ctx, r.pos) && !nearBlast(ctx, r.pos, r.id),
        ) ??
        undefined;
    }
    if (rock) {
      ship.aiTargetId = rock.id;
      const broke = workRock(ctx, ship, st, rock) !== null;
      setStatus(out, ship.id, ship.beamOn ? 'mining' : 'heading', null, rock);
      if (broke) ship.aiTargetId = null;
      return;
    }
  }

  ship.aiTargetId = null;
  if (ship.aiMode === 'assist' && st.dps <= 0) setStatus(out, ship.id, 'escorting');
  else setStatus(out, ship.id, 'idle', 'noRocks');
  if (unsafe(ctx, home) || nearBlast(ctx, home)) steer(ctx, ship, st, 0, 0);
  else arrive(ctx, ship, st, home, 20);
}
