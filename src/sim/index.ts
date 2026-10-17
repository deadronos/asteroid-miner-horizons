import { SpatialHash } from '../core/spatialHash';
import { shipStats, type ShipStats } from './ships';
import type { GameState, Rock } from './types';

/**
 * Per-session derived state. Not persisted: it is rebuilt from GameState every
 * tick and holds references into the current run's rocks/ships.
 */
export class SimIndex {
  readonly rockHash = new SpatialHash<Rock>(128);
  readonly rockById = new Map<number, Rock>();
  readonly stats = new Map<number, ShipStats>();

  /** Rebuild all three structures for `state`, reusing the same instances. */
  rebuild(state: GameState): void {
    const { run } = state;
    this.rockHash.rebuild(run.rocks);
    this.rockById.clear();
    for (const r of run.rocks) this.rockById.set(r.id, r);
    this.stats.clear();
    for (const s of run.ships) this.stats.set(s.id, shipStats(s, state.profile));
  }

  /** Drop every reference; used when the running game is swapped. */
  clear(): void {
    this.rockHash.rebuild([]);
    this.rockById.clear();
    this.stats.clear();
  }
}
