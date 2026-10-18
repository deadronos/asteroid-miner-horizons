// Uniform-grid spatial hash for broad-phase queries (collisions, picking,
// AI target search). Rebuilt once per tick; queries return candidates whose
// cell overlaps the query circle, so callers still do the exact distance test.

import type { Vec2 } from './vec';

export class SpatialHash<T extends { pos: Vec2 }> {
  private readonly cells = new Map<number, T[]>();
  /** Buckets detached from the map last rebuild, empty and ready to be refilled. */
  private readonly pool: T[][] = [];
  /** Keys currently in `cells`, so the next rebuild can detach exactly those. */
  private readonly live: number[] = [];

  constructor(private readonly cell = 128) {}

  private key(cx: number, cz: number): number {
    return (cx + 32768) * 65536 + (cz + 32768);
  }

  rebuild(items: readonly T[]): void {
    for (const k of this.live) {
      const b = this.cells.get(k);
      if (b) {
        this.cells.delete(k);
        b.length = 0;
        this.pool.push(b);
      }
    }
    this.live.length = 0;
    for (const it of items) {
      const k = this.key(Math.floor(it.pos.x / this.cell), Math.floor(it.pos.z / this.cell));
      let bucket = this.cells.get(k);
      if (!bucket) {
        bucket = this.pool.pop() ?? [];
        this.cells.set(k, bucket);
        this.live.push(k);
      }
      bucket.push(it);
    }
  }

  /** Calls fn for every item in cells overlapping the circle (center, radius). */
  query(center: Vec2, radius: number, fn: (item: T) => void): void {
    const c = this.cell;
    const x0 = Math.floor((center.x - radius) / c);
    const x1 = Math.floor((center.x + radius) / c);
    const z0 = Math.floor((center.z - radius) / c);
    const z1 = Math.floor((center.z + radius) / c);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const bucket = this.cells.get(this.key(cx, cz));
        if (bucket) for (const it of bucket) fn(it);
      }
    }
  }
}
