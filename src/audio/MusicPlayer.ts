// Plays the generative ambient music from `music.ts` into the mixer's music
// bus. One layer per star system: each layer schedules its pad and arpeggio
// notes a short lookahead ahead of the clock, and a warp crossfades from the
// old layer to a new one. Cost stays tiny: a few short-lived oscillators per
// second, one lowpass per layer and one shared feedback delay for space.

import type { StarClass } from '../sim/types';
import { arpNote, chordAt, type Mood, MOODS } from './music';

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
/** Echo time and feedback of the shared delay. */
const DELAY_SEC = 0.42;
const DELAY_FEEDBACK = 0.35;

interface Layer {
  key: number;
  mood: Mood;
  gain: GainNode;
  filter: BiquadFilterNode;
  bar: number;
  step: number;
  /** Context time of the next step to schedule. */
  nextAt: number;
  /** Set once the layer is fading out: the time it is silent and can be dropped. */
  endAt: number | null;
}

export class MusicPlayer {
  private readonly input: GainNode;
  private current: Layer | null = null;
  private fading: Layer[] = [];

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
   * Keeps the music playing for the system identified by `key` (its number), in
   * the mood of `starClass`. A new key crossfades to a fresh layer. `audible`
   * false (music muted) skips scheduling notes but keeps time.
   */
  update(starClass: StarClass, key: number, audible: boolean): void {
    const now = this.ctx.currentTime;
    if (this.current?.key !== key) {
      if (this.current) this.fadeOut(this.current, now);
      this.current = this.makeLayer(MOODS[starClass], key, now);
    }
    this.schedule(this.current, now, audible);
    for (const l of this.fading) this.schedule(l, now, audible);
    this.fading = this.fading.filter((l) => {
      if (now < l.endAt! + PAD_RELEASE) return true;
      l.gain.disconnect();
      l.filter.disconnect();
      return false;
    });
  }

  private makeLayer(mood: Mood, key: number, now: number): Layer {
    const gain = this.ctx.createGain();
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = mood.cutoff;
    filter.Q.value = 0.5;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(1, now + FADE);
    gain.connect(filter).connect(this.input);
    return { key, mood, gain, filter, bar: 0, step: 0, nextAt: now + 0.05, endAt: null };
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
    while (l.nextAt < now + LOOKAHEAD && (l.endAt == null || l.nextAt < l.endAt)) {
      if (audible) {
        if (l.step === 0) this.pad(l, chordAt(mood, l.bar), l.nextAt, mood.barSteps * mood.stepSec);
        const f = arpNote(mood, l.bar, l.step, this.rand);
        if (f != null) this.arp(l, f, l.nextAt);
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
