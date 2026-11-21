import { SpatialHash } from '../core/spatialHash';
import type { Vec2 } from '../core/vec';
import type { HazardLevel } from '../data/hazards';
import type { Wallet } from '../data/resources';
import { TUNING } from '../data/tuning';
import { DEFAULT_ASSISTS, DEFAULT_FLEET_AUTO, type Assists, type FleetAuto } from './assists';
import { applyEffects, systemEffects } from './modifiers';
import type { TickCtx } from './pilot';
import { emptyStats, writeShipStats, type ShipStats } from './ships';
import type { ShipStatus } from './status';
import type { GameState, Pickup, Rock, Ship } from './types';

/** Scratch state for `magnetPull` shipHash queries. */
export interface MagnetQuery {
  rockX: number;
  rockZ: number;
  bestD: number;
  bestId: number;
  bestDx: number;
  bestDz: number;
}

/** Scratch state for `updatePickups` shipHash queries. */
export interface PickupShipQuery {
  px: number;
  pz: number;
  bestD: number;
  best: Ship | null;
  stats: Map<number, ShipStats> | null;
}

/** Scratch state for `collideRocks` rockHash queries. */
export interface CollideQuery {
  ctx: TickCtx | null;
  ship: Ship | null;
  st: ShipStats | null;
}

/** Scratch state for `avoidance` rockHash queries. */
export interface AvoidQuery {
  index: SimIndex | null;
  shipX: number;
  shipZ: number;
  shipSize: number;
  dx: number;
  dz: number;
  look: number;
  ignoreId: number | null;
  ax: number;
  az: number;
  danger: number;
}

/** Scratch state for `brakeForRocks` rockHash queries. */
export interface BrakeQuery {
  index: SimIndex | null;
  ship: Ship | null;
  shipSize: number;
  cap: number;
  decel: number;
  maxDv: number;
}

/** Scratch state for `workRock` splash rockHash queries. */
export interface SplashQuery {
  ctx: TickCtx | null;
  rock: Rock | null;
  st: ShipStats | null;
  dmg: number;
  frags: Rock[] | null;
}

/** Scratch state for `nearestRock` and `scoredRock` rockHash queries. */
export interface RockSearchQuery {
  ctx: TickCtx | null;
  st: ShipStats | null;
  from: Vec2 | null;
  anchor: Vec2 | null;
  leash: number;
  bank: Wallet | null;
  limit: number;
  bestScore: number;
  best: Rock | null;
}

/** Scratch state for `droneThink` pickupHash queries. */
export interface DronePickupQuery {
  ctx: TickCtx | null;
  shipPos: Vec2 | null;
  anchor: Vec2 | null;
  bestD: number;
  bestId: number;
  bestPos: Vec2 | null;
}

/**
 * Per-session derived state. Not persisted: it is rebuilt from GameState every
 * tick and holds references into the current run's rocks/ships.
 */
