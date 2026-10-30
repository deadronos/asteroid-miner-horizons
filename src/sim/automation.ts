// Automation tier (#39): mining outposts on large rocks and the hauler AI that
// ferries cargo from miners and outposts back to the station. Nothing here
// draws from an RNG, so the run's rock and pickup sequence is untouched.

import { dist, type Vec2 } from '../core/vec';
import { HULLS } from '../data/hulls';
import { RESOURCES, canAfford, emptyWallet, walletTotal, type Wallet } from '../data/resources';
import { TUNING } from '../data/tuning';
import { isDocked } from './economy';
import { needsRepair } from './fleetAuto';
import type { SimIndex } from './index';
import { yieldMul } from './mining';
import { arrive, dodgeBlast, dodgeHazards, formationSlot, unsafe, type TickCtx } from './pilot';
import { setStatus } from './status';
import { cargoFree, findShip, flagship, isAlive, isDrone, isHauler, isHoldFull, type ShipStats } from './ships';
import type { Automation, GameState, Outpost, Rock, Ship } from './types';

export const newAutomation = (): Automation => ({ outposts: [], extracted: 0 });

export const outpostAt = (state: GameState, rockId: number): Outpost | undefined =>
  state.run.automation.outposts.find((o) => o.rockId === rockId);

/** Why an outpost can't be deployed on `rock` right now, or null if it can. */
export function outpostBlock(state: GameState, rock: Rock | undefined): string | null {
  const { run } = state;
  if (!rock) return 'That rock is gone.';
  if (rock.size !== 0 || rock.comet) return 'Outposts need a large asteroid.';
  if (outpostAt(state, rock.id)) return 'That rock already hosts an outpost.';
  if (run.automation.outposts.length >= TUNING.outpostMax) return `Outpost limit reached (${TUNING.outpostMax}).`;
  const fs = flagship(run);
  const gap = dist(fs.pos, rock.pos) - rock.radius - HULLS[fs.hullId].size;
  if (!isAlive(fs) || gap > TUNING.outpostDeployGap) return 'Fly the flagship next to the rock to deploy an outpost.';
  if (!canAfford(run.bank, TUNING.outpostCost)) return 'Not enough resources in the station bank';
  return null;
}

/** A fresh outpost on `rock`, its reserve sized from the rock's own units. */
export function makeOutpost(rock: Rock): Outpost {
  return {
    rockId: rock.id,
    kind: rock.kind,
    pos: { ...rock.pos },
    stored: emptyWallet(),
    reserve: rock.units * TUNING.outpostReserveMul,
  };
}

/** Moves up to `budget` units from `from` into `to`, resource by resource. Returns the units moved. */
export function transfer(from: Wallet, to: Wallet, budget: number): number {
  let moved = 0;
  for (const r of RESOURCES) {
    const n = Math.min(from[r], budget - moved);
    if (n <= 0) continue;
    from[r] -= n;
    to[r] += n;
    moved += n;
  }
  return moved;
}

/** Outposts follow their rock, extract into storage until it is full, and are dismantled once exhausted. */
export function updateOutposts(state: GameState, index: SimIndex, dt: number): void {
  const { run, out } = state;
  const auto = run.automation;
  const mul = yieldMul(state);
  let kept = 0;
  for (let i = 0; i < auto.outposts.length; i++) {
    const o = auto.outposts[i]!;
    const rock = index.rockById.get(o.rockId);
    if (!rock) {
      out.log.push({ level: 'warn', text: 'An outpost was lost with its asteroid.' });
      continue;
    }
    o.pos.x = rock.pos.x;
    o.pos.z = rock.pos.z;
    const stored = walletTotal(o.stored);
    if (o.reserve <= 0 && stored <= 1e-6) {
      out.log.push({ level: 'info', text: `An outpost's ${o.kind} reserve is exhausted; it has been dismantled.` });
      continue;
    }
    const take = Math.min(TUNING.outpostRate * dt, o.reserve, Math.max(0, TUNING.outpostCapacity - stored) / mul);
    if (take > 0) {
      o.reserve -= take;
      o.stored[o.kind] += take * mul;
      auto.extracted += take * mul;
    }
    auto.outposts[kept++] = o;
  }
  auto.outposts.length = kept;
}

/** Something a hauler can load from: a miner's hold or an outpost's storage. */
interface Source {
  /** Ship id or host rock id; both come from `run.nextId`, so they never collide. */
  id: number;
  pos: Vec2;
  vel: Vec2;
  /** Clearance radius: the miner's hull or the host rock. */
  radius: number;
  hold: Wallet;
  /** Rock to exempt from avoidance while approaching. */
  avoidId: number | null;
}

