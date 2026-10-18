import { describe, expect, it } from 'vitest';
import { SpatialHash } from '../src/core/spatialHash';

interface Thing {
  pos: { x: number; z: number };
}
const at = (x: number, z: number): Thing => ({ pos: { x, z } });
/** The private fields the reuse test inspects. */
type Internals = { cells: Map<number, Thing[]>; pool: Thing[][] };

describe('SpatialHash', () => {
  it('reuses the same bucket array for a cell across rebuilds', () => {
    const hash = new SpatialHash<Thing>(128);
    const internals = hash as unknown as Internals;
    hash.rebuild([at(10, 10)]);
    const bucket = internals.cells.values().next().value;
    expect(Array.isArray(bucket)).toBe(true);
    hash.rebuild([at(11, 11)]); // same cell: (0, 0) at cell size 128
    expect(internals.cells.values().next().value).toBe(bucket);
  });

  it('allocates no new buckets once the pool is warm', () => {
    const hash = new SpatialHash<Thing>(128);
    const internals = hash as unknown as Internals;
    for (let i = 0; i < 50; i++) hash.rebuild([at(10, 10)]);
    expect(internals.cells.size).toBe(1);
    expect(internals.pool.length).toBe(0);
  });

  it('query sees exactly the items of the latest rebuild', () => {
    const hash = new SpatialHash<Thing>(128);
    hash.rebuild([at(10, 10), at(5000, 5000)]);
    let near = 0;
    hash.query({ x: 0, z: 0 }, 100, () => {
      near++;
    });
    expect(near).toBe(1);
    hash.rebuild([at(11, 11)]); // drops the far cell
    let far = 0;
    hash.query({ x: 5000, z: 5000 }, 100, () => {
      far++;
    });
    expect(far).toBe(0);
    near = 0;
    hash.query({ x: 0, z: 0 }, 100, () => {
      near++;
    });
    expect(near).toBe(1);
  });
});
