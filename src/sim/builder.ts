// Construction drone brain (#174): builds outposts on large rocks near the station, and hauls when it has nothing to
// build. No RNG: target choice is the nearest eligible rock, ties to the lower id.

import { dist, distSq, type Vec2 } from '../core/vec';
import { walletTotal } from '../data/resources';
import { TUNING } from '../data/tuning';
import { deployOutpostAt, haulStep, outpostBlock } from './automation';
import { isDocked } from './economy';
import { affordAbove, needsRepair } from './fleetAuto';
import { arrive, dodgeBlast, dodgeHazards, nearBlast, unsafe, type TickCtx } from './pilot';
import { findShip, isHoldFull, type ShipStats } from './ships';
import { setStatus, type IdleReason } from './status';
import type { Rock, Ship } from './types';

/** A rock a builder could still put an outpost on, ignoring who else is heading for it. */
const buildable = (ctx: TickCtx, r: Rock): boolean =>
  r.size === 0 && !r.comet && !ctx.index.outpostRocks.has(r.id) && !unsafe(ctx, r.pos) && !nearBlast(ctx, r.pos, r.id);

/** True while another live builder is heading for `rock` (by claim, target or build order). */
function claimedByOther(ctx: TickCtx, ship: Ship, rock: Rock): boolean {
  const id = ctx.index.builderClaims.get(rock.id);
  if (id === undefined || id === ship.id) return false;
  const h = findShip(ctx.state.run, id);
  return !!h && (h.aiTargetId === rock.id || (h.order?.kind === 'build' && h.order.rockId === rock.id));
}

// Scratch for the nearest-rock query, so the per-tick search allocates no closure.
let pickCtx: TickCtx;
let pickShip: Ship;
let pickBest: Rock | null = null;
let pickD = 0;
let pickStation: Vec2;
const considerRock = (r: Rock): void => {
  if (!pickCtx.index.rockById.has(r.id) || !buildable(pickCtx, r) || claimedByOther(pickCtx, pickShip, r)) return;
  if (distSq(r.pos, pickStation) > TUNING.builderLeash * TUNING.builderLeash) return;
  const d = distSq(pickShip.pos, r.pos);
  if (d < pickD || (d === pickD && pickBest !== null && r.id < pickBest.id)) {
    pickD = d;
    pickBest = r;
  }
};

/** The nearest buildable, unclaimed rock within `builderLeash` of the station, or null. */
function pickBuildRock(ctx: TickCtx, ship: Ship, station: Vec2): Rock | null {
  pickCtx = ctx;
  pickShip = ship;
  pickStation = station;
  pickBest = null;
  pickD = Infinity;
  ctx.index.rockHash.query(station, TUNING.builderLeash, considerRock);
  const found = pickBest as Rock | null;
  return found && dist(found.pos, station) <= TUNING.builderLeash ? found : null;
}

/** Drops the ship's claim on its build target (if it holds one), leaving a haul target untouched. */
function release(ctx: TickCtx, ship: Ship): void {
  if (ship.aiTargetId != null && ctx.index.builderClaims.get(ship.aiTargetId) === ship.id) {
    ctx.index.builderClaims.delete(ship.aiTargetId);
    ship.aiTargetId = null;
  }
}

/**
 * Builder brain, used when a construction drone has no move or dock order: comet path or flare → get clear · inside a
 * breaking volatile rock's blast → back out · hull below the autorepair threshold → repair (#140) · a build order, else
 * (BUILD on, under `outpostMax`, bank above `builderReserve`) the nearest free large rock near the station → unload
 * any cargo, fly there and deploy (an order on a rock that is unsafe for now is kept, not dropped) · else haul like a hauler, with the build blocker as the status reason.
 */