/** The source behind a hauler target id, or null when it has nothing left to give or sits in a hazard. */
function sourceFor(ctx: TickCtx, id: number): Source | null {
  const { run } = ctx.state;
  const o = outpostAt(ctx.state, id);
  if (o) {
    const rock = ctx.index.rockById.get(o.rockId);
    if (!rock || walletTotal(o.stored) <= 1e-6 || unsafe(ctx, rock.pos)) return null;
    return { id, pos: rock.pos, vel: rock.vel, radius: rock.radius, hold: o.stored, avoidId: rock.id };
  }
  const s = findShip(run, id);
  if (!s || !isMiner(ctx, s) || walletTotal(s.cargo) <= 1e-6 || unsafe(ctx, s.pos)) return null;
  return { id, pos: s.pos, vel: s.vel, radius: ctx.index.stats.get(s.id)!.size, hold: s.cargo, avoidId: null };
}

/** A live mining drone out in the field (one docked at the station unloads itself). */
const isMiner = (ctx: TickCtx, s: Ship): boolean => isDrone(s) && isAlive(s) && !isDocked(ctx.state.run, s);

/**
 * Picks the fullest worthwhile source per unit of distance, skipping ones another hauler has claimed or that sit in
 * a flare zone or comet path. Miners count
 * within `haulRange` of the station; outposts anywhere, since the player placed them.
 */
function pickSource(ctx: TickCtx, ship: Ship): number | null {
  const { run } = ctx.state;
  const station = run.system.station.pos;
  let best: number | null = null;
  let bestScore = 0;
  const consider = (id: number, pos: Vec2, load: number): void => {
    if (unsafe(ctx, pos)) return;
    if (run.ships.some((h) => h !== ship && h.aiTargetId === id && isHauler(h))) return;
    const score = load / (dist(ship.pos, pos) + 100);
    if (score > bestScore) {
      bestScore = score;
      best = id;
    }
  };
  for (const s of run.ships) {
    if (!isMiner(ctx, s)) continue;
    const load = walletTotal(s.cargo);
    if (load >= ctx.index.stats.get(s.id)!.cargoCap * TUNING.haulMinShare && dist(s.pos, station) <= TUNING.haulRange)
      consider(s.id, s.pos, load);
  }
  for (const o of run.automation.outposts) {
    const load = walletTotal(o.stored);
    if (load >= TUNING.haulMinOutpost) consider(o.rockId, o.pos, load);
  }
  return best;
}

/**
 * Hauler brain, used when a hauler has no manual order: comet path or flare → get clear · inside a breaking volatile rock's blast → back out · hull
 * below the autorepair threshold → repair at the station (#140) · full → unload at the
 * station · else load from the claimed (or the best) miner or outpost · else unload what it carries · else wait by
 * the station. Haulers never mine.
 */
export function haulerThink(ctx: TickCtx, ship: Ship, st: ShipStats): void {
  const { run } = ctx.state;
  const station = run.system.station.pos;
  const carrying = walletTotal(ship.cargo) > 1e-6;
  const full = isHoldFull(ship, st);
  if (dodgeHazards(ctx, ship, st, full || carrying)) {
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
      arrive(ctx, ship, st, station, TUNING.dockRadius * 0.5, null);
    } else setStatus(out, ship.id, 'repairing');
    return;
  }

  let src = !full && ship.aiTargetId != null ? sourceFor(ctx, ship.aiTargetId) : null;
  if (!full && !src) {
    const id = pickSource(ctx, ship);
    src = id != null ? sourceFor(ctx, id) : null;
  }
  if (src) {
    ship.aiTargetId = src.id;
    setStatus(out, ship.id, ctx.index.outpostRocks.has(src.avoidId ?? -1) ? 'haulOutpost' : 'haulMiner');
    const reach = st.size + src.radius + TUNING.haulTransferGap;
    if (dist(ship.pos, src.pos) > reach) {
      arrive(ctx, ship, st, src.pos, reach * 0.7, src.avoidId);
      return;
    }
    // Hold station alongside and load.
    ship.vel.x = src.vel.x;
    ship.vel.z = src.vel.z;
    transfer(src.hold, ship.cargo, Math.min(TUNING.haulTransferRate * ctx.dt, cargoFree(ship, st)));
    return;
  }

  ship.aiTargetId = null;
  if (carrying && ctx.assists.autoDock) {
    if (!isDocked(run, ship)) {
      setStatus(out, ship.id, 'returning');
      arrive(ctx, ship, st, station, TUNING.dockRadius * 0.5, null);
    } else setStatus(out, ship.id, 'unloading');
    return;
  }
  setStatus(out, ship.id, 'idle', 'nothingToHaul');
  // Idle, or loaded without auto-dock: wait just off the station for work or a manual dock order.
  arrive(ctx, ship, st, formationSlot(station, ship.id, 110), 20, null);
}
