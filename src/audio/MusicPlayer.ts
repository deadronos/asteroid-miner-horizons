// Plays the generative ambient music from `music.ts` into the mixer's music
// bus. One layer per star system: each layer schedules its pad and arpeggio
// notes a short lookahead ahead of the clock, and a warp crossfades from the
// old layer to a new one. A smoothed intensity, shared by every layer so it
// carries across the crossfade, thins and darkens the music under danger (with
// a low pulse) and busies the arpeggio while the fleet mines. Cost stays tiny:
// a few short-lived oscillators per second, one lowpass per layer and one
// shared feedback delay for space.

import type { StarClass } from '../sim/types';
import {
  arpDensity,
  arpNote,
  CALM,
  chordAt,
  layerCutoff,
  type Mood,
  type MusicIntensity,
  pulseNote,
  systemMood,
} from './music';

/** Seconds of notes scheduled ahead of the clock each update. */
const LOOKAHEAD = 0.3;
/** Crossfade length on warp, in seconds. */
const FADE = 4;
/** Peak gains, kept low so the music sits under the SFX. */
const PAD_GAIN = 0.05;
const ARP_GAIN = 0.035;
const PAD_ATTACK = 1.8;
const PAD_RELEASE = 2.5;
const ARP_RELEASE = 0.9;
/** Peak gain of the danger pulse at full danger. */
const PULSE_GAIN = 0.06;
const PULSE_RELEASE = 0.7;
/** Time constant (s) the intensity eases toward its target with, so layer changes swell rather than jump. */
const INTENSITY_TAU = 1.5;
/** Echo time and feedback of the shared delay. */
const DELAY_SEC = 0.42;
const DELAY_FEEDBACK = 0.35;

interface Layer {
  seed: number;
  number: number;
  mood: Mood;
  gain: GainNode;
  filter: BiquadFilterNode;
  bar: number;
  step: number;
  /** Context time of the next step to schedule. */
  nextAt: number;
  /** Set once the layer is fading out: the time it is silent and can be dropped. */
  endAt: number | null;
  /** Last cutoff handed to the filter, so a settled level schedules no more automation. */
  cutoff: number;
}

export class MusicPlayer {
  private readonly input: GainNode;
  private current: Layer | null = null;
  private fading: Layer[] = [];
  /** Smoothed intensity the layers play at. */
  private readonly level: MusicIntensity = { ...CALM };
  private lastAt: number | null = null;

  constructor(
    private readonly ctx: AudioContext,
    out: AudioNode,
    private readonly rand: () => number = Math.random,
  ) {
    this.input = ctx.createGain();
    const delay = ctx.createDelay(1);
    const feedback = ctx.createGain();
    delay.delayTime.value = DELAY_SEC;
    feedback.gain.value = DELAY_FEEDBACK;
    this.input.connect(out);
    this.input.connect(delay).connect(feedback).connect(delay);
    feedback.connect(out);
  }

  /**
   * Keeps the music playing for system `number` of the run seeded `seed`, in
   * that system's variant of the `starClass` mood, easing toward `intensity`.
   * A new system crossfades to a fresh layer. `audible` false (music muted)
   * skips scheduling notes but keeps time.
   */
  update(starClass: StarClass, seed: number, number: number, audible: boolean, intensity = CALM): void {
    const now = this.ctx.currentTime;
    this.ease(intensity, now);
    let cur = this.current;
    if (!cur || cur.seed !== seed || cur.number !== number) {
      if (cur) this.fadeOut(cur, now);
      cur = this.current = this.makeLayer(systemMood(starClass, seed, number), seed, number, now);
    }
    this.schedule(cur, now, audible);
    for (const l of this.fading) this.schedule(l, now, audible);
    this.fading = this.fading.filter((l) => {
      if (now < l.endAt! + PAD_RELEASE) return true;
      l.gain.disconnect();
      l.filter.disconnect();
      return false;
    });
  }

