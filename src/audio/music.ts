// Generative ambient music rules: one mood (scale, timbre, tempo) per star
// class and the pure note choices a player schedules from it — a slow pad
// chord per bar and a sparse arpeggio over it. No audio files: every note is an
// oscillator. Randomness is injected so the choices are unit-testable.

import type { StarClass } from '../sim/types';

export interface Mood {
  /** Frequency (Hz) of scale degree 0 in the pad's octave. */
  root: number;
  /** Scale as semitone offsets from the root, ascending, within one octave. */
  scale: readonly number[];
  /** Chord progression: the scale degree each bar's pad chord is built on. */
  progression: readonly number[];
  padWave: OscillatorType;
  arpWave: OscillatorType;
  /** Lowpass cutoff (Hz) on the whole layer: lower is warmer. */
  cutoff: number;
  /** Seconds per arpeggio step. */
  stepSec: number;
  /** Arpeggio steps per bar (one pad chord per bar). */
  barSteps: number;
  /** Chance (0..1) that an arpeggio step sounds. */
  density: number;
  /** Octaves above the root the arpeggio plays in. */
  arpOctave: number;
  /** Detune spread (cents) between the pad's voices. */
  detune: number;
}

/** M stars are warm, G neutral, B cold. */
export const MOODS: Record<StarClass, Mood> = {
  // Low, slow and soft: major pentatonic on triangles under a dark filter.
  M: {
    root: 110,
    scale: [0, 2, 4, 7, 9],
    progression: [0, 3, 1, 4],
    padWave: 'triangle',
    arpWave: 'sine',
    cutoff: 900,
    stepSec: 0.6,
    barSteps: 16,
    density: 0.3,
    arpOctave: 1,
    detune: 9,
  },
  // Dorian on a filtered saw pad: open, unresolved, neither bright nor dark.
  G: {
    root: 146.83,
    scale: [0, 2, 3, 5, 7, 9, 10],
    progression: [0, 3, 5, 4],
    padWave: 'sawtooth',
    arpWave: 'triangle',
    cutoff: 1400,
    stepSec: 0.45,
    barSteps: 16,
    density: 0.4,
    arpOctave: 1,
    detune: 7,
  },
  // High, bright and sparse: a stark minor-sixth scale with glassy square blips.
  B: {
    root: 164.81,
    scale: [0, 2, 3, 7, 8],
    progression: [0, 3, 0, 4],
    padWave: 'sine',
    arpWave: 'square',
    cutoff: 3200,
    stepSec: 0.3,
    barSteps: 24,
    density: 0.22,
    arpOctave: 2,
    detune: 14,
  },
};

/** Frequency of scale `degree` (may exceed the scale length or be negative) shifted by `octave`. */
export function degreeFreq(mood: Mood, degree: number, octave = 0): number {
  const n = mood.scale.length;
  const oct = Math.floor(degree / n) + octave;
  const semis = mood.scale[((degree % n) + n) % n]! + 12 * oct;
  return mood.root * 2 ** (semis / 12);
}

/** The pad chord for `bar`: three stacked scale thirds on the progression's degree, low to high. */
export function chordAt(mood: Mood, bar: number): number[] {
  const p = mood.progression;
  const deg = p[((bar % p.length) + p.length) % p.length]!;
  return [deg, deg + 2, deg + 4].map((d) => degreeFreq(mood, d));
}

/**
 * The arpeggio note for one step of `bar`, or null for a rest. The downbeat
 * always sounds the chord root; other steps sound with `mood.density`, mostly
 * on chord tones, sometimes on a passing scale tone.
 */
export function arpNote(mood: Mood, bar: number, step: number, rand: () => number): number | null {
  const p = mood.progression;
  const deg = p[((bar % p.length) + p.length) % p.length]!;
  if (step === 0) return degreeFreq(mood, deg, mood.arpOctave);
  if (rand() >= mood.density) return null;
  const pick = rand();
  const offset = pick < 0.75 ? [0, 2, 4, 7][Math.floor((pick / 0.75) * 4)]! : 1 + Math.floor(rand() * 5);
  return degreeFreq(mood, deg + offset, mood.arpOctave);
}
