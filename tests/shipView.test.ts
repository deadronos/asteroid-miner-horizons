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

/** The three materials `ShipView.remove` must dispose for a ship. */
const perShipMats = (p: Parts): THREE.Material[] => [p.shield, p.select, p.hpBar].map((o) => materialOf(o));

/** Materials every ship shares, so none of them is ever disposed on removal. */
const sharedMatsOf = (p: Parts): THREE.Material[] =>
  [p.barBg, p.cargoBar, p.beamGlow, p.flame, p.beam, p.tip].map((o) => materialOf(o));

const colorOf = (o: THREE.Object3D): THREE.Color => (materialOf(o) as THREE.MeshBasicMaterial).color;

/** Distinct materials under the view's group. */
const materialCount = (view: ShipView): number => {
  const mats = new Set<THREE.Material>();
  view.group.traverse((o) => {
    if (o instanceof THREE.Mesh || o instanceof THREE.Sprite) mats.add(o.material as THREE.Material);
  });
  return mats.size;
};

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

/** A game where one ship is actively mining, so beam visuals are present. */
function setupBeam(): { state: GameState; view: ShipView; ship: Ship } {
  const state = newGame(2);
  const ship = state.run.ships[0]!;
  const rock = state.run.rocks[0]!;
  ship.pos = { x: rock.pos.x - 120, z: rock.pos.z };
  ship.beamOn = true;
  ship.beamTargetId = rock.id;
  const view = new ShipView();
  view.update(state, 0, DT, 1, false);
  return { state, view, ship };
}

describe('ShipView GPU disposal', () => {
  it('disposes the per-ship materials of a removed ship once and nothing shared', () => {
    const { state, view, a, b } = setup();
    const pa = partsOf(view, a.id);
    const pb = partsOf(view, b.id);
    expect(meshesIn(pa.fittings).length).toBeGreaterThan(0);

    const perShip = perShipMats(pa);
    const hull = pa.body.children[0] as THREE.Mesh;
    const sharedMats = sharedMatsOf(pa);
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
      ...sharedMatsOf(before),
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
    const sharedSpies = sharedMatsOf(before).map((m) => vi.spyOn(m, 'dispose'));
    const perShipSpies = perShipMats(before).map((m) => vi.spyOn(m, 'dispose'));

    a.hullId = 'hauler';
    view.update(state, 0, DT, 1, false);

    const after = partsOf(view, a.id);
    expect(after).not.toBe(before);
    for (const spy of perShipSpies) expect(spy).toHaveBeenCalledTimes(1);
    expect(hullSpy).not.toHaveBeenCalled();
    for (const spy of sharedSpies) expect(spy).not.toHaveBeenCalled();
  });

  it('shares the hoisted geometries and the shared materials between ships', () => {
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
    expect(pa.flame.material).toBe(pb.flame.material);
    expect(pa.beam.material).toBe(pb.beam.material);
    expect(pa.tip.material).toBe(pb.tip.material);
    expect((pa.body.children[0] as THREE.Mesh).material).toBe((pb.body.children[0] as THREE.Mesh).material);
    expect(pa.shield.material).not.toBe(pb.shield.material);
    expect(pa.select.material).not.toBe(pb.select.material);
    expect(pa.hpBar.material).not.toBe(pb.hpBar.material);
  });

  it('adds three materials per extra ship', () => {
    const { state, view } = setup();
    const before = materialCount(view);
    for (let i = 0; i < 4; i++)
      state.run.ships.push(makeShip(state.run, state.profile, 'drone', `D${i}`, { x: 0, z: 0 }));
    view.update(state, 0, DT, 1, false);
    expect(materialCount(view) - before).toBe(4 * 3);
  });

  it('writes the glow-scaled colour to the shared materials even with no ship firing or thrusting', () => {
    const { state, view, a } = setup();
    const p = partsOf(view, a.id);
    view.glow = 2;
    view.update(state, 0, DT, 1, false);
    expect(colorOf(p.flame).equals(new THREE.Color(0xff8a3a).multiplyScalar(2))).toBe(true);
    expect(colorOf(p.beam).equals(new THREE.Color(0xff905c).multiplyScalar(2))).toBe(true);
    expect(colorOf(p.tip).equals(new THREE.Color(0xffc28e).multiplyScalar(2))).toBe(true);
  });

  it('reduces beam pulsing under reduced motion', () => {
    const { state, view, ship } = setupBeam();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    // Peak-to-peak beam width over half a second of frames.
    const swing = (motion: number): number => {
      const widths: number[] = [];
      for (let t = 0; t < 0.5; t += 0.004) {
        view.update(state, t, DT, 1, false, motion);
        widths.push(partsOf(view, ship.id).beam.scale.z);
      }
      return Math.max(...widths) - Math.min(...widths);
    };
    expect(swing(0.45)).toBeLessThan(swing(1) * 0.8);
  });
});