export function builderThink(ctx: TickCtx, ship: Ship, st: ShipStats): void {
  const { state, index } = ctx;
  const { run, out } = state;
  const station = run.system.station.pos;
  const carrying = walletTotal(ship.cargo) > 1e-6;
  if (dodgeHazards(ctx, ship, st, isHoldFull(ship, st) || carrying)) {
    release(ctx, ship);
    ship.aiTargetId = null;
    return;
  }
  if (dodgeBlast(ctx, ship, st)) {
    setStatus(out, ship.id, 'heading');
    return;
  }
  if (needsRepair(ship, st, ctx.auto)) {
    release(ctx, ship);
    ship.aiTargetId = null;
    if (!isDocked(run, ship)) {
      setStatus(out, ship.id, 'returning');
      arrive(ctx, ship, st, station, TUNING.dockRadius * 0.5, null);
    } else if (index.repairWait.has(ship.id)) setStatus(out, ship.id, 'idle', 'repairMoney');
    else setStatus(out, ship.id, 'repairing');
    return;
  }

  let rock: Rock | null = null;
  let orderHeld = false;
  const order = ship.order?.kind === 'build' ? ship.order : null;
  if (order) {
    rock = index.rockById.get(order.rockId) ?? null;
    const flaw = !rock
      ? 'That rock is gone.'
      : rock.size !== 0 || rock.comet
        ? 'Outposts need a large asteroid.'
        : index.outpostRocks.has(rock.id)
          ? 'That rock already hosts an outpost.'
          : null;
    if (flaw) {
      out.log.push({ level: 'warn', text: `${ship.name} can't build there: ${flaw}` });
      ship.order = null;
      rock = null;
    } else if (rock && (unsafe(ctx, rock.pos) || nearBlast(ctx, rock.pos, rock.id))) {
      // The order stays; the builder keeps clear and carries it out once the rock is safe again.
      rock = null;
      orderHeld = true;
    }
  }
  const blocker: 'outpostLimit' | 'belowReserve' | null =
    run.automation.outposts.length >= TUNING.outpostMax
      ? 'outpostLimit'
      : !affordAbove(run.bank, TUNING.outpostCost, ctx.auto.builderReserve)
        ? 'belowReserve'
        : null;
  let why: IdleReason | null = blocker;
  // A build order that cannot go ahead says so, rather than looking like ordinary hauling.
  if (order && (orderHeld || blocker)) why = 'buildWaiting';
  if (!blocker && !rock && !orderHeld && ship.autoBuild) {
    const held = ship.aiTargetId != null ? index.rockById.get(ship.aiTargetId) : undefined;
    rock =
      held &&
      index.builderClaims.get(held.id) === ship.id &&
      buildable(ctx, held) &&
      dist(held.pos, station) <= TUNING.builderLeash
        ? held
        : pickBuildRock(ctx, ship, station);
    if (!rock) why = 'noBuildSite';
  }

  if (rock && !blocker) {
    // Unload before heading out to build (without auto-dock a loaded builder just goes).
    if (carrying && ctx.assists.autoDock) {
      release(ctx, ship);
      ship.aiTargetId = null;
      if (!isDocked(run, ship)) {
        setStatus(out, ship.id, 'returning');
        arrive(ctx, ship, st, station, TUNING.dockRadius * 0.5, null);
      } else setStatus(out, ship.id, 'unloading');
      return;
    }
    index.builderClaims.set(rock.id, ship.id);
    ship.aiTargetId = rock.id;
    const gap = dist(ship.pos, rock.pos) - rock.radius - st.size;
    if (gap > TUNING.outpostDeployGap) {
      setStatus(out, ship.id, 'buildHeading', null, rock);
      arrive(ctx, ship, st, rock.pos, rock.radius + st.size + TUNING.outpostDeployGap * 0.7, rock.id);
      return;
    }
    setStatus(out, ship.id, 'building', null, rock);
    // A ready time beyond one interval ahead was set in an earlier run (warps restart run.time): ignore it.
    const ready = index.buildReadyAt.get(ship.id) ?? 0;
    if (run.time < ready && ready - run.time <= TUNING.buildInterval) {
      ship.vel.x = rock.vel.x;
      ship.vel.z = rock.vel.z;
      return;
    }
    if (!outpostBlock(state, rock, ship)) {
      index.buildReadyAt.set(ship.id, run.time + TUNING.buildInterval);
      deployOutpostAt(state, rock);
      index.builderClaims.delete(rock.id);
      ship.aiTargetId = null;
      ship.order = null;
      return;
    }
    why = 'noBuildSite';
  }

  release(ctx, ship);
  haulStep(ctx, ship, st, why);
}
