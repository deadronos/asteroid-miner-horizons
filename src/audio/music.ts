// Generative ambient music rules: one mood (scale, timbre, tempo) per star
// class, varied per system from the run seed, and the pure note choices a
// player schedules from it — a slow pad chord per bar, a sparse arpeggio over
// it and a low pulse under danger. No audio files: every note is an
// oscillator. Randomness is injected so the choices are unit-testable.

import { hash01 } from '../core/rng';
import { isAlive } from '../sim/ships';
import type { Run, StarClass } from '../sim/types';

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

/** Per-class arpeggio timbres a system may pick from; the first is the class default. */
const ARP_WAVES: Record<StarClass, readonly OscillatorType[]> = {
  M: ['sine', 'triangle'],
  G: ['triangle', 'sine'],
  B: ['square', 'triangle'],
};
/** Root shifts (semitones) a system may take; small enough that M stays lowest and B highest. */
const TRANSPOSE = [0, 2, -2, 1, -1] as const;
/** Orders of the three non-tonic bars: the progression always opens on its class's first degree. */
const ORDERS = [
  [0, 1, 2],
  [0, 2, 1],
  [1, 0, 2],
  [1, 2, 0],
  [2, 0, 1],
  [2, 1, 0],
] as const;
const VARIANTS = TRANSPOSE.length * ORDERS.length * 2;
/** Coprime to VARIANTS, so systems fewer than VARIANTS apart never share a variant. */
const VARIANT_STRIDE = 37;

/**
 * The mood for system `number` of the run seeded `seed`: its star class's scale, tempo and filter, with
 * the root transposition, progression order and arpeggio timbre picked deterministically per system.
 * Two systems of one class sound related (same scale and pace) but not identical.
 */
export function systemMood(starClass: StarClass, seed: number, number: number): Mood {
  const base = MOODS[starClass];
  const offset = Math.floor(hash01(seed ^ 0x6d757321) * VARIANTS);
  let v = (((offset + number * VARIANT_STRIDE) % VARIANTS) + VARIANTS) % VARIANTS;
  const transpose = TRANSPOSE[v % TRANSPOSE.length]!;
  v = Math.floor(v / TRANSPOSE.length);
  const order = ORDERS[v % ORDERS.length]!;
  v = Math.floor(v / ORDERS.length);
  const tail = base.progression.slice(1);
  return {
    ...base,
    root: base.root * 2 ** (transpose / 12),
    progression: [base.progression[0]!, ...order.map((i) => tail[i]!)],
    arpWave: ARP_WAVES[starClass][v]!,
  };
}

/** How tense (danger) and busy (activity) the music should be, each 0..1. */
export interface MusicIntensity {
  danger: number;
  activity: number;
}

export const CALM: Readonly<MusicIntensity> = Object.freeze({ danger: 0, activity: 0 });

/** Danger from a pending or burning flare, and somewhat less from a comet, warned or in flight. */
const FLARE_DANGER = 1;
const COMET_DANGER = 0.6;
/** Mining beams at which the arpeggio is at its busiest. */
const BUSY_BEAMS = 3;

/** The intensity the run calls for right now. Read-only on `run`. */
export function musicIntensity(run: Run): MusicIntensity {
  const hz = run.hazards;
  const danger = hz.flare ? FLARE_DANGER : hz.comet || run.rocks.some((r) => r.comet) ? COMET_DANGER : 0;
  let beams = 0;
  for (const s of run.ships) if (isAlive(s) && s.beamOn) beams++;
  return { danger, activity: Math.min(1, beams / BUSY_BEAMS) };
}

/** Arpeggio step chance under `i`: up to half again while the fleet mines, halved under full danger. */
export function arpDensity(mood: Mood, i: MusicIntensity): number {
  return Math.min(0.85, mood.density * (1 + 0.5 * i.activity) * (1 - 0.5 * i.danger));
}

/** Layer lowpass cutoff under `i`: darker as danger rises. */
export function layerCutoff(mood: Mood, i: MusicIntensity): number {
  return mood.cutoff * (1 - 0.4 * i.danger);
}

/**
 * The danger pulse for one step of `bar`: the chord root an octave below the pad, on each quarter of
 * the bar, or null when off the beat or calm. The player scales its gain by danger.
 */
export function pulseNote(mood: Mood, bar: number, step: number, danger: number): number | null {
  if (danger < 0.05 || step % Math.max(1, Math.floor(mood.barSteps / 4)) !== 0) return null;
  const p = mood.progression;
  return degreeFreq(mood, p[((bar % p.length) + p.length) % p.length]!, -1);
}

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
 * always sounds the chord root; other steps sound with `density`, mostly
 * on chord tones, sometimes on a passing scale tone.
 */
export function arpNote(
  mood: Mood,
  bar: number,
  step: number,
  rand: () => number,
  density = mood.density,
): number | null {
  const p = mood.progression;
  const deg = p[((bar % p.length) + p.length) % p.length]!;
  if (step === 0) return degreeFreq(mood, deg, mood.arpOctave);
  if (rand() >= density) return null;
  const pick = rand();
  const offset = pick < 0.75 ? [0, 2, 4, 7][Math.floor((pick / 0.75) * 4)]! : 1 + Math.floor(rand() * 5);
  return degreeFreq(mood, deg + offset, mood.arpOctave);
}
