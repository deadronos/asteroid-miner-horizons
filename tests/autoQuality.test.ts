import { describe, expect, it } from 'vitest';
import { AutoQuality, autoQualitySettings } from '../src/render/autoQuality';

describe('AutoQuality', () => {
  it('maps levels from full high quality down through medium and low', () => {
    expect([0, 1, 2, 3].map(autoQualitySettings)).toEqual([
      { quality: 'high', scale: 1 },
      { quality: 'high', scale: 0.75 },
      { quality: 'medium', scale: 0.75 },
      { quality: 'low', scale: 0.75 },
    ]);
    expect(autoQualitySettings(99)).toEqual({ quality: 'low', scale: 0.75 });
    expect(autoQualitySettings(Number.NaN)).toEqual({ quality: 'high', scale: 1 });
  });

  it('waits for a full rolling window and two sustained overload checks before stepping down', () => {
    const quality = new AutoQuality();
    for (let i = 0; i < 60; i++) expect(quality.update(20)).toBeNull();
    expect(quality.level).toBe(0);
    for (let i = 0; i < 14; i++) expect(quality.update(20)).toBeNull();
    expect(quality.update(20)).toBe(1);
    expect(quality.level).toBe(1);
  });

  it('requires a longer cool period to recover, with hysteresis around the threshold', () => {
    const quality = new AutoQuality(1);
    for (let i = 0; i < 100; i++) quality.update(i % 2 ? 17 : 19);
    expect(quality.level).toBe(1);
    for (let i = 0; i < 224; i++) quality.update(13);
    expect(quality.level).toBe(1);
    for (let i = 0; i < 400; i++) quality.update(13);
    expect(quality.level).toBe(0);
  });

  it('clears the opposite streak when frame time returns to the hysteresis band', () => {
    const quality = new AutoQuality();
    for (let i = 0; i < 75; i++) quality.update(20);
    for (let i = 0; i < 30; i++) quality.update(17);
    for (let i = 0; i < 5; i++) quality.update(17);
    for (let i = 0; i < 25; i++) quality.update(17);
    expect(quality.level).toBe(1);
    for (let i = 0; i < 75; i++) quality.update(20);
    expect(quality.level).toBe(2);
  });

  it('clamps at its endpoints and ignores invalid frame intervals', () => {
    const low = new AutoQuality(3);
    for (let i = 0; i < 1000; i++) low.update(13);
    expect(low.level).toBe(0);
    expect(low.update(13)).toBeNull();

    const high = new AutoQuality(0);
    for (let i = 0; i < 1000; i++) high.update(30);
    expect(high.level).toBe(3);
    expect(high.update(NaN)).toBeNull();
    expect(high.update(Infinity)).toBeNull();
    expect(high.update(0)).toBeNull();
    expect(high.level).toBe(3);
  });

  it('resets its rolling history when Auto is selected again', () => {
    const quality = new AutoQuality(3);
    quality.update(20);
    quality.reset();
    expect(quality.level).toBe(0);
    for (let i = 0; i < 60; i++) quality.update(20);
    expect(quality.level).toBe(0);
  });
});
