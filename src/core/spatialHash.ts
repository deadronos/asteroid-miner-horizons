// Uniform-grid spatial hash for broad-phase queries (collisions, picking,
// AI target search). Rebuilt once per tick; queries return candidates whose
// cell overlaps the query circle, so callers still do the exact distance test.

import type { Vec2 } from './vec';

export class SpatialHash<T extends { pos: Vec2 }> {
  private cells = new Map<number, T[]>();

  constructor(private readonly cell = 128) {}

  private key(cx: number, cz: number): number {
    return (cx + 32768) * 65536 + (cz + 32768);
  }

  rebuild(items: readonly T[]): void {
    this.cells.clear();
    for (const it of items) {
      const k = this.key(Math.floor(it.pos.x / this.cell), Math.floor(it.pos.z / this.cell));
      const bucket = this.cells.get(k);
      if (bucket) bucket.push(it);
      else this.cells.set(k, [it]);
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
