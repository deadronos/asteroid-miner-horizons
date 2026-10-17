// ZzFX sample generator, adapted to TypeScript. It only builds the samples;
// playback goes through AudioEngine so every sound shares one mixer.
//
// ZzFX - Zuper Zmall Zound Zynth - Frank Force
// MIT License - Copyright 2019 Frank Force
// https://github.com/KilledByAPixel/ZzFX

export const ZZFX_RATE = 44100;

const sign = (v: number): number => (v < 0 ? -1 : 1);

/**
 * ZzFX parameters, in the order the ZzFX designer exports them:
 * [volume, randomness, frequency, attack, sustain, release, shape, shapeCurve,
 *  slide, deltaSlide, pitchJump, pitchJumpTime, repeatTime, noise, modulation,
 *  bitCrush, delay, sustainVolume, decay, tremolo, filter]
 */
export type ZzfxParams = readonly (number | undefined)[];

/** Renders a ZzFX sound to mono samples. `rand` replaces Math.random (for tests). */
export function zzfxSamples(params: ZzfxParams, rand: () => number = Math.random): Float32Array<ArrayBuffer> {
  let [
    volume = 1,
    randomness = 0.05,
    frequency = 220,
    attack = 0,
    sustain = 0,
    release = 0.1,
    shape = 0,
    shapeCurve = 1,
    slide = 0,
    deltaSlide = 0,
    pitchJump = 0,
    pitchJumpTime = 0,
    repeatTime = 0,
    noise = 0,
    modulation = 0,
    bitCrush = 0,
    delay = 0,
    sustainVolume = 1,
    decay = 0,
    tremolo = 0,
    filter = 0,
  ] = params;
  const PI2 = Math.PI * 2;
  const sr = ZZFX_RATE;
  const startSlide = (slide *= (500 * PI2) / sr / sr);
  let startFrequency = (frequency *= ((1 + randomness * 2 * rand() - randomness) * PI2) / sr);

  // Biquad filter (low-pass when filter > 0, high-pass when < 0).
  const quality = 2;
  const w = (PI2 * Math.abs(filter) * 2) / sr;
  const cos = Math.cos(w);
  const alpha = Math.sin(w) / 2 / quality;
  const a0 = 1 + alpha;
  const a1 = (-2 * cos) / a0;
  const a2 = (1 - alpha) / a0;
  const b0 = (1 + sign(filter) * cos) / 2 / a0;
  const b1 = -(sign(filter) + cos) / a0;
  const b2 = b0;
  let x2 = 0;
  let x1 = 0;
  let y2 = 0;
  let y1 = 0;

  attack = attack * sr + 9;
  decay *= sr;
  sustain *= sr;
  release *= sr;
  delay *= sr;
  deltaSlide *= (500 * PI2) / sr ** 3;
  modulation *= PI2 / sr;
  pitchJump *= PI2 / sr;
  pitchJumpTime *= sr;
  repeatTime = (repeatTime * sr) | 0;

  const length = (attack + decay + sustain + release + delay) | 0;
  const b = new Float32Array(length);
  let t = 0;
  let tm = 0;
  let j = 1;
  let r = 0;
  let c = 0;
  let s = 0;
  const crush = (bitCrush * 100) | 0;
  for (let i = 0; i < length; i++) {
    if (!crush || !(++c % crush)) {
      s = shape
        ? shape > 1
          ? shape > 2
            ? shape > 3
              ? Math.sin(t ** 3)
              : Math.max(Math.min(Math.tan(t), 1), -1)
            : 1 - (((((2 * t) / PI2) % 2) + 2) % 2)
          : 1 - 4 * Math.abs(Math.round(t / PI2) - t / PI2)
        : Math.sin(t);
      s =
        (repeatTime ? 1 - tremolo + tremolo * Math.sin((PI2 * i) / repeatTime) : 1) *
        sign(s) *
        Math.abs(s) ** shapeCurve *
        (i < attack
          ? i / attack
          : i < attack + decay
            ? 1 - ((i - attack) / decay) * (1 - sustainVolume)
            : i < attack + decay + sustain
              ? sustainVolume
              : i < length - delay
                ? ((length - i - delay) / release) * sustainVolume
                : 0);
      s = delay
        ? s / 2 + (delay > i ? 0 : ((i < length - delay ? 1 : (length - i) / delay) * b[(i - delay) | 0]!) / 2 / volume)
        : s;
      if (filter) s = y1 = b2 * x2 + b1 * (x2 = x1) + b0 * (x1 = s) - a2 * y2 - a1 * (y2 = y1);
    }
    const f = (frequency += slide += deltaSlide) * Math.cos(modulation * tm++);
    t += f + f * noise * Math.sin(i ** 5);
    if (j && ++j > pitchJumpTime) {
      frequency += pitchJump;
      startFrequency += pitchJump;
      j = 0;
    }
    if (repeatTime && !(++r % repeatTime)) {
      frequency = startFrequency;
      slide = startSlide;
      j ||= 1;
    }
    b[i] = s * volume;
  }
  return b;
}
