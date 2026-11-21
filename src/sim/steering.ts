// Low-level ship steering: obstacle avoidance, rock-approach braking, star-heat
// detours and arrival. Everything here operates on one ship per call.

import { damp, hypot2, len, type Vec2 } from '../core/vec';
import type { HazardLevel } from '../data/hazards';
import { TUNING } from '../data/tuning';
import type { Assists, FleetAuto } from './assists';
import type { AvoidQuery, BrakeQuery, SimIndex } from './index';
import type { ShipStats } from './ships';
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

function visitAvoidRock(r: Rock, q: AvoidQuery): void {
  if (r.id === q.ignoreId || !q.index!.rockById.has(r.id)) return;
  const rx = r.pos.x - q.shipX;
  const rz = r.pos.z - q.shipZ;
  const d = hypot2(rx, rz) || 0.01;
  const gap = d - r.radius - q.shipSize;
  if (gap < 12) {
    const k = (1 - Math.max(0, gap) / 12) * 2;
    q.ax -= (rx / d) * k;
    q.az -= (rz / d) * k;
  }
  const along = rx * q.dx + rz * q.dz;
  if (along < 0 || along - r.radius > q.look) return;
  const lateral = rx * -q.dz + rz * q.dx; // + means the rock is to the left
  const clearance = r.radius + q.shipSize + 14;
  if (Math.abs(lateral) >= clearance) return;
  const urgency = (1 - Math.max(0, along - r.radius) / q.look) * (1 - (Math.abs(lateral) / clearance) * 0.5) * 2.2;
  q.danger = Math.max(q.danger, urgency / 2.2);
  const side = lateral > 0 ? -1 : 1; // sidestep away from the rock's side
  q.ax += -q.dz * side * urgency;
  q.az += q.dx * side * urgency;
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
  const q = ctx.index.qAvoid;
  q.index = ctx.index;
  q.shipX = ship.pos.x;
  q.shipZ = ship.pos.z;
  q.shipSize = st.size;
  q.dx = dx;
  q.dz = dz;
  q.look = look;
  q.ignoreId = ignoreId;
  q.ax = 0;
  q.az = 0;
  q.danger = 0;
  ctx.index.rockHash.queryWith(ship.pos, look + 50, q, visitAvoidRock);
  q.index = null;
  out.x = q.ax;
  out.z = q.az;
  return q.danger;
}

function visitBrakeRock(r: Rock, q: BrakeQuery): void {
  if (r.comet || !q.index!.rockById.has(r.id)) return;
  const ship = q.ship!;
  const rx = r.pos.x - ship.pos.x;
  const rz = r.pos.z - ship.pos.z;
  const d = hypot2(rx, rz) || 0.01;
  const nx = rx / d;
  const nz = rz / d;
  const closing = (ship.vel.x - r.vel.x) * nx + (ship.vel.z - r.vel.z) * nz;
  if (closing <= q.cap) return;
  const gap = d - r.radius - q.shipSize;
  if (gap > (closing * closing - q.cap * q.cap) / (2 * q.decel) + 2) return;
  const dv = Math.min(closing - q.cap, q.maxDv);
  ship.vel.x -= nx * dv;
  ship.vel.z -= nz * dv;
}

/**
 * Rock-approach brake: bleeds off the part of the ship's velocity (relative to each nearby rock) that closes on the
 * rock faster than `rockApproachCap` of the collision threshold, as late as the ship's acceleration allows. Open
 * space is untouched; only a rock within stopping distance slows the ship. Comets are left to the dodge reflexes.
 */
export function brakeForRocks(ctx: TickCtx, ship: Ship, st: ShipStats): void {
  const cap = TUNING.collisionMinSpeed * TUNING.rockApproachCap;
  const decel = st.accel * TUNING.rockBrakeMargin;
  const sp = len(ship.vel);
  const stopReach = sp > cap ? (sp * sp - cap * cap) / (2 * decel) + 50 : 50;
  const q = ctx.index.qBrake;
  q.index = ctx.index;
  q.ship = ship;
  q.shipSize = st.size;
  q.cap = cap;
  q.decel = decel;
  q.maxDv = st.accel * ctx.dt;
  ctx.index.rockHash.queryWith(ship.pos, st.size + Math.max(90, stopReach), q, visitBrakeRock);
  q.index = null;
  q.ship = null;
}

/**
 * Accelerate along a wish vector (length 0..1), capped at top speed.
 * `avoid` enables autopilot obstacle avoidance (off for manual WASD flight);
 * `ignoreId` exempts the rock being approached for mining. `brake` (with `avoid`) slows the approach to nearby rocks;
 * hazard reflexes pass false so nothing holds a ship back from leaving danger.
 */
export function steer(
  ctx: TickCtx,
  ship: Ship,
  st: ShipStats,
  wx: number,
  wz: number,
  avoid = false,
  ignoreId: number | null = null,
  brake = true,
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
    const avoidVec = ctx.index.scratchAvoid;
    const danger = avoidance(ctx, ship, st, px, pz, ignoreId, avoidVec);
    x += avoidVec.x * Math.max(want, 0.5);
    z += avoidVec.z * Math.max(want, 0.5);
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
  if (avoid && brake) brakeForRocks(ctx, ship, st);
}

/**
 * Star detour: when the straight line to `target` would cross the star's heat zone, steers for the point on a safe
 * circle beside the line's closest approach instead and returns true. It re-aims every tick, so the route bends
 * round the star in an arc. The safe circle shrinks to the target's own distance from the star, so a point inside
 * it (a player's move order) is still reached, just by the shortest path that does not dip deeper.
 */
function starDetour(
  ctx: TickCtx,
  ship: Ship,
  st: ShipStats,
  target: Vec2,
  avoidId: number | null,
  brake: boolean,
): boolean {
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
  const wx = nx * (safe + TUNING.starRoutePad);
  const wz = nz * (safe + TUNING.starRoutePad);
  steer(ctx, ship, st, wx - ship.pos.x, wz - ship.pos.z, ctx.assists.avoid, avoidId, brake);
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
  rockBrake = true,
): boolean {
  const dx = target.x - ship.pos.x;
  const dz = target.z - ship.pos.z;
  const d = hypot2(dx, dz);
  if (d <= stopDist) return true;
  if (starDetour(ctx, ship, st, target, avoidId, rockBrake)) return false;
  // Slow down within the braking distance v²/2a.
  const brake = (st.speed * st.speed) / (2 * st.accel) + 20;
  const throttle = Math.min(1, (d - stopDist) / brake + 0.08);
  steer(ctx, ship, st, (dx / d) * throttle, (dz / d) * throttle, ctx.assists.avoid, avoidId, rockBrake);
  return false;
}

/** Full throttle straight away from `from`, which lies `d` away. */
export function backOff(ctx: TickCtx, ship: Ship, st: ShipStats, from: Vec2, d: number): void {
  if (d > 1e-6)
    steer(ctx, ship, st, (ship.pos.x - from.x) / d, (ship.pos.z - from.z) / d, ctx.assists.avoid, null, false);
  else steer(ctx, ship, st, 1, 0, ctx.assists.avoid, null, false);
}
