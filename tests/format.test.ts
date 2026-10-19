import { describe, expect, it } from 'vitest';
import { formatCountdown, formatDuration } from '../src/core/format';

describe('formatDuration', () => {
  it('formats hours, minutes and seconds', () => {
    expect(formatDuration(3 * 3600 + 5 * 60 + 9)).toBe('3h 05m');
    expect(formatDuration(12 * 60 + 30)).toBe('12m');
    expect(formatDuration(59)).toBe('0m');
    expect(formatDuration(-5)).toBe('0m');
  });

  it('adds seconds under an hour when asked', () => {
    expect(formatDuration(45, { seconds: true })).toBe('45s');
    expect(formatDuration(12 * 60 + 30, { seconds: true })).toBe('12m 30s');
    expect(formatDuration(3 * 3600 + 5 * 60 + 9, { seconds: true })).toBe('3h 05m');
  });

  it('handles exact hour and minute boundaries', () => {
    expect(formatDuration(60)).toBe('1m');
    expect(formatDuration(60, { seconds: true })).toBe('1m 00s');
    expect(formatDuration(3600)).toBe('1h 00m');
    expect(formatDuration(24 * 3600)).toBe('24h 00m');
  });

  it('floors fractional seconds', () => {
    expect(formatDuration(59.9)).toBe('0m');
    expect(formatDuration(59.9, { seconds: true })).toBe('59s');
  });

  it('zero-pads the sub-hour clock seconds', () => {
    expect(formatDuration(45, { seconds: true })).toBe('45s');
    expect(formatDuration(12 * 60 + 5, { seconds: true })).toBe('12m 05s');
  });
});

describe('formatCountdown', () => {
  it('rounds up and clamps a m:ss countdown', () => {
    expect(formatCountdown(61.2)).toBe('1:02');
    expect(formatCountdown(-3)).toBe('0:00');
    expect(formatCountdown(0)).toBe('0:00');
    expect(formatCountdown(300)).toBe('5:00');
  });
});
