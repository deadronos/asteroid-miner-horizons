import { describe, expect, it, vi } from 'vitest';
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

const planetsOf = (view: SystemView): { moons: unknown[] }[] =>
  (view as unknown as { planets: { moons: unknown[] }[] }).planets;

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
});
