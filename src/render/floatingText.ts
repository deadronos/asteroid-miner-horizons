// Floating pickup text ("+12 ⬢") that rises from a ship and fades. A fixed
// pool of spans is created once; collects for the same ship and resource
// within BATCH_WINDOW merge into one label instead of spawning new ones.

import { RESOURCE_INFO, type Resource } from '../data/resources';
import type { Vec2 } from '../core/vec';

const POOL = 48;
/** Seconds after the last pickup during which more pickups add to the same label. */
export const BATCH_WINDOW = 0.3;
const LIFE = 1.1;
const RISE_PX = 42;

export interface Floater {
  key: string;
  kind: Resource;
  shipId: number;
  amount: number;
  /** Seconds since the label appeared (drives rise/fade). */
  age: number;
  /** Seconds since the last pickup merged into it. */
  sinceAdd: number;
  pos: Vec2;
  live: boolean;
}

/**
 * Merges a pickup into `pool`: bumps a live label that is still inside the
 * batch window, otherwise reuses a dead slot (or the oldest). Returns the slot.
 */
export function addPickup(pool: Floater[], shipId: number, kind: Resource, amount: number, pos: Vec2): Floater {
  const key = `${shipId}:${kind}`;
  let slot: Floater | undefined;
  for (const f of pool) if (f.live && f.key === key && f.sinceAdd < BATCH_WINDOW) slot = f;
  if (slot) {
    slot.amount += amount;
    slot.sinceAdd = 0;
    // Keep the merged label readable instead of letting it drift away mid-streak.
    slot.age = Math.min(slot.age, LIFE * 0.3);
    slot.pos = { ...pos };
    return slot;
  }
  slot = pool.find((f) => !f.live) ?? pool.reduce((a, b) => (b.age > a.age ? b : a));
  Object.assign(slot, { key, kind, shipId, amount, age: 0, sinceAdd: 0, pos: { ...pos }, live: true });
  return slot;
}

/** Ages every label; returns nothing, dead labels just flip `live` off. */
export function ageFloaters(pool: Floater[], dt: number): void {
  for (const f of pool) {
    if (!f.live) continue;
    f.age += dt;
    f.sinceAdd += dt;
    if (f.age >= LIFE) f.live = false;
  }
}

export const emptyFloater = (): Floater => ({
  key: '',
  kind: 'ore',
  shipId: -1,
  amount: 0,
  age: 0,
  sinceAdd: 0,
  pos: { x: 0, z: 0 },
  live: false,
});

export class FloatingText {
  readonly el: HTMLElement;
  private pool: Floater[] = [];
  private spans: HTMLSpanElement[] = [];
  private shown: string[] = [];

  constructor(container: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'floaters';
    container.append(this.el);
    for (let i = 0; i < POOL; i++) {
      this.pool.push(emptyFloater());
      const s = document.createElement('span');
      s.className = 'floater';
      s.style.opacity = '0';
      this.el.append(s);
      this.spans.push(s);
      this.shown.push('');
    }
  }

  add(shipId: number, kind: Resource, amount: number, pos: Vec2): void {
    addPickup(this.pool, shipId, kind, amount, pos);
  }

  /** `anchor` returns the ship's current position (labels follow it), or null if it's gone. */
  update(dt: number, toScreen: (p: Vec2) => { x: number; y: number }, anchor: (shipId: number) => Vec2 | null): void {
    ageFloaters(this.pool, dt);
    this.pool.forEach((f, i) => {
      const span = this.spans[i]!;
      if (!f.live) {
        if (this.shown[i] !== '') {
          span.style.opacity = '0';
          this.shown[i] = '';
        }
        return;
      }
      const at = anchor(f.shipId);
      if (at) f.pos = { ...at };
      const p = toScreen(f.pos);
      const t = f.age / LIFE;
      const rise = RISE_PX * (1 - (1 - t) * (1 - t));
      const pop = f.sinceAdd < 0.12 ? 1 + (0.12 - f.sinceAdd) * 2.5 : 1;
      span.style.transform = `translate(${p.x.toFixed(1)}px, ${(p.y - 26 - rise).toFixed(1)}px) translate(-50%, -100%) scale(${pop.toFixed(3)})`;
      span.style.opacity = (t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3).toFixed(3);
      const info = RESOURCE_INFO[f.kind];
      const text = `+${formatAmount(f.amount)} ${info.icon}`;
      const tag = `${text}|${f.kind}`;
      if (this.shown[i] !== tag) {
        span.textContent = text;
        span.style.color = info.css;
        this.shown[i] = tag;
      }
    });
  }
}

/** Whole numbers once they're big enough to read; one decimal for small trickles. */
export function formatAmount(n: number): string {
  return n >= 9.95 ? String(Math.round(n)) : n.toFixed(1).replace(/\.0$/, '');
}
