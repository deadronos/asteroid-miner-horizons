import type * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { infoSnapshot } from '../src/render/renderInfo';

function fakeInfo(programs: unknown[] | null): THREE.WebGLInfo {
  return {
    autoReset: false,
    render: { frame: 1, calls: 12, triangles: 3400, points: 50, lines: 7 },
    memory: { geometries: 40, textures: 6 },
    programs,
  } as unknown as THREE.WebGLInfo;
}

describe('infoSnapshot', () => {
  it('copies the render and memory counters', () => {
    expect(infoSnapshot(fakeInfo([{}, {}, {}]))).toEqual({
      calls: 12,
      triangles: 3400,
      points: 50,
      lines: 7,
      geometries: 40,
      textures: 6,
      programs: 3,
    });
  });

  it('reports zero programs when the list is null', () => {
    expect(infoSnapshot(fakeInfo(null)).programs).toBe(0);
  });

  it('returns a new object each call, unaffected by later changes to the source', () => {
    const info = fakeInfo([{}]);
    const first = infoSnapshot(info);
    info.render.calls = 99;
    info.memory.textures = 0;
    const second = infoSnapshot(info);
    expect(second).not.toBe(first);
    expect(first.calls).toBe(12);
    expect(first.textures).toBe(6);
    expect(second.calls).toBe(99);
  });
});
