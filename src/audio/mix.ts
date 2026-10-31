// The mix rules shared by the engine: the master limiter numbers, the
// per-sound reverb send, a generated stereo impulse and the music-duck
// envelope. Kept pure so they are testable without Web Audio.

import type { SoundId } from './sfx';

export interface LimiterSettings {
  /** Ceiling in dBFS: the limiter pulls peaks down to here. */
  threshold: number;
  /** dB of soft transition around the threshold; 0 is a hard knee. */
  knee: number;
  ratio: number;
  /** Seconds to clamp down to the threshold. */
  attack: number;
  /** Seconds to recover after the peak passes. */
  release: number;
}

/** Master bus limiter: hard knee and a fast attack so stacked voices never clip. */
export const LIMITER: LimiterSettings = Object.freeze({
  threshold: -6,
  knee: 0,
  ratio: 20,
  attack: 0.003,
  release: 0.25,
});

/** Generated impulse length in seconds. */
export const REVERB_SECONDS = 1.8;

/** Amplitude decay exponent: higher dies away faster. */
export const REVERB_DECAY = 2.6;

/** Wet gain of the reverb return into the master bus. */
export const REVERB_RETURN = 0.9;

/** Reverb send per sound (linear, 0..1); unlisted sounds stay dry. */
export const REVERB_SEND: Readonly<Partial<Record<SoundId, number>>> = Object.freeze({
  explode: 0.32,
  dock: 0.22,
  collect: 0.12,
  achievement: 0.22,
  contractDone: 0.22,
  loss: 0.32,
  ping: 0.24,
  salvage: 0.22,
});

/**
 * A decorrelated stereo noise impulse of `floor(sampleRate * seconds)` samples
 * per channel, decaying by `(1 - i / length) ** decay`. Randomness is injected
 * so the impulse replays exactly in tests.
 */
export function reverbImpulse(
  sampleRate: number,
  seconds = REVERB_SECONDS,
  decay = REVERB_DECAY,
  rand: () => number = Math.random,
): [Float32Array<ArrayBuffer>, Float32Array<ArrayBuffer>] {
  const length = Math.floor(sampleRate * seconds);
  const left = new Float32Array(length);
  const right = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const envelope = (1 - i / length) ** decay;
    left[i] = (rand() * 2 - 1) * envelope;
    right[i] = (rand() * 2 - 1) * envelope;
  }
  return [left, right];
}

/** One music dip: how far the music drops and how long it takes to come back. */
export interface DuckShape {
  /** Fraction of the music level removed at full strength (0..1). */
  depth: number;
  /** Seconds to ramp down to the full dip. */
  attack: number;
  /** Seconds held at the full dip. */
  hold: number;
  /** Seconds to ramp back to full level. */
  release: number;
}

/** Sounds that duck the music under them; unlisted sounds (pickups, cracks) never do, so nothing pumps. */
export const DUCK: Readonly<Partial<Record<SoundId, DuckShape>>> = Object.freeze({
  // Outlasts the engine's 1.1 s alarm repeat, so a sustained alarm holds the music down instead of pumping it.
  alarm: { depth: 0.45, attack: 0.05, hold: 0.5, release: 0.8 },
  explode: { depth: 0.5, attack: 0.03, hold: 0.25, release: 0.8 },
  loss: { depth: 0.6, attack: 0.05, hold: 0.6, release: 1.2 },
  warp: { depth: 0.5, attack: 0.1, hold: 0.5, release: 1 },
});

/** How deep a dip is (0 = none, 1 = full depth) `t` seconds after it started: ramp down, hold, ramp back. */
export function duckEnvelope(shape: DuckShape, t: number): number {
  if (t < 0) return 0;
  if (t < shape.attack) return t / shape.attack;
  t -= shape.attack;
  if (t < shape.hold) return 1;
  t -= shape.hold;
  return t < shape.release ? 1 - t / shape.release : 0;
}

/**
 * The live set of music dips. Overlapping dips take the deepest rather than
 * stacking or restarting, so a repeating alarm or a chain of explosions holds
 * the music down steadily instead of pumping it.
 */
export class Ducker {
  private dips: { shape: DuckShape; strength: number; start: number }[] = [];

  /** Starts a dip for `id` at `now`, scaled by the voice's gain (a distant boom ducks less). */
  trigger(id: SoundId, gain: number, now: number): void {
    const shape = DUCK[id];
    const strength = Math.min(1, Math.max(0, gain));
    if (shape && strength > 0) this.dips.push({ shape, strength, start: now });
  }

  /** Music gain multiplier at `now` (1 = unducked); drops dips that have fully recovered. */
  level(now: number): number {
    let deepest = 0;
    this.dips = this.dips.filter((d) => {
      const { attack, hold, release } = d.shape;
      if (now - d.start >= attack + hold + release) return false;
      deepest = Math.max(deepest, d.strength * d.shape.depth * duckEnvelope(d.shape, now - d.start));
      return true;
    });
    return 1 - deepest;
  }
}
