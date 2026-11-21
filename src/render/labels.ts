// Name labels for the station, planets and belts on the zoomed-out map, plus blips for the fleet, outposts and
// incoming hazards. A DOM overlay, like the pickup text: it fades in past a zoom threshold, labels sit above
// (or below) their body, and a label is hidden rather than drawn over a HUD panel or another label. Elements
// are built once per system and pooled; each frame only writes transforms and visibility.

import type { Vec2 } from '../core/vec';
import { TUNING } from '../data/tuning';
import type { Planet, Run, StarSystem } from '../sim/types';
import { type WorldLabel, collectWorldLabels } from './explorationView';
import { BLIP_GLYPH, type Blip, beltLabel, collectBlips } from './mapBlips';

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
/** Belt labels sit on the belt's middle radius, so they need only a small clearance. */
const BELT_R_PX = 4;
/** Where on its ring a belt's label may sit, in preference order (screen angles; -π/2 is straight up). */
const BELT_ANGLES: readonly number[] = [
  -Math.PI / 2,
  Math.PI / 2,
  -Math.PI / 4,
  -(3 * Math.PI) / 4,
  Math.PI / 4,
  (3 * Math.PI) / 4,
];

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
  /** Fallback anchors as flat x, y pairs (same `r`), tried in order when the main spot is taken. */
  alts?: number[];
}

/** 0 at play zoom, easing to 1 across LABEL_FADE. */
export function labelOpacity(halfH: number): number {
  const t = Math.min(1, Math.max(0, (halfH - LABEL_FADE[0]) / (LABEL_FADE[1] - LABEL_FADE[0])));
  return t * t * (3 - 2 * t);
}

/**
 * Places each label centred above its body, or below if above is taken. A
 * spot must lie inside the `view` and clear every blocker and every label
 * placed before it, so earlier items win. Returns null where neither fits.
 * When `pool` is supplied, placed `Box` records are reused from it instead of allocating.
 */
export function placeLabels(
  items: LabelItem[],
  blockers: Box[],
  view: { w: number; h: number },
  out: (Box | null)[] = [],
  placed: Box[] = [],
  pool?: Box[],
): (Box | null)[] {
  placed.length = 0;
  out.length = items.length;
  for (let i = 0; i < items.length; i++) {
    const it = items[i]!;
    out[i] = null;
    const alts = it.alts;
    const n = alts ? alts.length / 2 : 0;
    for (let a = -1; a < n && !out[i]; a++) {
      const ax = a < 0 ? it.x : alts![a * 2]!;
      const ay = a < 0 ? it.y : alts![a * 2 + 1]!;
      for (let side = 0; side < 2; side++) {
        const bx = ax - it.w / 2;
        const by = side === 0 ? ay - it.r - GAP - it.h : ay + it.r + GAP;
        if (bx < EDGE || by < EDGE || bx + it.w > view.w - EDGE || by + it.h > view.h - EDGE) continue;
        if (hitsAny(bx, by, it.w, it.h, blockers) || hitsAny(bx, by, it.w, it.h, placed)) continue;
        let b: Box;
        if (pool) {
          const idx = placed.length;
          if (idx < pool.length) {
            b = pool[idx]!;
            b.x = bx;
            b.y = by;
            b.w = it.w;
            b.h = it.h;
          } else {
            b = { x: bx, y: by, w: it.w, h: it.h };
            pool.push(b);
          }
        } else {
          b = { x: bx, y: by, w: it.w, h: it.h };
        }
        placed.push(b);
        out[i] = b;
        break;
      }
    }
  }
  return out;
}

const hitsAny = (x: number, y: number, w: number, h: number, boxes: Box[]): boolean => {
  const r = x + w;
  const b = y + h;
  for (let i = 0; i < boxes.length; i++) {
    const o = boxes[i]!;
    if (x < o.x + o.w && o.x < r && y < o.y + o.h && o.y < b) return true;
  }
  return false;
};

const pointHitsAny = (x: number, y: number, boxes: Box[]): boolean => {
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i]!;
    if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return true;
  }
  return false;
};

/** A planet's current world position. */
export const planetPos = (p: Planet): Vec2 => ({ x: Math.cos(p.angle) * p.orbitR, z: Math.sin(p.angle) * p.orbitR });

/** World-to-screen projection callback; writes into `out` when provided to avoid allocations. */
export type ToScreen = (p: Vec2, out?: { x: number; y: number }) => { x: number; y: number };

