import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { RockView, ROCK_POOLS, rockMaterial, rockShapeIndex, rockStyleOf, traitIndex } from '../src/render/rocks';
import { rockGeometry } from '../src/render/util';
import type { RawResource } from '../src/data/resources';
import type { RockTrait } from '../src/data/traits';
import type { Rock } from '../src/sim/types';

// `util.ts` builds `glowTexture` at import time, which needs a canvas. Vitest
// runs in the node env, so stub just enough of `document` before the imports
// above are evaluated (same trick as `session.test.ts`, without a new dep).
vi.hoisted(() => {
  const ctx = { fillStyle: '', createRadialGradient: () => ({ addColorStop: () => {} }), fillRect: () => {} };
  Object.defineProperty(globalThis, 'document', {
    value: { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) },
    configurable: true,
  });
});

const attr = (g: THREE.BufferGeometry): THREE.BufferAttribute => g.getAttribute('position') as THREE.BufferAttribute;
const extents = (g: THREE.BufferGeometry): { max: number; min: number } => {
  const a = attr(g);
  let max = 0;
  let min = Infinity;
  for (let i = 0; i < a.count; i++) {
    const d = Math.hypot(a.getX(i), a.getY(i), a.getZ(i));
    max = Math.max(max, d);
    min = Math.min(min, d);
  }
  return { max, min };
};

describe('rock shapes are kind-correlated', () => {
  it('gives every kind its own two-pool block', () => {
    for (const id of [0, 1, 2, 7, 8, 13]) {
      expect([0, 1]).toContain(rockShapeIndex('ore', id));
      expect([2, 3]).toContain(rockShapeIndex('ice', id));
      expect([4, 5]).toContain(rockShapeIndex('crystal', id));
    }
    expect(rockShapeIndex('ore', 0)).not.toBe(rockShapeIndex('ore', 1));
    expect(ROCK_POOLS).toBe(6);
  });

  it('keeps negative odd ids inside their kind block', () => {
    // `-1 % 2` is `-1`, which would point at the previous kind's pool (or -1
    // for ore); the parity must be made non-negative.
    expect([0, 1]).toContain(rockShapeIndex('ore', -1));
    expect([4, 5]).toContain(rockShapeIndex('crystal', -1));
  });

  it('assigns a distinct style per kind', () => {
    expect(rockStyleOf('ore')).toBe('rock');
    expect(rockStyleOf('ice')).toBe('gem');
    expect(rockStyleOf('crystal')).toBe('shard');
  });
});

describe('rockGeometry styles', () => {
  it('gem is a coarser mesh than rock', () => {
    expect(attr(rockGeometry(1000, 'gem')).count).toBeLessThan(attr(rockGeometry(1000, 'rock')).count);
  });

  it('shard is pointier than gem (more low-biased vertices)', () => {
    expect(extents(rockGeometry(1000, 'shard')).min).toBeLessThan(extents(rockGeometry(1000, 'gem')).min);
  });

  it('keeps every style inside the cull bound (1.25)', () => {
    for (const style of ['rock', 'gem', 'shard'] as const)
      for (let i = 0; i < 6; i++) expect(extents(rockGeometry(1000 + i * 77, style)).max).toBeLessThanOrEqual(1.25);
  });

  it('defaults to the rock style (debris is unchanged)', () => {
    const dflt = attr(rockGeometry(4242));
    const rock = attr(rockGeometry(4242, 'rock'));
    expect(dflt.count).toBe(rock.count);
    // Byte-identity: a changed default style must be caught, not just a changed
    // vertex count.
    for (let i = 0; i < dflt.count; i++)
      expect([dflt.getX(i), dflt.getY(i), dflt.getZ(i)]).toEqual([rock.getX(i), rock.getY(i), rock.getZ(i)]);
  });
});

/** Runs a material's compile callback against a shader stub and returns the stub. */
function compile(mat: THREE.Material): {
  uniforms: Record<string, unknown>;
  fragmentShader: string;
  vertexShader: string;
} {
  // The stub must carry the real injection markers, or `.replace` is a no-op.
  const stub = {
    uniforms: {} as Record<string, unknown>,
    vertexShader: '#include <common>\n#include <begin_vertex>',
    fragmentShader: '#include <common>\n#include <emissivemap_fragment>',
  };
  (mat.onBeforeCompile as (s: unknown, r: unknown) => void)(stub, undefined);
  return stub;
}

