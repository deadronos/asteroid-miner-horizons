// Uniform-grid spatial hash for broad-phase queries (collisions, picking,
// AI target search). Rebuilt once per tick; queries return candidates whose
// cell overlaps the query circle, so callers still do the exact distance test.

import type { Vec2 } from './vec';

/**
 * A recycled bucket. Slot 0 holds the live item count and items follow at
 * 1..count. The count lives in the array itself so a bucket can be emptied
 * without shrinking it: `arr.length = 0` right-trims V8's backing store, so the
 * next write would reallocate — the exact per-tick allocation this class avoids.
 */
type Bucket<T> = (T | number | undefined)[];

export class SpatialHash<T extends { pos: Vec2 }> {
  private readonly cells = new Map<number, Bucket<T>>();
  /** Live buckets for the current rebuild; `pool` is the free list. Swapped each rebuild. */
  private used: Bucket<T>[] = [];
  private pool: Bucket<T>[] = [];

  constructor(private readonly cell = 128) {}

  private key(cx: number, cz: number): number {
    return (cx + 32768) * 65536 + (cz + 32768);
  }

  rebuild(items: readonly T[]): void {
    this.cells.clear();
    // Last rebuild's live buckets are all free now; this rebuild's live list is
    // built into the previous free list, so no array is allocated once warm.
    const free = this.used;
    const live = this.pool;
    let n = 0;
    for (const it of items) {
      const k = this.key(Math.floor(it.pos.x / this.cell), Math.floor(it.pos.z / this.cell));
      let bucket = this.cells.get(k);
      if (!bucket) {
        if (n < free.length) {
          bucket = free[n]!;
          // Drop stale references (a bucket is reused at whatever length it
          // reached last time); its capacity is kept, only the count is reset.
          const old = bucket[0] as number;
          for (let j = 1; j <= old; j++) bucket[j] = undefined;
        } else {
          bucket = [];
        }
        bucket[0] = 0;
        live[n++] = bucket;
        this.cells.set(k, bucket);
      }
      const c = bucket[0] as number;
      bucket[c + 1] = it;
      bucket[0] = c + 1;
    }
    live.length = n;
    free.length = 0;
    this.used = live;
    this.pool = free;
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
        if (bucket) {
          const n = bucket[0] as number;
          for (let i = 1; i <= n; i++) fn(bucket[i] as T);
        }
      }
    }
  }
}
