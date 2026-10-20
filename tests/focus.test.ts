import { describe, expect, it } from 'vitest';
import { nextFocusIndex } from '../src/ui/focus';

// The menu's Tab trap: forward/backward wrap, entering from outside, and a single item.
describe('nextFocusIndex', () => {
  it('wraps forward from the last item to the first', () => {
    expect(nextFocusIndex(3, 2, false)).toBe(0);
    expect(nextFocusIndex(3, 0, false)).toBe(1);
  });

  it('wraps backward from the first item to the last', () => {
    expect(nextFocusIndex(3, 0, true)).toBe(2);
    expect(nextFocusIndex(3, 1, true)).toBe(0);
  });

  it('enters at the matching end when the index is outside the list', () => {
    expect(nextFocusIndex(3, -1, false)).toBe(0);
    expect(nextFocusIndex(3, 3, false)).toBe(0);
    expect(nextFocusIndex(3, -1, true)).toBe(2);
    expect(nextFocusIndex(3, 7, true)).toBe(2);
  });

  it('stays on the only item when there is one', () => {
    expect(nextFocusIndex(1, 0, false)).toBe(0);
    expect(nextFocusIndex(1, 0, true)).toBe(0);
    expect(nextFocusIndex(1, -1, false)).toBe(0);
  });

  it('reports nothing to focus when the list is empty', () => {
    expect(nextFocusIndex(0, -1, false)).toBe(-1);
    expect(nextFocusIndex(0, 0, true)).toBe(-1);
  });
});