describe('per-kind rock materials', () => {
  it('builds one distinct Phong material per kind', () => {
    const mats = (['ore', 'ice', 'crystal'] as RawResource[]).map(rockMaterial);
    for (const m of mats) expect(m).toBeInstanceOf(THREE.MeshPhongMaterial);
    expect(new Set(mats).size).toBe(3);
  });

  it('gives ice a sharper highlight than ore', () => {
    expect(rockMaterial('ice').shininess).toBeGreaterThan(rockMaterial('ore').shininess);
  });

  it('attaches the shading patch to every kind', () => {
    // `KIND_INDEX` in `rocks.ts`; the fragment branch keys off these values.
    const kindIndex: Record<RawResource, number> = { ore: 0, ice: 1, crystal: 2 };
    for (const kind of ['ore', 'ice', 'crystal'] as RawResource[]) {
      const stub = compile(rockMaterial(kind));
      expect(stub.uniforms.uKind).toEqual({ value: kindIndex[kind] });
      expect(stub.fragmentShader).toContain('uKind');
      expect(stub.vertexShader).toContain('aDamage');
    }
  });

  it('declares the trait attribute and varies it to the fragment stage', () => {
    const stub = compile(rockMaterial('ore'));
    expect(stub.vertexShader).toContain('aTrait');
    expect(stub.vertexShader).toContain('vTrait');
    expect(stub.vertexShader).toContain('vTrait = aTrait;');
    expect(stub.fragmentShader).toContain('vTrait');
  });
});

describe('traitIndex', () => {
  it('maps each trait to its shader index and a plain rock to zero', () => {
    expect(traitIndex(undefined)).toBe(0);
    expect(traitIndex('volatile')).toBe(1);
    expect(traitIndex('dense')).toBe(2);
    expect(traitIndex('magnetic')).toBe(3);
  });
});

describe('RockView pools are built per kind', () => {
  it('draws the rock path with exactly 7 meshes', () => {
    expect(new RockView().group.children).toHaveLength(7);
  });

  it('uses each kind material on its own two pools', () => {
    const view = new RockView();
    const poolMat = (i: number) => (view.group.children[i] as THREE.InstancedMesh).material;
    expect(poolMat(0)).toBe(poolMat(1));
    expect(poolMat(2)).toBe(poolMat(3));
    expect(poolMat(4)).toBe(poolMat(5));
    expect(new Set([poolMat(0), poolMat(2), poolMat(4)]).size).toBe(3);
  });
});

const VIEW = { x: 0, z: 0, halfW: 1e9, halfH: 1e9 };
const rock = (id: number, kind: RawResource, trait?: RockTrait): Rock => ({
  id,
  kind,
  size: 0,
  pos: { x: 0, z: 0 },
  vel: { x: 0, z: 0 },
  radius: 10,
  hp: 1,
  maxHp: 1,
  units: 1,
  belt: 0,
  trait,
});

/** Which of the six rock pools received the only rock, or -1. */
const usedPool = (view: RockView): number =>
  view.group.children
    .slice(0, 6)
    .map((m, i) => ({ i, count: (m as THREE.InstancedMesh).count }))
    .filter((p) => p.count > 0)
    .map((p) => p.i)[0] ?? -1;

/** `aTrait` of the first instance written for a lone rock. */
const firstTrait = (r: Rock): number => {
  const view = new RockView();
  view.update([r], [], 0, VIEW);
  const geo = (view.group.children[usedPool(view)] as THREE.InstancedMesh).geometry;
  return (geo.getAttribute('aTrait') as THREE.BufferAttribute).getX(0);
};

describe('RockView bucketing', () => {
  it('sends rocks to their kind pools even when `id % 6` would not', () => {
    // id 2 → `id % 6` = 2 (an ice pool); a crystal rock must not land there.
    const crystal = new RockView();
    crystal.update([rock(2, 'crystal')], [], 0, VIEW);
    expect([4, 5]).toContain(usedPool(crystal));
    // id 0 → `id % 6` = 0 (an ore pool); an ice rock must not land there.
    const ice = new RockView();
    ice.update([rock(0, 'ice')], [], 0, VIEW);
    expect([2, 3]).toContain(usedPool(ice));
  });

  it('keeps the rock path at 7 meshes regardless of rock count', () => {
    const view = new RockView();
    view.update([rock(0, 'ore'), rock(1, 'ice'), rock(2, 'crystal'), rock(3, 'ore')], [], 0, VIEW);
    expect(view.group.children).toHaveLength(7);
  });
});

describe('RockView trait attribute', () => {
  it('writes the trait index per rock and 0 for a plain rock', () => {
    expect(firstTrait(rock(0, 'ore'))).toBe(0);
    expect(firstTrait(rock(0, 'ore', 'volatile'))).toBe(1);
    expect(firstTrait(rock(0, 'ore', 'dense'))).toBe(2);
    expect(firstTrait(rock(0, 'ore', 'magnetic'))).toBe(3);
  });
});
