// The mix rules shared by the engine: the master limiter numbers, the
// per-sound reverb send and a generated stereo impulse. Kept pure so they are
// testable without Web Audio.

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
