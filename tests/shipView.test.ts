import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ShipView } from '../src/render/shipView';
import { newGame } from '../src/sim/create';
import { makeShip } from '../src/sim/ships';
import type { GameState, Ship } from '../src/sim/types';
import { DT } from './helpers';

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

afterEach(() => vi.restoreAllMocks());

/** The per-ship objects `ShipView` keeps; mirrors its private `Visual`. */
interface Parts {
  root: THREE.Group;
  body: THREE.Group;
  fittings: THREE.Group;
  flame: THREE.Mesh;
  shield: THREE.Mesh;
  select: THREE.Mesh;
  hpBar: THREE.Mesh;
  cargoBar: THREE.Mesh;
  barBg: THREE.Mesh;
  beam: THREE.Mesh;
  beamGlow: THREE.Mesh;
  tip: THREE.Sprite;
}

const partsOf = (view: ShipView, id: number): Parts =>
  (view as unknown as { visuals: Map<number, Parts> }).visuals.get(id)!;

const meshesIn = (g: THREE.Object3D): THREE.Mesh[] => {
  const out: THREE.Mesh[] = [];
  g.traverse((o) => {
    if (o instanceof THREE.Mesh) out.push(o);
  });
  return out;
};

const materialOf = (o: THREE.Object3D): THREE.Material => (o as THREE.Mesh).material as THREE.Material;

/** The six materials `ShipView.remove` must dispose for a ship. */
const perShipMats = (p: Parts): THREE.Material[] =>
  [p.flame, p.shield, p.select, p.hpBar, p.beam, p.tip].map((o) => materialOf(o));

/** A game with the flagship plus two drones, one laser each, after a first frame. */
function setup(): { state: GameState; view: ShipView; a: Ship; b: Ship } {
  const state = newGame(1);
  const a = makeShip(state.run, state.profile, 'drone', 'A', { x: 0, z: 0 });
  const b = makeShip(state.run, state.profile, 'drone', 'B', { x: 40, z: 0 });
  state.run.ships.push(a, b);
  const view = new ShipView();
  view.update(state, 0, DT, 1, false);
  return { state, view, a, b };
}

describe('ShipView GPU disposal', () => {
  it('disposes the per-ship materials of a removed ship once and nothing shared', () => {
    const { state, view, a, b } = setup();
    const pa = partsOf(view, a.id);
    const pb = partsOf(view, b.id);
    expect(meshesIn(pa.fittings).length).toBeGreaterThan(0);

    const perShip = perShipMats(pa);
    const hull = pa.body.children[0] as THREE.Mesh;
    const sharedMats = [pa.barBg, pa.cargoBar, pa.beamGlow].map((o) => materialOf(o));
    sharedMats.push(hull.material as THREE.Material);
    const sharedGeos = [
      hull.geometry,
      pa.flame.geometry,
      pa.shield.geometry,
      pa.select.geometry,
      pa.beam.geometry,
      pa.hpBar.geometry,
    ];
    const fitting = meshesIn(pa.fittings);
    const fittingGeos = fitting.map((m) => m.geometry);
    const fittingMats = fitting.map((m) => materialOf(m));
    const survivorMats = perShipMats(pb);

    const perShipSpies = perShip.map((m) => vi.spyOn(m, 'dispose'));
    const sharedSpies = [...sharedMats, ...sharedGeos, ...fittingGeos, ...fittingMats, ...survivorMats].map((o) =>
      vi.spyOn(o, 'dispose'),
    );

    state.run.ships.splice(state.run.ships.indexOf(a), 1);
    view.update(state, 0, DT, 1, false);

    for (const spy of perShipSpies) expect(spy).toHaveBeenCalledTimes(1);
    for (const spy of sharedSpies) expect(spy).not.toHaveBeenCalled();
    expect(view.group.children).not.toContain(pa.root);
    expect(view.group.children).not.toContain(pa.beam);
    expect(view.group.children).not.toContain(pa.beamGlow);
    expect(view.group.children).not.toContain(pa.tip);
    expect(view.group.children).toContain(pb.root);
  });

  it('does not dispose anything when a ship is refitted', () => {
    const { state, view, a } = setup();
    const before = partsOf(view, a.id);
    const perShip = perShipMats(before);
    const oldFittings = before.fittings;
    const fitting = meshesIn(oldFittings);
    const spies = [
      ...perShip,
      ...fitting.map((m) => m.geometry),
      ...fitting.map((m) => materialOf(m)),
      ...[before.barBg, before.cargoBar, before.beamGlow].map((o) => materialOf(o)),
    ].map((o) => vi.spyOn(o, 'dispose'));

    a.slots[0] = null;
    view.update(state, 0, DT, 1, false);

    expect(partsOf(view, a.id).fittings).not.toBe(oldFittings);
    expect(meshesIn(partsOf(view, a.id).fittings)).toHaveLength(0);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });

  it('disposes the old per-ship materials when a hull change rebuilds the ship', () => {
    const { state, view, a } = setup();
    const before = partsOf(view, a.id);
    const hullMat = materialOf(before.body.children[0]!);
    const hullSpy = vi.spyOn(hullMat, 'dispose');
    const perShipSpies = perShipMats(before).map((m) => vi.spyOn(m, 'dispose'));

    a.hullId = 'hauler';
    view.update(state, 0, DT, 1, false);

    const after = partsOf(view, a.id);
    expect(after).not.toBe(before);
    for (const spy of perShipSpies) expect(spy).toHaveBeenCalledTimes(1);
    expect(hullSpy).not.toHaveBeenCalled();
  });

  it('shares the hoisted geometries and never-written materials between ships', () => {
    const { view, a, b } = setup();
    const pa = partsOf(view, a.id);
    const pb = partsOf(view, b.id);
    expect(pa.flame.geometry).toBe(pb.flame.geometry);
    expect(pa.shield.geometry).toBe(pb.shield.geometry);
    expect(pa.select.geometry).toBe(pb.select.geometry);
    expect(pa.beam.geometry).toBe(pb.beam.geometry);
    expect(pa.hpBar.geometry).toBe(pb.hpBar.geometry);
    expect(pa.barBg.material).toBe(pb.barBg.material);
    expect(pa.cargoBar.material).toBe(pb.cargoBar.material);
    expect(pa.beamGlow.material).toBe(pb.beamGlow.material);
    expect((pa.body.children[0] as THREE.Mesh).material).toBe((pb.body.children[0] as THREE.Mesh).material);
    expect(pa.flame.material).not.toBe(pb.flame.material);
    expect(pa.hpBar.material).not.toBe(pb.hpBar.material);
  });
});
