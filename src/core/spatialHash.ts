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

const EMPTY = -1;

export class SpatialHash<T extends { pos: Vec2 }> {
  /**
   * Open-addressed cell table: `keys[i]` is a cell key (or EMPTY) and `slots[i]` its bucket. A `Map` here
   * regrew its table on every rebuild; this is cleared with one `fill` and allocates nothing once warm.
   */
  private keys = new Float64Array(256).fill(EMPTY);
  private slots: (Bucket<T> | undefined)[] = Array.from({ length: 256 });
  private mask = 255;
  /**
   * Buckets in use by the current rebuild. Between rebuilds `spareBuckets` holds
   * every other recycled bucket, ready to be handed back out; the two lists are
   * swapped each rebuild so no array is allocated once warm.
   */
  private liveBuckets: Bucket<T>[] = [];
  private spareBuckets: Bucket<T>[] = [];

  constructor(private readonly cell = 128) {}

  private key(cx: number, cz: number): number {
    return (cx + 32768) * 65536 + (cz + 32768);
  }

  /** Table index holding `k`, or the empty slot where it belongs. */
  private find(k: number, cx: number, cz: number): number {
    const keys = this.keys;
    let i = (Math.imul(cx, 73856093) ^ Math.imul(cz, 19349663)) & this.mask;
    while (keys[i] !== EMPTY && keys[i] !== k) i = (i + 1) & this.mask;
    return i;
  }

  rebuild(items: readonly T[]): void {
    // Keep the load factor under 1/2 even if every item lands in its own cell.
    if (items.length * 2 > this.mask) {
      let size = this.mask + 1;
      while (items.length * 2 > size - 1) size *= 2;
      this.keys = new Float64Array(size);
      this.slots = Array.from({ length: size });
      this.mask = size - 1;
    }
    this.keys.fill(EMPTY);
    // Last rebuild's live buckets are all free now (`spare`); this rebuild's
    // live list is refilled from the previous spare list, so no array is
    // allocated once warm.
    const spare = this.liveBuckets;
    const live = this.spareBuckets;
    let n = 0;
    for (let m = 0; m < items.length; m++) {
      const it = items[m]!;
      const cx = Math.floor(it.pos.x / this.cell);
      const cz = Math.floor(it.pos.z / this.cell);
      const k = this.key(cx, cz);
      const slot = this.find(k, cx, cz);
      let bucket = this.keys[slot] === k ? this.slots[slot] : undefined;
      if (!bucket) {
        if (n < spare.length) {
          bucket = spare[n]!;
          // Drop stale references (a bucket is reused at whatever length it
          // reached last time); its capacity is kept, only the count is reset.
          const old = bucket[0] as number;
          for (let j = 1; j <= old; j++) bucket[j] = undefined;
        } else {
          bucket = [];
        }
        bucket[0] = 0;
        live[n++] = bucket;
        this.keys[slot] = k;
        this.slots[slot] = bucket;
      }
      const c = bucket[0] as number;
      bucket[c + 1] = it;
      bucket[0] = c + 1;
    }
    live.length = n;
    spare.length = 0;
    this.liveBuckets = live;
    this.spareBuckets = spare;
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
        const k = this.key(cx, cz);
        const slot = this.find(k, cx, cz);
        const bucket = this.keys[slot] === k ? this.slots[slot] : undefined;
        if (bucket) {
          const n = bucket[0] as number;
          for (let i = 1; i <= n; i++) fn(bucket[i] as T);
        }
      }
    }
  }
}
