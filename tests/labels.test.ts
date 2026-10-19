import { describe, expect, it } from 'vitest';
import { LABEL_FADE, labelOpacity, placeLabels, planetPos } from '../src/render/labels';
import { generateSystem } from '../src/sim/generate';

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
