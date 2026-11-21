import { afterEach, describe, expect, it, vi } from 'vitest';
import { CameraRig } from '../src/render/camera';
import { type Box, LABEL_FADE, MapLabels, labelOpacity, placeLabels, planetPos } from '../src/render/labels';
import { generateSystem } from '../src/sim/generate';
import { newProfile, newRun } from '../src/sim/create';
import type { Run } from '../src/sim/types';
import { beltLabel } from '../src/render/mapBlips';

/** A fresh run in the given system. */
const runIn = (seed: number, n: number): Run => {
  const run = newRun(newProfile(seed));
  run.system = generateSystem(seed, n);
  return run;
};

const view = { w: 1280, h: 720 };
/** A map-like projection: 3.2 world units per pixel around the star. */
const toScreen = (p: { x: number; z: number }) => ({ x: 640 + p.x / 3.2, y: 360 + p.z / 3.2 });
const item = (x: number, y: number, r = 10) => ({ x, y, r, w: 80, h: 16 });

describe('map label fade', () => {
  it('is hidden at play zoom and fully shown past the threshold', () => {
    expect(labelOpacity(420)).toBe(0);
    expect(labelOpacity(LABEL_FADE[0])).toBe(0);
    expect(labelOpacity(LABEL_FADE[1])).toBe(1);
    const mid = labelOpacity((LABEL_FADE[0] + LABEL_FADE[1]) / 2);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
  });

  it('is fully shown on the M map of every system', () => {
    for (let n = 1; n <= 6; n++) {
      const sys = generateSystem(1234, n);
      // Same fit as Renderer.toggleMap.
      const fit = Math.max(...sys.planets.map((p) => p.orbitR), ...sys.belts.map((b) => b.outer)) * 1.08;
      expect(labelOpacity(fit)).toBe(1);
    }
  });
});

describe('map label placement', () => {
  it('centres a label just above its body', () => {
    const [b] = placeLabels([item(400, 300)], [], view);
    expect(b).toEqual({ x: 360, y: 300 - 10 - 4 - 16, w: 80, h: 16 });
  });

  it('drops below the body when a HUD panel covers the spot above', () => {
    const panel = { x: 300, y: 250, w: 200, h: 40 };
    const [b] = placeLabels([item(400, 300)], [panel], view);
    expect(b?.y).toBe(300 + 10 + 4);
  });

  it('hides a label that would overlap a panel either way', () => {
    const panel = { x: 300, y: 200, w: 200, h: 200 };
    expect(placeLabels([item(400, 300)], [panel], view)).toEqual([null]);
  });

  it('never stacks two labels; the earlier one keeps its spot', () => {
    const [a, b] = placeLabels([item(400, 300), item(420, 302)], [], view);
    expect(a?.y).toBeLessThan(300);
    expect(b?.y).toBeGreaterThan(302);
    const [, , c] = placeLabels([item(400, 300), item(420, 302), item(410, 301)], [], view);
    expect(c).toBeNull();
  });

  it('hides labels that would leave the viewport', () => {
    expect(placeLabels([item(10, 300), item(400, 2000)], [], view)).toEqual([null, null]);
  });

  it('keeps every placed label clear of the panels and of each other', () => {
    const sys = generateSystem(99, 3);
    const items = [sys.station.pos, ...sys.planets.map(planetPos)].map((p) => item(toScreen(p).x, toScreen(p).y));
    const panels = [
      { x: 10, y: 520, w: 440, h: 190 },
      { x: 970, y: 60, w: 300, h: 400 },
    ];
    const boxes = placeLabels(items, panels, view).filter((b) => b !== null);
    const hit = (a: (typeof boxes)[0], b: (typeof boxes)[0]) =>
      a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    for (const [i, a] of boxes.entries()) {
      for (const p of panels) expect(hit(a, p)).toBe(false);
      for (const b of boxes.slice(i + 1)) expect(hit(a, b)).toBe(false);
    }
  });
});

/** Just enough of an element for `MapLabels`; no DOM in the node env. */
const fakeEl = () => ({
  className: '',
  textContent: '',
  style: {},
  dataset: {} as Record<string, string>,
  classList: { toggle() {} },
  offsetWidth: 60,
  offsetHeight: 14,
  clientWidth: view.w,
  clientHeight: view.h,
  children: [] as { textContent: string }[],
  append(...c: { textContent: string }[]) {
    this.children.push(...c);
  },
  replaceChildren() {
    this.children = [];
  },
  getBoundingClientRect: () => ({ left: 0, top: 0 }),
});

