// Plain snapshot of WebGLRenderer.info for the debug hook.

import type * as THREE from 'three';

/** Draw and memory counters from `renderer.info`, copied so later frames do not change it. */
export type InfoSnapshot = {
  calls: number;
  triangles: number;
  points: number;
  lines: number;
  geometries: number;
  textures: number;
  programs: number;
};

/** Copies the counters into a fresh plain object. `programs` is a count, not the list. */
export function infoSnapshot(info: THREE.WebGLInfo): InfoSnapshot {
  return {
    calls: info.render.calls,
    triangles: info.render.triangles,
    points: info.render.points,
    lines: info.render.lines,
    geometries: info.memory.geometries,
    textures: info.memory.textures,
    programs: info.programs?.length ?? 0,
  };
}