export class SimIndex {
  readonly rockHash = new SpatialHash<Rock>(128);
  readonly shipHash = new SpatialHash<Ship>(256);
  readonly pickupHash = new SpatialHash<Pickup>(256);
  readonly rockById = new Map<number, Rock>();
  /** Largest `ShipStats.magnet` among live ships in the last `rebuild`; bounds `updatePickups` ship queries. */
  maxMagnet = 0;
  /** Length of `run.pickups` when `pickupHash` was last rebuilt, so mid-tick spawns can be checked too. */
  pickupHashCount = 0;
  /**
   * Each ship's stats with the current system's modifiers applied (see
   * `applyEffects`). Reused across ticks, keyed by ship id and pruned in
   * `rebuild`; only `clear` empties it.
   */
  readonly stats = new Map<number, ShipStats>();
  /** Scratch for the ship loop: ids updated this tick, so a rewind does not tick one twice. */
  readonly updatedShipIds = new Set<number>();
  /** Live comet rocks, collected in `rebuild`. */
  readonly comets: Rock[] = [];
  /**
   * Volatile rocks worn below `volatileWarnHp` of their hp, collected in `rebuild`: close to breaking, so the drone
   * and hauler AI keep clear of their blast (`pilot.dodgeBlast`).
   */
  readonly volatileDanger: Rock[] = [];
  /** Ids of rocks hosting an outpost, collected in `rebuild`; mining AI skips them. */
  readonly outpostRocks = new Set<number>();
  /** Ships already told they are waiting docked for repair money, so the warning logs once per wait (#140). */
  readonly repairWait = new Set<number>();
  /** Run time each ship may take its next autoupgrade step (#140). Transient: a reload just allows one at once. */
  readonly upgradeReadyAt = new Map<number, number>();
  /** Rock id → id of the construction drone heading to build on it (#174). Transient; pruned in `rebuild`. */
  readonly builderClaims = new Map<number, number>();
  /** Run time each construction drone may deploy its next outpost. Transient, like `upgradeReadyAt`. */
  readonly buildReadyAt = new Map<number, number>();
  /** Scratch for `regrowBelts`: live rocks per belt. */
  readonly beltCounts: number[] = [];
  /** Scratch vectors for hot per-ship steering and hazard reflexes; callers consume them before the next call. */
  readonly scratchAvoid: Vec2 = { x: 0, z: 0 };
  readonly scratchEscape: Vec2 = { x: 0, z: 0 };
  readonly scratchShelter: Vec2 = { x: 0, z: 0 };
  readonly scratchHome: Vec2 = { x: 0, z: 0 };
  /** Reusable query scratch objects for zero-closure `SpatialHash.queryWith` calls. */
  readonly qMagnet: MagnetQuery = { rockX: 0, rockZ: 0, bestD: -1, bestId: Infinity, bestDx: 0, bestDz: 0 };
  readonly qPickupShip: PickupShipQuery = { px: 0, pz: 0, bestD: Infinity, best: null, stats: null };
  readonly qCollide: CollideQuery = { ctx: null, ship: null, st: null };
  readonly qAvoid: AvoidQuery = {
    index: null,
    shipX: 0,
    shipZ: 0,
    shipSize: 0,
    dx: 0,
    dz: 0,
    look: 0,
    ignoreId: null,
    ax: 0,
    az: 0,
    danger: 0,
  };
  readonly qBrake: BrakeQuery = { index: null, ship: null, shipSize: 0, cap: 0, decel: 0, maxDv: 0 };
  readonly qSplash: SplashQuery = { ctx: null, rock: null, st: null, dmg: 0, frags: null };
  readonly qRockSearch: RockSearchQuery = {
    ctx: null,
    st: null,
    from: null,
    anchor: null,
    leash: 0,
    bank: null,
    limit: 0,
    bestScore: Infinity,
    best: null,
  };
  readonly qDronePickup: DronePickupQuery = {
    ctx: null,
    shipPos: null,
    anchor: null,
    bestD: 0,
    bestId: Infinity,
    bestPos: null,
  };
  /** Reusable tick context, populated by `beginTick` and cleared by `endTick` so no GameState lingers. */
  private readonly tickCtxState: {
    state: GameState | undefined;
    index: SimIndex;
    dt: number;
    assists: Assists;
    auto: FleetAuto;
    hazards: HazardLevel;
  } = {
    state: undefined,
    index: this,
    dt: 0,
    assists: DEFAULT_ASSISTS,
    auto: DEFAULT_FLEET_AUTO,
    hazards: 'off',
  };
  /** Ids seen in the last `rebuild`, so the next one can prune the departed. */
  private readonly liveShipIds = new Set<number>();
  /** The state's status map during `rebuild`, so the bound prune callback can reach it. */
  private statusMap: Map<number, ShipStatus> | null = null;

  // Bound once: `forEach` with a stored callback allocates neither an iterator nor a closure per tick.
  private readonly pruneUpgrade = (_t: number, id: number): void => {
    if (!this.liveShipIds.has(id)) this.upgradeReadyAt.delete(id);
  };
  private readonly pruneBuildReady = (_t: number, id: number): void => {
    if (!this.liveShipIds.has(id)) this.buildReadyAt.delete(id);
  };
  private readonly pruneClaim = (shipId: number, rockId: number): void => {
    if (!this.liveShipIds.has(shipId) || !this.rockById.has(rockId)) this.builderClaims.delete(rockId);
  };
  private readonly pruneStats = (_s: ShipStats, id: number): void => {
    if (!this.liveShipIds.has(id)) this.stats.delete(id);
  };
  private readonly pruneStatus = (_s: ShipStatus, id: number): void => {
    if (!this.liveShipIds.has(id)) this.statusMap?.delete(id);
  };
  private readonly pruneWait = (id: number): void => {
    if (!this.liveShipIds.has(id)) this.repairWait.delete(id);
  };