describe('MapLabels', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('relabels for another game whose system shares the name and number', () => {
    vi.stubGlobal('document', { createElement: fakeEl });
    // Seeds 1 and 21 both name their first system "Qutha", with 3 and 5 planets.
    const a = runIn(1, 1);
    const b = runIn(21, 1);
    expect(`${a.system.name}#${a.system.number}`).toBe(`${b.system.name}#${b.system.number}`);

    const labels = new MapLabels(fakeEl() as unknown as HTMLElement, () => []);
    const texts = () => (labels.el as unknown as ReturnType<typeof fakeEl>).children.map((c) => c.textContent);
    const fit = LABEL_FADE[1];
    labels.update(a, fit, 3.2, 1, toScreen);
    labels.update(b, fit, 3.2, 1, toScreen);
    expect(texts().slice(0, 1 + b.system.planets.length)).toEqual([
      `${b.system.name} Station`,
      ...b.system.planets.map((p) => p.name),
    ]);
    expect(texts().slice(1 + b.system.planets.length, -1)).toEqual(b.system.belts.map(beltLabel));
  });

  it('never reads container clientWidth/clientHeight during update or updateBlips', () => {
    vi.stubGlobal('document', { createElement: fakeEl });
    let layoutReads = 0;
    let cw = view.w;
    let ch = view.h;
    const base = fakeEl();
    const container = {
      ...base,
      get clientWidth() {
        layoutReads++;
        return cw;
      },
      get clientHeight() {
        layoutReads++;
        return ch;
      },
    } as unknown as HTMLElement;
    const canvas = {} as unknown as HTMLCanvasElement;
    const cam = new CameraRig(container, canvas);
    const labels = new MapLabels(container, () => []);
    const run = runIn(7, 2);
    const project = (p: { x: number; z: number }, out?: { x: number; y: number }) => cam.worldToScreen(p, out);

    // Construction initializes cached dimensions; per-frame updates must not read them again.
    layoutReads = 0;
    labels.update(run, LABEL_FADE[1], cam.wpp, 0.016, project);
    labels.update(run, LABEL_FADE[1], cam.wpp, 0.016, project);
    labels.update(run, 420, cam.wpp, 0.016, project);
    expect(layoutReads).toBe(0);

    // Resizing via setViewport updates cached size without touching the DOM getters.
    cw = 800;
    ch = 600;
    cam.setViewport(cw, ch);
    labels.setViewport(cw, ch);
    labels.update(run, LABEL_FADE[1], cam.wpp, 0.016, project);
    expect(layoutReads).toBe(0);
  });
});

describe('CameraRig cached viewport', () => {
  it('projects accurately before and after setViewport and reuses the out point', () => {
    let layoutReads = 0;
    const container = {
      get clientWidth() {
        layoutReads++;
        return 1280;
      },
      get clientHeight() {
        layoutReads++;
        return 720;
      },
    } as unknown as HTMLElement;
    const cam = new CameraRig(container, {} as unknown as HTMLCanvasElement);
    layoutReads = 0;

    expect(cam.width).toBe(1280);
    expect(cam.height).toBe(720);
    expect(cam.aspect).toBeCloseTo(1280 / 720);
    expect(cam.wpp).toBeCloseTo((cam.halfH * 2) / 720);

    const scratch = { x: 0, y: 0 };
    const centerPt = cam.worldToScreen({ x: 0, z: 0 }, scratch);
    expect(centerPt).toBe(scratch);
    expect(scratch.x).toBeCloseTo(640);
    expect(scratch.y).toBeCloseTo(360);

    const corner = cam.worldToScreen({ x: cam.halfH * cam.aspect, z: cam.halfH });
    expect(corner.x).toBeCloseTo(1280);
    expect(corner.y).toBeCloseTo(720);

    cam.setViewport(800, 600);
    expect(cam.width).toBe(800);
    expect(cam.height).toBe(600);
    expect(cam.aspect).toBeCloseTo(800 / 600);
    expect(cam.wpp).toBeCloseTo((cam.halfH * 2) / 600);
    expect(cam.worldToScreen({ x: 0, z: 0 }, scratch)).toBe(scratch);
    expect(scratch.x).toBeCloseTo(400);
    expect(scratch.y).toBeCloseTo(300);
    const resizedCorner = cam.worldToScreen({ x: cam.halfH * cam.aspect, z: cam.halfH });
    expect(resizedCorner.x).toBeCloseTo(800);
    expect(resizedCorner.y).toBeCloseTo(600);
    expect(layoutReads).toBe(0);
  });
});

describe('label fallback anchors', () => {
  it('moves to an alternative anchor when the main spot is covered', () => {
    const panel = { x: 300, y: 200, w: 200, h: 200 };
    const [b] = placeLabels([{ ...item(400, 300), alts: [700, 300] }], [panel], view);
    expect(b).toEqual({ x: 660, y: 300 - 10 - 4 - 16, w: 80, h: 16 });
  });

  it('reuses pooled Box instances across calls when a pool is provided', () => {
    const out: (Box | null)[] = [];
    const placed: Box[] = [];
    const pool: Box[] = [];
    const first = placeLabels([item(400, 300), item(600, 300)], [], view, out, placed, pool);
    const [b0, b1] = first;
    expect(pool).toHaveLength(2);
    const second = placeLabels([item(450, 320), item(650, 320)], [], view, out, placed, pool);
    expect(second[0]).toBe(b0);
    expect(second[1]).toBe(b1);
    expect(pool).toHaveLength(2);
  });
});
