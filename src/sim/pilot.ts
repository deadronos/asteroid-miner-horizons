// Ship piloting: order execution, mining, hazard reflexes and the drone AI.
// Low-level steering and avoidance live in `steering.ts`. Everything here operates on one ship per call.

import { damp, dist, distSq, type Vec2 } from '../core/vec';
import type { RawResource, Wallet } from '../data/resources';
import { TUNING } from '../data/tuning';
import { isDocked } from './economy';
import { cometPathEscape, flareShelter, inCometPath, inFlareZone } from './hazards';
import type { DronePickupQuery, RockSearchQuery, SplashQuery } from './index';
import { needsRepair } from './fleetAuto';
import { laserRock } from './mining';
import { flagship, isAlive, isHoldFull, type ShipStats } from './ships';
import { setStatus } from './status';
import { arrive, backOff, brakeForRocks, steer, type TickCtx } from './steering';
import { canMine, volatileSafeDistance } from './traits';
import type { Pickup, Rock, Ship } from './types';

export { arrive, brakeForRocks, steer, type TickCtx };

function visitSplashRock(n: Rock, q: SplashQuery): void {
  const ctx = q.ctx!;
  const rock = q.rock!;
  const st = q.st!;
  if (n.id === rock.id || !ctx.index.rockById.has(n.id) || ctx.index.outpostRocks.has(n.id)) return;
  if (dist(n.pos, rock.pos) > st.splash + n.radius) return;
  const nf = laserRock(ctx.state, n, q.dmg, st.laserTier);
  if (nf) {
    ctx.index.rockById.delete(n.id);
    (q.frags ??= []).push(...nf);
  }
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
    const q = ctx.index.qSplash;
    q.ctx = ctx;
    q.rock = rock;
    q.st = st;
    q.dmg = st.dps * ctx.dt * TUNING.splashMul;
    q.frags = frags;
    ctx.index.rockHash.queryWith(rock.pos, st.splash + 60, q, visitSplashRock);
    frags = q.frags;
    q.ctx = null;
    q.rock = null;
    q.st = null;
    q.frags = null;
  }
  return frags;
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

function visitNearestRock(r: Rock, q: RockSearchQuery): void {
  const ctx = q.ctx!;
  if (!ctx.index.rockById.has(r.id) || !minable(ctx, q.st!, r)) return;
  const d = distSq(q.from!, r.pos);
  if (d < q.bestScore) {
    q.bestScore = d;
    q.best = r;
  }
}

function nearestRock(ctx: TickCtx, from: Vec2, radius: number, st: ShipStats): Rock | null {
  const q = ctx.index.qRockSearch;
  q.ctx = ctx;
  q.st = st;
  q.from = from;
  q.bestScore = radius * radius;
  q.best = null;
  ctx.index.rockHash.queryWith(from, radius, q, visitNearestRock);
  const best = q.best;
  q.ctx = null;
  q.st = null;
  q.from = null;
  q.best = null;
  return best;
}

/**
 * How much the bank wants `kind`: 1 for the most plentiful raw resource, up to 1 + `scarcityWeight` for an empty
 * one. An empty bank wants everything equally (1).
 */
export function need(bank: Wallet, kind: RawResource): number {
  const top = Math.max(bank.ore, bank.ice, bank.crystal);
  const share = top > 0 ? bank[kind] / top : 1;
  return 1 + TUNING.scarcityWeight * (1 - share);
}

function visitScoredRock(r: Rock, q: RockSearchQuery): void {
  const ctx = q.ctx!;
  if (
    !ctx.index.rockById.has(r.id) ||
    !minable(ctx, q.st!, r) ||
    (q.anchor !== null && dist(r.pos, q.anchor) >= q.leash) ||
    unsafe(ctx, r.pos) ||
    nearBlast(ctx, r.pos, r.id)
  )
    return;
  const d2 = distSq(q.from!, r.pos);
  if (d2 >= q.limit) return;
  const n = need(q.bank!, r.kind);
  const score = d2 / (n * n);
  if (score < q.bestScore || (score === q.bestScore && q.best !== null && r.id < q.best.id)) {
    q.bestScore = score;
    q.best = r;
  }
}

/**
 * Like `nearestRock`, but ranks by distance divided by `need`, so a scarcer resource wins from further away.
 * Lowest score wins; ties go to the lower rock id.
 */
