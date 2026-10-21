// Rolling frame-time controller for the optional Auto graphics preset.

import type { Quality } from '../settings';

const WINDOW_MS = 1_000;
const CHECK_MS = 500;
const DOWN_MS = 18;
const UP_MS = 14;
const DOWN_CHECKS = 2;
const UP_CHECKS = 6;
const MAX_SAMPLES = 512;

/** Maps Auto's transient level to a fixed preset and an additional scale multiplier. */
export function autoQualitySettings(level: number): { quality: Exclude<Quality, 'auto'>; scale: number } {
  const bounded = Number.isFinite(level) ? Math.max(0, Math.min(3, Math.trunc(level))) : 0;
  if (bounded === 0) return { quality: 'high', scale: 1 };
  if (bounded === 1) return { quality: 'high', scale: 0.75 };
  if (bounded === 2) return { quality: 'medium', scale: 0.75 };
  return { quality: 'low', scale: 0.75 };
}

/** Adapts between four quality levels with a slower recovery threshold to avoid visible oscillation. */
export class AutoQuality {
  private readonly times = new Float64Array(MAX_SAMPLES);
  private readonly frames = new Float64Array(MAX_SAMPLES);
  private head = 0;
  private count = 0;
  private elapsed = 0;
  private nextCheck = WINDOW_MS;
  private overloaded = 0;
  private recovering = 0;
  private current: number;

  constructor(initialLevel = 0) {
    this.current = Number.isFinite(initialLevel) ? Math.max(0, Math.min(3, Math.trunc(initialLevel))) : 0;
  }

  /** Current effective quality level: 0 is High/full scale; 3 is Low/75% scale. */
  get level(): number {
    return this.current;
  }

  /** Clears the frame-time history and returns to the initial Auto level. */
  reset(initialLevel = 0): void {
    this.head = 0;
    this.count = 0;
    this.elapsed = 0;
    this.nextCheck = WINDOW_MS;
    this.overloaded = 0;
    this.recovering = 0;
    this.current = Number.isFinite(initialLevel) ? Math.max(0, Math.min(3, Math.trunc(initialLevel))) : 0;
  }

  /** Adds one rendered frame interval in milliseconds and returns a new level only when it changes. */
  update(frameMs: number): number | null {
    if (!Number.isFinite(frameMs) || frameMs <= 0) return null;

    this.elapsed += frameMs;
    const slot = (this.head + this.count) % MAX_SAMPLES;
    if (this.count === MAX_SAMPLES) {
      this.head = (this.head + 1) % MAX_SAMPLES;
      this.count--;
    }
    this.times[slot] = this.elapsed;
    this.frames[slot] = frameMs;
    this.count++;

    while (this.count && this.times[this.head] < this.elapsed - WINDOW_MS) {
      this.head = (this.head + 1) % MAX_SAMPLES;
      this.count--;
    }

    if (this.elapsed < this.nextCheck || this.elapsed < WINDOW_MS) return null;
    this.nextCheck = this.elapsed + CHECK_MS;
    let total = 0;
    for (let i = 0; i < this.count; i++) total += this.frames[(this.head + i) % MAX_SAMPLES];
    const average = total / this.count;

    if (average > DOWN_MS) {
      this.overloaded++;
      this.recovering = 0;
      if (this.overloaded >= DOWN_CHECKS && this.current < 3) {
        this.current++;
        this.overloaded = 0;
        return this.current;
      }
    } else if (average < UP_MS) {
      this.recovering++;
      this.overloaded = 0;
      if (this.recovering >= UP_CHECKS && this.current > 0) {
        this.current--;
        this.recovering = 0;
        return this.current;
      }
    } else {
      this.overloaded = 0;
      this.recovering = 0;
    }
    return null;
  }
}