  /** Moves the smoothed intensity toward `target` and lets each layer's filter follow it. */
  private ease(target: MusicIntensity, now: number): void {
    const dt = this.lastAt == null ? 0 : Math.max(0, now - this.lastAt);
    this.lastAt = now;
    const k = 1 - Math.exp(-dt / INTENSITY_TAU);
    this.level.danger += (target.danger - this.level.danger) * k;
    this.level.activity += (target.activity - this.level.activity) * k;
    for (const l of [this.current, ...this.fading]) {
      if (!l) continue;
      const cutoff = layerCutoff(l.mood, this.level);
      if (Math.abs(cutoff - l.cutoff) < 1) continue;
      l.cutoff = cutoff;
      l.filter.frequency.setTargetAtTime(cutoff, now, 0.1);
    }
  }

  private makeLayer(mood: Mood, seed: number, number: number, now: number): Layer {
    const gain = this.ctx.createGain();
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    const cutoff = layerCutoff(mood, this.level);
    filter.frequency.value = cutoff;
    filter.Q.value = 0.5;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(1, now + FADE);
    gain.connect(filter).connect(this.input);
    return { seed, number, mood, gain, filter, bar: 0, step: 0, nextAt: now + 0.05, endAt: null, cutoff };
  }

  private fadeOut(l: Layer, now: number): void {
    l.gain.gain.cancelScheduledValues(now);
    l.gain.gain.setValueAtTime(l.gain.gain.value, now);
    l.gain.gain.linearRampToValueAtTime(0, now + FADE);
    l.endAt = now + FADE;
    this.fading.push(l);
  }

  /** Schedules every step that falls inside the lookahead window. */
  private schedule(l: Layer, now: number, audible: boolean): void {
    // Context was suspended (hidden tab, lock): skip the missed steps instead of bursting them.
    if (l.nextAt < now - 0.1) l.nextAt = now + 0.05;
    const { mood } = l;
    const density = arpDensity(mood, this.level);
    const { danger } = this.level;
    while (l.nextAt < now + LOOKAHEAD && (l.endAt == null || l.nextAt < l.endAt)) {
      if (audible) {
        if (l.step === 0) this.pad(l, chordAt(mood, l.bar), l.nextAt, mood.barSteps * mood.stepSec);
        const f = arpNote(mood, l.bar, l.step, this.rand, density);
        if (f != null) this.arp(l, f, l.nextAt);
        // Only the current layer pulses: two keys' sub-bass beating against each other through a crossfade clashes.
        const pulse = l.endAt == null ? pulseNote(mood, l.bar, l.step, danger) : null;
        if (pulse != null) this.voice(l, 'sine', pulse, 0, l.nextAt, PULSE_GAIN * danger, 0.02, 0.1, PULSE_RELEASE);
      }
      l.nextAt += mood.stepSec;
      if (++l.step >= mood.barSteps) {
        l.step = 0;
        l.bar++;
      }
    }
  }

  /** One detuned voice per chord tone, swelling in and overlapping the next bar's release. */
  private pad(l: Layer, freqs: number[], at: number, len: number): void {
    freqs.forEach((f, i) => {
      const cents = (i - 1) * l.mood.detune;
      this.voice(l, l.mood.padWave, f, cents, at, PAD_GAIN, PAD_ATTACK, len, PAD_RELEASE);
    });
  }

  private arp(l: Layer, freq: number, at: number): void {
    this.voice(l, l.mood.arpWave, freq, 0, at, ARP_GAIN, 0.01, 0.05, ARP_RELEASE);
  }

  /** A single oscillator note with an attack/hold/release envelope; cleans itself up when done. */
  private voice(
    l: Layer,
    type: OscillatorType,
    freq: number,
    cents: number,
    at: number,
    peak: number,
    attack: number,
    hold: number,
    release: number,
  ): void {
    const osc = this.ctx.createOscillator();
    const env = this.ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    osc.detune.value = cents;
    env.gain.setValueAtTime(0, at);
    env.gain.linearRampToValueAtTime(peak, at + attack);
    env.gain.setValueAtTime(peak, at + Math.max(attack, hold));
    env.gain.linearRampToValueAtTime(0, at + Math.max(attack, hold) + release);
    osc.connect(env).connect(l.gain);
    osc.start(at);
    osc.stop(at + Math.max(attack, hold) + release + 0.05);
    osc.addEventListener(
      'ended',
      () => {
        osc.disconnect();
        env.disconnect();
      },
      { once: true },
    );
  }
}
