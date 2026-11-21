import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PALETTES } from '../src/data/palette';
import type { RawResource } from '../src/data/resources';
import { setColourVision } from '../src/render/activePalette';
import { SystemView } from '../src/render/systemView';
import { generateSystem } from '../src/sim/generate';

// `util.ts` builds `glowTexture` at import time, which needs a canvas. Vitest
// runs in the node env, so stub just enough of `document` before the imports
// above are evaluated (same trick as `rocks.test.ts`).
vi.hoisted(() => {
  const ctx = { fillStyle: '', createRadialGradient: () => ({ addColorStop: () => {} }), fillRect: () => {} };
  Object.defineProperty(globalThis, 'document', {
    value: { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) },
    configurable: true,
  });
});

afterEach(() => setColourVision('default'));

const planetsOf = (view: SystemView): { moons: unknown[] }[] =>
  (view as unknown as { planets: { moons: unknown[] }[] }).planets;

interface SystemParts {
  beacons: THREE.Mesh[];
  dockRing: THREE.LineLoop | null;
  heatRing: THREE.LineLoop | null;
  beltBands: { mesh: THREE.Mesh; kind: RawResource }[];
  starGlow: THREE.Sprite[];
  planets: { body: THREE.Mesh; moons: THREE.Mesh[]; ring: THREE.Mesh | null }[];
}

const partsOf = (view: SystemView): SystemParts => view as unknown as SystemParts;

// Seeds 1 and 21 both name their first system "Qutha", with different planets and moons.
const qutha1 = () => generateSystem(1, 1);
const qutha21 = () => generateSystem(21, 1);

describe('SystemView', () => {
  it('rebuilds for another game whose system shares the name and number', () => {
    const a = qutha1();
    const b = qutha21();
    expect(`${a.name}#${a.number}`).toBe(`${b.name}#${b.number}`);
    expect(a.planets.length).not.toBe(b.planets.length);

    const view = new SystemView();
    expect(view.sync(a)).toBe(true);
    expect(view.sync(a)).toBe(false);
    expect(view.sync(b)).toBe(true);
    expect(planetsOf(view).map((p) => p.moons.length)).toEqual(b.planets.map((p) => p.moons.length));
  });

  it('rebuilds for a reloaded copy of the shown system', () => {
    const a = qutha1();
    const view = new SystemView();
    view.sync(a);
    expect(view.sync(structuredClone(a))).toBe(true);
  });

  it('update tolerates a system with more planets or moons than the view', () => {
    const view = new SystemView();
    view.sync(qutha1());
    expect(() => view.update(qutha21(), 1)).not.toThrow();
  });

  it('drives scenery colours from palette() and refreshes live on paletteGeneration() changes', () => {
    const sys = qutha1();
    const view = new SystemView();
    view.sync(sys);
    const parts = partsOf(view);

    const expectMode = (mode: 'default' | 'deutan' | 'tritan') => {
      const p = PALETTES[mode];
      expect((parts.heatRing!.material as THREE.LineBasicMaterial).color.getHex()).toBe(p.bad);
      expect((parts.dockRing!.material as THREE.LineBasicMaterial).color.getHex()).toBe(p.ok);
      expect(parts.beacons.length).toBe(4);
      for (const b of parts.beacons) expect((b.material as THREE.MeshBasicMaterial).color.getHex()).toBe(p.ok);
      expect(parts.beltBands.length).toBe(sys.belts.length);
      for (const b of parts.beltBands)
        expect((b.mesh.material as THREE.MeshBasicMaterial).color.getHex()).toBe(p.resource[b.kind]);
    };

    expectMode('default');

    setColourVision('deutan');
    view.update(sys, 1);
    expectMode('deutan');

    setColourVision('tritan');
    view.update(sys, 2);
    expectMode('tritan');
  });

  it('pulses star glow and heat-zone ring during solar flare warning and respects reducedMotion', () => {
    const sys = qutha1();
    const view = new SystemView();
    view.sync(sys);
    const parts = partsOf(view);
    const heatMat = parts.heatRing!.material as THREE.LineBasicMaterial;

    // Idle baseline.
    view.update(sys, 0, 0, 0, false);
    const baseOpacity = heatMat.opacity;
    const baseGlow = parts.starGlow[0]!.scale.x;

    // Warning telegraph raises both heat-ring opacity and star glow, pulsing over time.
    view.update(sys, Math.PI / 14, 0, 1, false);
    const peakOpacity = heatMat.opacity;
    const peakGlow = parts.starGlow[0]!.scale.x;
    expect(peakOpacity).toBeGreaterThan(baseOpacity);
    expect(peakGlow).toBeGreaterThan(baseGlow);
    expect(parts.heatRing!.scale.x).toBeGreaterThan(1);

    // Reduced motion keeps the heat ring elevated without pulsing its scale.
    view.update(sys, Math.PI / 14, 0, 1, true);
    const rmOpacityA = heatMat.opacity;
    expect(rmOpacityA).toBeGreaterThan(baseOpacity);
    expect(parts.heatRing!.scale.x).toBe(1);
    view.update(sys, 1.1, 0, 1, true);
    expect(heatMat.opacity).toBeCloseTo(rmOpacityA, 5);
  });

  it('applies a procedural radial-band texture to ringed planets and disposes it on rebuild', () => {
    const sys = qutha1();
    sys.planets[0]!.ringed = true;
    const view = new SystemView();
    view.sync(sys);
    const ring = partsOf(view).planets[0]!.ring;
    expect(ring).not.toBeNull();
    const mat = ring!.material as THREE.MeshLambertMaterial;
    expect(mat.map).toBeInstanceOf(THREE.CanvasTexture);
    const disposeSpy = vi.spyOn(mat.map!, 'dispose');

    view.sync(qutha21());
    expect(disposeSpy).toHaveBeenCalledTimes(1);
  });
});
