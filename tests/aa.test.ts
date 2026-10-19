import { describe, expect, it } from 'vitest';
import { contextAntialias, useComposer } from '../src/render/aa';
import { QUALITY, type Quality } from '../src/settings';

describe('contextAntialias', () => {
  const qualities: Quality[] = ['low', 'medium', 'high'];

  for (const q of qualities) {
    it(`${q}: context AA only when AA is on and the preset has no bloom`, () => {
      const bloom = QUALITY[q].bloom;
      expect(contextAntialias(true, bloom)).toBe(bloom === 0);
      expect(contextAntialias(false, bloom)).toBe(false);
    });
  }

  it('only low with AA on gets context antialias', () => {
    const got = qualities.filter((q) => contextAntialias(true, QUALITY[q].bloom));
    expect(got).toEqual(['low']);
  });
});

describe('useComposer', () => {
  // Truth table over bloomOn × wantAA × contextAA.
  const cases: [bloomOn: boolean, wantAA: boolean, contextAA: boolean, expected: boolean][] = [
    [false, false, false, false],
    [false, false, true, false],
    [false, true, false, true],
    [false, true, true, false],
    [true, false, false, true],
    [true, false, true, true],
    [true, true, false, true],
    [true, true, true, true],
  ];

  for (const [bloomOn, wantAA, contextAA, expected] of cases) {
    it(`bloom=${bloomOn} wantAA=${wantAA} contextAA=${contextAA} -> ${expected}`, () => {
      expect(useComposer(bloomOn, wantAA, contextAA)).toBe(expected);
    });
  }
});
