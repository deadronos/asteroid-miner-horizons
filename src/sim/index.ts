import { SpatialHash } from '../core/spatialHash';
import { TUNING } from '../data/tuning';
import { applyEffects, systemEffects } from './modifiers';
import { emptyStats, writeShipStats, type ShipStats } from './ships';
import type { GameState, Rock } from './types';

/**
 * Per-session derived state. Not persisted: it is rebuilt from GameState every
 * tick and holds references into the current run's rocks/ships.
 */
export class SimIndex {
  readonly rockHash = new SpatialHash<Rock>(128);
  readonly rockById = new Map<number, Rock>();
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
  /** Ids seen in the last `rebuild`, so the next one can prune the departed. */
  private readonly liveShipIds = new Set<number>();

  // Bound once: `forEach` with a stored callback allocates neither an iterator nor a closure per tick.
  private readonly pruneUpgrade = (_t: number, id: number): void => {
    if (!this.liveShipIds.has(id)) this.upgradeReadyAt.delete(id);
  };
  private readonly pruneStats = (_s: ShipStats, id: number): void => {
    if (!this.liveShipIds.has(id)) this.stats.delete(id);
  };
  private readonly pruneWait = (id: number): void => {
    if (!this.liveShipIds.has(id)) this.repairWait.delete(id);
  };

  /** Rebuild all three structures for `state`, reusing the same instances. */
  rebuild(state: GameState): void {
    const { run } = state;
    this.rockHash.rebuild(run.rocks);
    // Re-setting a present key allocates nothing, unlike `clear` + refill, which regrows the table every tick.
    // Every live rock is set below, so any extra entry is a departed rock: only then rebuild from scratch.
    const byId = this.rockById;
    this.comets.length = 0;
    this.volatileDanger.length = 0;
    for (const r of run.rocks) {
      byId.set(r.id, r);
      if (r.comet) this.comets.push(r);
      if (r.trait === 'volatile' && r.hp < r.maxHp * TUNING.volatileWarnHp) this.volatileDanger.push(r);
    }
    if (byId.size !== run.rocks.length) {
      byId.clear();
      for (const r of run.rocks) byId.set(r.id, r);
    }
    this.outpostRocks.clear();
    for (const o of run.automation.outposts) this.outpostRocks.add(o.rockId);

    const fx = systemEffects(run.system.modifiers); // once per tick, not per ship
    this.liveShipIds.clear();
    for (const s of run.ships) {
      this.liveShipIds.add(s.id);
      let st = this.stats.get(s.id);
      if (!st) this.stats.set(s.id, (st = emptyStats()));
      applyEffects(writeShipStats(st, s, state.profile), fx);
    }
    // A scrapped or destroyed ship's entry must not linger for the whole run.
    // Iterating a Map or Set allocates an iterator, so skip it when nothing can be stale.
    if (this.stats.size !== run.ships.length) this.stats.forEach(this.pruneStats);
    if (this.upgradeReadyAt.size > 0) this.upgradeReadyAt.forEach(this.pruneUpgrade);
    if (this.repairWait.size > 0) this.repairWait.forEach(this.pruneWait);
  }

  /** Drop every reference; used when the running game is swapped. */
  clear(): void {
    this.rockHash.rebuild([]);
    this.rockById.clear();
    this.comets.length = 0;
    this.volatileDanger.length = 0;
    this.outpostRocks.clear();
    this.stats.clear();
    this.liveShipIds.clear();
    this.upgradeReadyAt.clear();
    this.repairWait.clear();
  }
}