  /** Rebuild all derived structures for `state`, reusing the same instances. */
  rebuild(state: GameState): void {
    const { run } = state;
    this.rockHash.rebuild(run.rocks);
    this.shipHash.rebuild(run.ships);
    this.pickupHash.rebuild(run.pickups);
    this.pickupHashCount = run.pickups.length;
    // Re-setting a present key allocates nothing, unlike `clear` + refill, which regrows the table every tick.
    // Every live rock is set below, so any extra entry is a departed rock: only then rebuild from scratch.
    const byId = this.rockById;
    this.comets.length = 0;
    this.volatileDanger.length = 0;
    const rocks = run.rocks;
    for (let i = 0; i < rocks.length; i++) {
      const r = rocks[i]!;
      byId.set(r.id, r);
      if (r.comet) this.comets.push(r);
      if (r.trait === 'volatile' && r.hp < r.maxHp * TUNING.volatileWarnHp) this.volatileDanger.push(r);
    }
    if (byId.size !== run.rocks.length) {
      byId.clear();
      for (let i = 0; i < rocks.length; i++) byId.set(rocks[i]!.id, rocks[i]!);
    }
    this.outpostRocks.clear();
    const outposts = run.automation.outposts;
    for (let i = 0; i < outposts.length; i++) this.outpostRocks.add(outposts[i]!.rockId);

    const fx = systemEffects(run.system.modifiers); // once per tick, not per ship
    this.liveShipIds.clear();
    let maxMagnet = 0;
    const ships = run.ships;
    for (let i = 0; i < ships.length; i++) {
      const s = ships[i]!;
      this.liveShipIds.add(s.id);
      let st = this.stats.get(s.id);
      if (!st) this.stats.set(s.id, (st = emptyStats()));
      applyEffects(writeShipStats(st, s, state.profile), fx);
      if (st.magnet > maxMagnet) maxMagnet = st.magnet;
    }
    this.maxMagnet = maxMagnet;
    // A scrapped or destroyed ship's entry must not linger for the whole run.
    // Iterating a Map or Set allocates an iterator, so skip it when nothing can be stale.
    if (this.stats.size !== run.ships.length) this.stats.forEach(this.pruneStats);
    if (state.out.status.size > 0) {
      this.statusMap = state.out.status;
      this.statusMap.forEach(this.pruneStatus);
      this.statusMap = null;
    }
    if (this.upgradeReadyAt.size > 0) this.upgradeReadyAt.forEach(this.pruneUpgrade);
    if (this.repairWait.size > 0) this.repairWait.forEach(this.pruneWait);
    if (this.buildReadyAt.size > 0) this.buildReadyAt.forEach(this.pruneBuildReady);
    if (this.builderClaims.size > 0) this.builderClaims.forEach(this.pruneClaim);
  }

  /** Populate and return the reusable tick context for `state`. Call `endTick()` when the tick finishes. */
  beginTick(state: GameState, dt: number, assists: Assists, auto: FleetAuto, hazards: HazardLevel): TickCtx {
    const ctx = this.tickCtxState;
    ctx.state = state;
    ctx.dt = dt;
    ctx.assists = assists;
    ctx.auto = auto;
    ctx.hazards = hazards;
    return ctx as TickCtx;
  }

  /** Drop the transient `GameState` reference held during a tick. */
  endTick(): void {
    this.tickCtxState.state = undefined;
  }

  /** Drop every reference; used when the running game is swapped. */
  clear(): void {
    this.endTick();
    this.rockHash.rebuild([]);
    this.shipHash.rebuild([]);
    this.pickupHash.rebuild([]);
    this.maxMagnet = 0;
    this.pickupHashCount = 0;
    this.rockById.clear();
    this.comets.length = 0;
    this.volatileDanger.length = 0;
    this.outpostRocks.clear();
    this.stats.clear();
    this.liveShipIds.clear();
    this.upgradeReadyAt.clear();
    this.repairWait.clear();
    this.buildReadyAt.clear();
    this.builderClaims.clear();
    this.beltCounts.length = 0;
    this.qPickupShip.best = null;
    this.qPickupShip.stats = null;
    this.qCollide.ctx = null;
    this.qCollide.ship = null;
    this.qCollide.st = null;
    this.qAvoid.index = null;
    this.qBrake.index = null;
    this.qBrake.ship = null;
    this.qSplash.ctx = null;
    this.qSplash.rock = null;
    this.qSplash.st = null;
    this.qSplash.frags = null;
    this.qRockSearch.ctx = null;
    this.qRockSearch.st = null;
    this.qRockSearch.from = null;
    this.qRockSearch.anchor = null;
    this.qRockSearch.bank = null;
    this.qRockSearch.best = null;
    this.qDronePickup.ctx = null;
    this.qDronePickup.shipPos = null;
    this.qDronePickup.anchor = null;
    this.qDronePickup.bestPos = null;
  }
}