export class MapLabels {
  readonly el: HTMLElement;
  /** Play-zoom anomaly labels: a layer of their own because the map layer fades out at play zoom. */
  private readonly worldEl: HTMLElement;
  private worldSpans: HTMLSpanElement[] = [];
  private worldSizes: { w: number; h: number }[] = [];
  private readonly worldItems: LabelItem[] = [];
  private readonly worldPlacedOut: (Box | null)[] = [];
  private readonly worldPlacedScratch: Box[] = [];
  private readonly worldPlacedPool: Box[] = [];
  private readonly worldLabels: WorldLabel[] = [];
  private readonly worldPos: Vec2 = { x: 0, z: 0 };
  private readonly screenPt = { x: 0, y: 0 };
  private worldBlockerAge = BLOCKER_REFRESH;
  private spans: HTMLSpanElement[] = [];
  /** Label sizes, re-measured with the blockers so a HUD-scale change is picked up. */
  private sizes: { w: number; h: number }[] = [];
  private blockers: Box[] = [];
  /** Scratch reused by every `update` so label placement allocates no arrays. */
  private readonly items: LabelItem[] = [];
  private readonly view = { w: 1, h: 1 };
  private readonly placedOut: (Box | null)[] = [];
  private readonly placedScratch: Box[] = [];
  private readonly placedPool: Box[] = [];
  private readonly blips: Blip[] = [];
  private blipSpans: HTMLSpanElement[] = [];
  /** How many leading `spans` are named bodies (station + planets); the rest are belts. */
  private bodies = 0;
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
    this.worldEl = document.createElement('div');
    this.worldEl.className = 'world-labels';
    container.append(this.el, this.worldEl);
    this.setViewport(container.clientWidth, container.clientHeight);
  }

  /** Updates the cached viewport size in CSS pixels (called by the renderer on resize). */
  setViewport(w: number, h: number): void {
    this.view.w = Math.max(1, w);
    this.view.h = Math.max(1, h);
  }

  private build(sys: StarSystem): void {
    this.el.replaceChildren();
    this.bodies = 1 + sys.planets.length;
    const names = [`${sys.name} Station`, ...sys.planets.map((p) => p.name), ...sys.belts.map(beltLabel)];
    this.blipSpans = [];
    this.spans = names.map((n, i) => {
      const s = document.createElement('span');
      s.className = i === 0 ? 'map-label station' : i < this.bodies ? 'map-label' : 'map-label belt';
      s.textContent = n;
      s.style.visibility = 'hidden';
      this.el.append(s);
      return s;
    });
    this.sizes = names.map(() => ({ w: 0, h: 0 }));
    this.blockerAge = BLOCKER_REFRESH;
  }

  /** `halfH` is the view half-height; `wpp` world units per CSS pixel. */
  update(run: Run, halfH: number, wpp: number, dt: number, toScreen: ToScreen): void {
    const sys = run.system;
    if (this.built !== sys) {
      this.build(sys);
      this.built = sys;
    }
    const opacity = labelOpacity(halfH);
    this.el.style.opacity = opacity.toFixed(3);
    if (opacity <= 0) {
      if (this.shown) {
        for (const s of this.spans) s.style.visibility = 'hidden';
        for (const s of this.blipSpans) s.style.visibility = 'hidden';
      }
      this.shown = false;
      this.blockerAge = BLOCKER_REFRESH;
      this.worldEl.style.display = '';
      this.updateWorld(run, wpp, dt, toScreen);
      return;
    }
    this.shown = true;
    this.worldEl.style.display = 'none';

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

    // Item 0 is the station, whose label clears its dock circle; then planets, then belts (placed last, so
    // a planet's name wins a clash).
    const n = this.spans.length;
    const items = this.items;
    while (items.length < n) items.push({ x: 0, y: 0, r: 0, w: 0, h: 0 });
    items.length = n;
    for (let i = 0; i < n; i++) {
      const planet = i > 0 && i < this.bodies ? sys.planets[i - 1]! : null;
      const belt = i >= this.bodies ? sys.belts[i - this.bodies]! : null;
      let target: Vec2;
      if (planet) {
        this.worldPos.x = Math.cos(planet.angle) * planet.orbitR;
        this.worldPos.z = Math.sin(planet.angle) * planet.orbitR;
        target = this.worldPos;
      } else {
        target = belt ? this.star : sys.station.pos;
      }
      const s = toScreen(target, this.screenPt);
      const r = planet ? planet.radius * (planet.ringed ? 2 : 1.2) : TUNING.dockRadius;
      const sz = this.sizes[i]!;
      const it = items[i]!;
      it.x = s.x;
      it.y = s.y;
      it.r = belt ? BELT_R_PX : Math.max(MIN_R_PX, r / wpp);
      if (belt) {
        // Anchors around the belt's middle radius (the map is a plain top-down projection from the star), top
        // first, so the name finds a gap between panels and other labels.
        const alts = (it.alts ??= []);
        const mid = (belt.inner + belt.outer) / 2 / wpp;
        alts.length = 0;
        it.x = s.x + Math.cos(BELT_ANGLES[0]!) * mid;
        it.y = s.y + Math.sin(BELT_ANGLES[0]!) * mid;
        for (let k = 1; k < BELT_ANGLES.length; k++) {
          alts.push(s.x + Math.cos(BELT_ANGLES[k]!) * mid, s.y + Math.sin(BELT_ANGLES[k]!) * mid);
        }
      } else if (it.alts) it.alts.length = 0;
      it.w = sz.w;
      it.h = sz.h;
    }
    const placed = placeLabels(items, this.blockers, this.view, this.placedOut, this.placedScratch, this.placedPool);
    for (let i = 0; i < placed.length; i++) {
      const b = placed[i]!;
      const span = this.spans[i]!;
      span.style.visibility = b && b.w > 0 ? 'visible' : 'hidden';
      if (b) span.style.transform = `translate(${b.x.toFixed(1)}px, ${b.y.toFixed(1)}px)`;
    }
    this.updateBlips(run, toScreen);
  }

  /**
   * Play-zoom labels for revealed derelicts and rich rocks. The map layer is faded out here, so this layer places
   * its own labels against the same HUD blockers and pools its spans and scratch arrays.
   */
  private updateWorld(run: Run, wpp: number, dt: number, toScreen: ToScreen): void {
    const n = collectWorldLabels(run, this.worldLabels);
    for (let i = this.worldSpans.length; i < n; i++) {
      const s = document.createElement('span');
      s.className = 'world-label';
      s.style.visibility = 'hidden';
      this.worldEl.append(s);
      this.worldSpans.push(s);
      this.worldSizes.push({ w: s.offsetWidth, h: s.offsetHeight });
    }
    for (let i = n; i < this.worldSpans.length; i++) this.worldSpans[i]!.style.visibility = 'hidden';
    if (n === 0) return;

    this.worldBlockerAge += dt;
    if (this.worldBlockerAge >= BLOCKER_REFRESH) {
      this.worldBlockerAge = 0;
      const o = this.container.getBoundingClientRect();
      this.blockers = this.readBlockers().map((b) => ({ x: b.x - o.left, y: b.y - o.top, w: b.w, h: b.h }));
      for (let i = 0; i < n; i++) {
        const sz = this.worldSizes[i]!;
        sz.w = this.worldSpans[i]!.offsetWidth;
        sz.h = this.worldSpans[i]!.offsetHeight;
      }
    }

    while (this.worldItems.length < n) this.worldItems.push({ x: 0, y: 0, r: 0, w: 0, h: 0 });
    this.worldItems.length = n;
    for (let i = 0; i < n; i++) {
      const lbl = this.worldLabels[i]!;
      const span = this.worldSpans[i]!;
      if (span.dataset.kind !== lbl.kind) {
        span.dataset.kind = lbl.kind;
        span.textContent = lbl.text;
      }
      this.worldPos.x = lbl.x;
      this.worldPos.z = lbl.z;
      const at = toScreen(this.worldPos, this.screenPt);
      const sz = this.worldSizes[i]!;
      const it = this.worldItems[i]!;
      it.x = at.x;
      it.y = at.y;
      it.r = Math.max(MIN_R_PX, 8 / wpp);
      it.w = sz.w;
      it.h = sz.h;
      if (it.alts) it.alts.length = 0;
    }
    const placed = placeLabels(
      this.worldItems,
      this.blockers,
      this.view,
      this.worldPlacedOut,
      this.worldPlacedScratch,
      this.worldPlacedPool,
    );
    for (let i = 0; i < placed.length; i++) {
      const b = placed[i]!;
      const span = this.worldSpans[i]!;
      span.style.visibility = b && b.w > 0 ? 'visible' : 'hidden';
      if (b) span.style.transform = `translate(${b.x.toFixed(1)}px, ${b.y.toFixed(1)}px)`;
    }
  }

  /** Pulsing is a CSS animation on the layer; the renderer turns it off for Low quality and reduced motion. */
  setPulse(on: boolean): void {
    this.el.classList.toggle('pulse', on);
  }

  private readonly star: Vec2 = { x: 0, z: 0 };

  private updateBlips(run: Run, toScreen: ToScreen): void {
    const n = collectBlips(run, this.blips);
    while (this.blipSpans.length < n) {
      const s = document.createElement('span');
      s.className = 'map-blip';
      s.style.visibility = 'hidden';
      this.el.append(s);
      this.blipSpans.push(s);
    }
    const tmp = this.blipPos;
    for (let i = 0; i < this.blipSpans.length; i++) {
      const span = this.blipSpans[i]!;
      if (i >= n) {
        span.style.visibility = 'hidden';
        continue;
      }
      const b = this.blips[i]!;
      tmp.x = b.x;
      tmp.z = b.z;
      const s = toScreen(tmp, this.screenPt);
      // The HUD covers a blip the same way it covers a label: hide, never draw over it.
      const hidden = pointHitsAny(s.x, s.y, this.blockers);
      span.style.visibility = hidden ? 'hidden' : 'visible';
      if (hidden) continue;
      if (span.dataset.kind !== b.kind) {
        span.dataset.kind = b.kind;
        span.textContent = BLIP_GLYPH[b.kind];
      }
      span.style.transform = `translate(${s.x.toFixed(1)}px, ${s.y.toFixed(1)}px)`;
    }
  }

  private readonly blipPos: Vec2 = { x: 0, z: 0 };
}
