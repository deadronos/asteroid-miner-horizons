import { describe, expect, it } from 'vitest';
import {
  BATCH_WINDOW,
  FloatingText,
  addPickup,
  ageFloaters,
  emptyFloater,
  formatAmount,
} from '../src/render/floatingText';

const at = { x: 0, z: 0 };
const makeEl = () => ({
  className: '',
  style: { opacity: '', visibility: '', transform: '', color: '' },
  textContent: '',
  append: () => {},
});
const toScreen = () => ({ x: 100, y: 100 });
const anchor = () => at;

describe('floating pickup text', () => {
  it('merges pickups for the same ship and resource inside the batch window', () => {
    const pool = [emptyFloater(), emptyFloater(), emptyFloater()];
    const a = addPickup(pool, 1, 'ore', 2, at);
    ageFloaters(pool, BATCH_WINDOW * 0.5);
    const b = addPickup(pool, 1, 'ore', 3, at);
    expect(b).toBe(a);
    expect(a.amount).toBe(5);
    expect(pool.filter((f) => f.live)).toHaveLength(1);
  });

  it('keeps separate labels per resource and per ship', () => {
    const pool = [emptyFloater(), emptyFloater(), emptyFloater()];
    addPickup(pool, 1, 'ore', 1, at);
    addPickup(pool, 1, 'ice', 1, at);
    addPickup(pool, 2, 'ore', 1, at);
    expect(pool.filter((f) => f.live)).toHaveLength(3);
  });

  it('starts a new label once the batch window has passed', () => {
    const pool = [emptyFloater(), emptyFloater()];
    const a = addPickup(pool, 1, 'ore', 1, at);
    ageFloaters(pool, BATCH_WINDOW + 0.01);
    const b = addPickup(pool, 1, 'ore', 1, at);
    expect(b).not.toBe(a);
  });

  it('recycles the oldest slot when the pool is full (no allocation)', () => {
    const pool = [emptyFloater(), emptyFloater()];
    const first = addPickup(pool, 1, 'ore', 1, at);
    ageFloaters(pool, 0.1);
    addPickup(pool, 2, 'ore', 1, at);
    const third = addPickup(pool, 3, 'ore', 1, at);
    expect(third).toBe(first);
    expect(pool).toHaveLength(2);
  });

  it('expires labels', () => {
    const pool = [emptyFloater()];
    addPickup(pool, 1, 'ore', 1, at);
    ageFloaters(pool, 5);
    expect(pool[0]!.live).toBe(false);
  });

  it('formats amounts', () => {
    expect(formatAmount(0.5)).toBe('0.5');
    expect(formatAmount(3)).toBe('3');
    expect(formatAmount(12.4)).toBe('12');
  });

  it('fades and hides the floating text layer as camera enters map zoom', () => {
    const prevDoc = globalThis.document;
    Object.defineProperty(globalThis, 'document', {
      value: { createElement: () => makeEl() },
      configurable: true,
    });
    try {
      const container = makeEl() as unknown as HTMLElement;
      const ft = new FloatingText(container);
      ft.add(1, 'ore', 5, at);

      ft.update(0.05, toScreen, anchor, 420);
      expect(ft.el.style.opacity).toBe('1.000');
      expect(ft.el.style.visibility).toBe('visible');

      ft.update(0.05, toScreen, anchor, 1100);
      expect(Number(ft.el.style.opacity)).toBeCloseTo(0.5, 2);
      expect(ft.el.style.visibility).toBe('visible');

      ft.update(0.05, toScreen, anchor, 1300);
      expect(ft.el.style.opacity).toBe('0.000');
      expect(ft.el.style.visibility).toBe('hidden');
    } finally {
      Object.defineProperty(globalThis, 'document', { value: prevDoc, configurable: true });
    }
  });
});