function scoredRock(
  ctx: TickCtx,
  from: Vec2,
  radius: number,
  st: ShipStats,
  bank: Wallet,
  anchor: Vec2 | null,
  leash: number,
): Rock | null {
  const q = ctx.index.qRockSearch;
  q.ctx = ctx;
  q.st = st;
  q.from = from;
  q.anchor = anchor;
  q.leash = leash;
  q.bank = bank;
  q.limit = radius * radius;
  q.bestScore = Infinity;
  q.best = null;
  ctx.index.rockHash.queryWith(from, radius, q, visitScoredRock);
  const best = q.best;
  q.ctx = null;
  q.st = null;
  q.from = null;
  q.anchor = null;
  q.bank = null;
  q.best = null;
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
  return nearestRock(ctx, ship.pos, st.range * 1.2, st)?.id ?? null;
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
  } else if (o.kind === 'build') {
    return false; // The builder brain runs it, after the reflexes (see builderThink).
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
  const escape = ctx.index.scratchEscape;
  if (cometPathEscape(run, ctx.index.comets, ship.pos, TUNING.cometDodgePad + st.size, escape)) {
    setStatus(ctx.state.out, ship.id, 'avoidComet');
    steer(ctx, ship, st, escape.x, escape.z, ctx.assists.avoid, null, false);
    return true;
  }
  if (!inFlareZone(run, ship.pos)) return false;
  setStatus(ctx.state.out, ship.id, 'flare');
  const shelter = ctx.index.scratchShelter;
  if (flareShelter(run, ship.pos, full && ctx.assists.autoDock, shelter) === 'dock')
    arrive(ctx, ship, st, run.system.station.pos, TUNING.dockRadius * 0.5, null, false);
  else arrive(ctx, ship, st, shelter, 20, null, false);
  return true;
}

/** Writes ship `id`'s parking spot into `out` and returns `out`, avoiding an allocation on hot paths. */
function formationSlotInto(anchor: Vec2, id: number, radius: number, out: Vec2): Vec2 {
  const slot = (id % 6) * ((Math.PI * 2) / 6);
  out.x = anchor.x + Math.cos(slot) * radius;
  out.z = anchor.z + Math.sin(slot) * radius;
  return out;
}

/**
 * Returns ship `id`'s parking spot: one of six slots on a ring of `radius` around `anchor`,
 * so ships waiting at the same anchor spread out. Returns a fresh vector each call.
 */
export function formationSlot(anchor: Vec2, id: number, radius: number): Vec2 {
  return formationSlotInto(anchor, id, radius, { x: 0, z: 0 });
}

function visitDronePickup(p: Pickup, q: DronePickupQuery): void {
  const d = distSq(q.shipPos!, p.pos);
  if (
    (d < q.bestD || (d === q.bestD && q.bestPos !== null && p.id < q.bestId)) &&
    dist(p.pos, q.anchor!) < TUNING.droneLeash &&
    !unsafe(q.ctx!, p.pos) &&
    !nearBlast(q.ctx!, p.pos)
  ) {
    q.bestD = d;
    q.bestId = p.id;
    q.bestPos = p.pos;
  }
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
    } else if (ctx.index.repairWait.has(ship.id)) setStatus(out, ship.id, 'idle', 'repairMoney');
    else setStatus(out, ship.id, 'repairing');
    return;
  }

  if (full) {
    ship.aiTargetId = null;
    // Without auto-dock a full drone waits by its anchor for a manual dock order.
    if (!ctx.assists.autoDock) {
      setStatus(out, ship.id, 'idle');
      arrive(ctx, ship, st, formationSlotInto(anchor, ship.id, 70, ctx.index.scratchHome), 20);
    } else if (!isDocked(run, ship)) {
      setStatus(out, ship.id, 'returning');
      arrive(ctx, ship, st, station, TUNING.dockRadius * 0.5);
    } else setStatus(out, ship.id, 'unloading');
    return;
  }

  // Sweep up debris within a short hop.
  if (run.pickups.length > 0) {
    const q = ctx.index.qDronePickup;
    q.ctx = ctx;
    q.shipPos = ship.pos;
    q.anchor = anchor;
    q.bestD = 260 * 260;
    q.bestId = Infinity;
    q.bestPos = null;
    ctx.index.pickupHash.queryWith(ship.pos, 260, q, visitDronePickup);
    // Include any pickups spawned by earlier ships in this same tick after `pickupHash` was built.
    for (let i = ctx.index.pickupHashCount; i < run.pickups.length; i++) visitDronePickup(run.pickups[i]!, q);
    const pickup = q.bestPos;
    const best = q.bestD;
    q.ctx = null;
    q.shipPos = null;
    q.anchor = null;
    q.bestPos = null;
    if (pickup && best > st.magnet * st.magnet * 0.3) {
      setStatus(out, ship.id, 'collecting');
      arrive(ctx, ship, st, pickup, 6);
      return;
    }
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
        scoredRock(ctx, ship.pos, 500, st, run.bank, anchor, TUNING.droneLeash) ??
        scoredRock(ctx, anchor, TUNING.droneLeash, st, run.bank, null, 0) ??
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
  const home = formationSlotInto(anchor, ship.id, 70, ctx.index.scratchHome);
  if (unsafe(ctx, home) || nearBlast(ctx, home)) steer(ctx, ship, st, 0, 0);
  else arrive(ctx, ship, st, home, 20);
}
