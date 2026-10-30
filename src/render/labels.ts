// Name labels for the station and planets on the zoomed-out map. A DOM overlay,
// like the pickup text: labels fade in past a zoom threshold, sit above (or
// below) their body, and are hidden rather than drawn over a HUD panel or
// another label.

import type { Vec2 } from '../core/vec';
import { TUNING } from '../data/tuning';
import type { Planet, StarSystem } from '../sim/types';

/** View half-heights (world units) over which labels fade in; normal play zoom is 420. */
export const LABEL_FADE: readonly [number, number] = [900, 1300];
/** Pixels between a body's edge and its label. */
const GAP = 4;
/** Labels keep this far from the viewport edge. */
const EDGE = 4;
/** Seconds between re-reading the HUD panel rectangles. */
const BLOCKER_REFRESH = 0.25;
/** Smallest body radius in pixels, so a label clears a tiny planet's halo or a docked ship's ring. */
const MIN_R_PX = 10;

/** A screen rectangle in CSS pixels: left, top, width, height. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A body to label: its screen centre, its radius in pixels and the label's size. */
export interface LabelItem {
  x: number;
  y: number;
  r: number;
  w: number;
  h: number;
}

/** 0 at play zoom, easing to 1 across LABEL_FADE. */
export function labelOpacity(halfH: number): number {
  const t = Math.min(1, Math.max(0, (halfH - LABEL_FADE[0]) / (LABEL_FADE[1] - LABEL_FADE[0])));
  return t * t * (3 - 2 * t);
}

const overlaps = (a: Box, b: Box): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * Places each label centred above its body, or below if above is taken. A
 * spot must lie inside the `view` and clear every blocker and every label
 * placed before it, so earlier items win. Returns null where neither fits.
 */
export function placeLabels(
  items: LabelItem[],
  blockers: Box[],
  view: { w: number; h: number },
  out: (Box | null)[] = [],
  placed: Box[] = [],
): (Box | null)[] {
  placed.length = 0;
  out.length = items.length;
  for (let i = 0; i < items.length; i++) {
    const it = items[i]!;
    const x = it.x - it.w / 2;
    out[i] = null;
    for (let side = 0; side < 2; side++) {
      const y = side === 0 ? it.y - it.r - GAP - it.h : it.y + it.r + GAP;
      const b = { x, y, w: it.w, h: it.h };
      if (b.x < EDGE || b.y < EDGE || b.x + b.w > view.w - EDGE || b.y + b.h > view.h - EDGE) continue;
      if (hitsAny(b, blockers) || hitsAny(b, placed)) continue;
      placed.push(b);
      out[i] = b;
      break;
    }
  }
  return out;
}

const hitsAny = (b: Box, boxes: Box[]): boolean => {
  for (let i = 0; i < boxes.length; i++) if (overlaps(b, boxes[i]!)) return true;
  return false;
};

/** A planet's current world position. */
export const planetPos = (p: Planet): Vec2 => ({ x: Math.cos(p.angle) * p.orbitR, z: Math.sin(p.angle) * p.orbitR });

export class MapLabels {
  readonly el: HTMLElement;
  private spans: HTMLSpanElement[] = [];
  /** Label sizes, re-measured with the blockers so a HUD-scale change is picked up. */
  private sizes: { w: number; h: number }[] = [];
  private blockers: Box[] = [];
  /** Scratch reused by every `update` so label placement allocates no arrays. */
  private readonly items: LabelItem[] = [];
  private readonly view = { w: 0, h: 0 };
  private readonly placedOut: (Box | null)[] = [];
  private readonly placedScratch: Box[] = [];
  private blockerAge = BLOCKER_REFRESH;
  /** The system the labels were built for; compared by identity, since names repeat across games. */
  private built: StarSystem | null = null;
  private shown = false;

  /** `readBlockers` returns the client rectangles labels must stay clear of (HUD panels). */
  constructor(
    private container: HTMLElement,
    private readBlockers: () => Box[],
  ) {
    this.el = document.createElement('div');
    this.el.className = 'map-labels';
    container.append(this.el);
  }

  private build(sys: StarSystem): void {
    this.el.replaceChildren();
    const names = [`${sys.name} Station`, ...sys.planets.map((p) => p.name)];
    this.spans = names.map((n, i) => {
      const s = document.createElement('span');
      s.className = i === 0 ? 'map-label station' : 'map-label';
      s.textContent = n;
      s.style.visibility = 'hidden';
      this.el.append(s);
      return s;
    });
    this.sizes = names.map(() => ({ w: 0, h: 0 }));
    this.blockerAge = BLOCKER_REFRESH;
  }

  /** `halfH` is the view half-height; `wpp` world units per CSS pixel. */
  update(
    sys: StarSystem,
    halfH: number,
    wpp: number,
    dt: number,
    toScreen: (p: Vec2) => { x: number; y: number },
  ): void {
    if (this.built !== sys) {
      this.build(sys);
      this.built = sys;
    }
    const opacity = labelOpacity(halfH);
    this.el.style.opacity = opacity.toFixed(3);
    if (opacity <= 0) {
      if (this.shown) for (const s of this.spans) s.style.visibility = 'hidden';
      this.shown = false;
      this.blockerAge = BLOCKER_REFRESH;
      return;
    }
    this.shown = true;

    this.blockerAge += dt;
    if (this.blockerAge >= BLOCKER_REFRESH) {
      this.blockerAge = 0;
      const o = this.container.getBoundingClientRect();
      this.blockers = this.readBlockers().map((b) => ({ x: b.x - o.left, y: b.y - o.top, w: b.w, h: b.h }));
      this.sizes.forEach((sz, i) => {
        sz.w = this.spans[i]!.offsetWidth;
        sz.h = this.spans[i]!.offsetHeight;
      });
    }

    // Item 0 is the station, whose label clears its dock circle; the rest are planets.
    const n = 1 + sys.planets.length;
    const items = this.items;
    while (items.length < n) items.push({ x: 0, y: 0, r: 0, w: 0, h: 0 });
    items.length = n;
    for (let i = 0; i < n; i++) {
      const planet = i === 0 ? null : sys.planets[i - 1]!;
      const s = toScreen(planet ? planetPos(planet) : sys.station.pos);
      const r = planet ? planet.radius * (planet.ringed ? 2 : 1.2) : TUNING.dockRadius;
      const sz = this.sizes[i]!;
      const it = items[i]!;
      it.x = s.x;
      it.y = s.y;
      it.r = Math.max(MIN_R_PX, r / wpp);
      it.w = sz.w;
      it.h = sz.h;
    }
    this.view.w = this.container.clientWidth;
    this.view.h = this.container.clientHeight;
    const placed = placeLabels(items, this.blockers, this.view, this.placedOut, this.placedScratch);
    for (let i = 0; i < placed.length; i++) {
      const b = placed[i]!;
      const span = this.spans[i]!;
      span.style.visibility = b && b.w > 0 ? 'visible' : 'hidden';
      if (b) span.style.transform = `translate(${b.x.toFixed(1)}px, ${b.y.toFixed(1)}px)`;
    }
  }
}
