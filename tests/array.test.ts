import { describe, expect, it } from 'vitest';
import { removeItem } from '../src/core/array';

describe('removeItem', () => {
  it('removes the first match in place, preserving order and identity', () => {
    const arr = [1, 2, 3, 2];
    const same = arr;
    expect(removeItem(arr, 2)).toBe(true);
    expect(arr).toEqual([1, 3, 2]);
    expect(arr).toBe(same);
  });

  it('returns false and leaves the array untouched when absent', () => {
    const arr = ['a', 'b'];
    expect(removeItem(arr, 'z')).toBe(false);
    expect(arr).toEqual(['a', 'b']);
  });

  it('removes the last element', () => {
    const arr = [1, 2];
    expect(removeItem(arr, 2)).toBe(true);
    expect(arr).toEqual([1]);
  });

  it('returns false on an empty array', () => {
    const arr: number[] = [];
    expect(removeItem(arr, 1)).toBe(false);
    expect(arr).toEqual([]);
  });

  it('removes a match at index 0', () => {
    const arr = [1, 2, 3];
    const same = arr;
    expect(removeItem(arr, 1)).toBe(true);
    expect(arr).toEqual([2, 3]);
    expect(arr).toBe(same);
  });
});
