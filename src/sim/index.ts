import { SpatialHash } from '../core/spatialHash';
import type { Vec2 } from '../core/vec';
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
  /** Scratch written by `pilot.avoidance`; never read without writing first. */
  readonly avoid: Vec2 = { x: 0, z: 0 };
  /** Scratch written by `pilot.droneThink`; never read without writing first. */
  readonly home: Vec2 = { x: 0, z: 0 };
  /** Ids seen in the last `rebuild`, so the next one can prune the departed. */
  private readonly liveShipIds = new Set<number>();

  /** Rebuild all three structures for `state`, reusing the same instances. */
  rebuild(state: GameState): void {
    const { run } = state;
    this.rockHash.rebuild(run.rocks);
    this.rockById.clear();
    for (const r of run.rocks) this.rockById.set(r.id, r);

    const fx = systemEffects(run.system.modifiers); // once per tick, not per ship
    this.liveShipIds.clear();
    for (const s of run.ships) {
      this.liveShipIds.add(s.id);
      let st = this.stats.get(s.id);
      if (!st) this.stats.set(s.id, (st = emptyStats()));
      applyEffects(writeShipStats(st, s, state.profile), fx);
    }
    // A scrapped or destroyed ship's entry must not linger for the whole run.
    for (const id of this.stats.keys()) if (!this.liveShipIds.has(id)) this.stats.delete(id);
  }

  /** Drop every reference; used when the running game is swapped. */
  clear(): void {
    this.rockHash.rebuild([]);
    this.rockById.clear();
    this.stats.clear();
    this.liveShipIds.clear();
  }
}
