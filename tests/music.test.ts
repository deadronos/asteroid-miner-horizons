import { describe, expect, it } from 'vitest';
import { arpNote, chordAt, degreeFreq, MOODS } from '../src/audio/music';
import { MusicPlayer } from '../src/audio/MusicPlayer';
import type { StarClass } from '../src/sim/types';

const CLASSES: StarClass[] = ['M', 'G', 'B'];

/** What makes a mood sound different: scale, timbre and tempo. */
function signature(c: StarClass): string {
  const m = MOODS[c];
  return JSON.stringify([m.scale, m.padWave, m.arpWave, m.cutoff, m.stepSec]);
}

describe('music moods', () => {
  it('gives each star class its own scale, timbre and tempo', () => {
    expect(new Set(CLASSES.map(signature)).size).toBe(3);
  });

  it('runs warm to cold: M darkest and slowest, B brightest and highest', () => {
    expect(MOODS.M.cutoff).toBeLessThan(MOODS.G.cutoff);
    expect(MOODS.G.cutoff).toBeLessThan(MOODS.B.cutoff);
    expect(MOODS.M.stepSec).toBeGreaterThan(MOODS.B.stepSec);
    expect(MOODS.M.root).toBeLessThan(MOODS.B.root);
  });

  it('wraps scale degrees into octaves', () => {
    const m = MOODS.G;
    expect(degreeFreq(m, 0)).toBeCloseTo(m.root);
    expect(degreeFreq(m, m.scale.length)).toBeCloseTo(m.root * 2);
    expect(degreeFreq(m, -m.scale.length)).toBeCloseTo(m.root / 2);
    expect(degreeFreq(m, 0, 1)).toBeCloseTo(m.root * 2);
  });

  for (const c of CLASSES) {
    it(`${c}: pad chords are three rising, audible tones`, () => {
      for (let bar = 0; bar < 8; bar++) {
        const [a, b, d] = chordAt(MOODS[c], bar);
        expect(a).toBeLessThan(b!);
        expect(b).toBeLessThan(d!);
        expect(a).toBeGreaterThan(40);
        expect(d).toBeLessThan(2000);
      }
    });
  }

  it('always sounds the downbeat, rests per density, and stays in the arp octave', () => {
    const m = MOODS.B;
    expect(arpNote(m, 0, 0, () => 0.99)).toBeCloseTo(degreeFreq(m, m.progression[0]!, m.arpOctave));
    expect(arpNote(m, 0, 3, () => 0.99)).toBeNull();
    const f = arpNote(m, 1, 3, () => 0)!;
    expect(f).toBeGreaterThanOrEqual(m.root * 2 ** m.arpOctave);
  });
});

/** A minimal stand-in for the Web Audio graph: records oscillators and gain automation. */
class FakeCtx {
  currentTime = 0;
  oscillators: { freq: number; startAt: number }[] = [];
  private param() {
    const p = {
      value: 0,
      ramps: [] as number[],
      setValueAtTime: (v: number) => void (p.value = v),
      linearRampToValueAtTime: (v: number) => void p.ramps.push(v),
      cancelScheduledValues: () => {},
      setTargetAtTime: () => {},
    };
    return p;
  }
  private node() {
    return { connect: (n: unknown) => n, disconnect: () => {} };
  }
  createGain() {
    return { ...this.node(), gain: this.param() };
  }
  createDelay() {
    return { ...this.node(), delayTime: this.param() };
  }
  createBiquadFilter() {
    return { ...this.node(), type: '', frequency: this.param(), Q: this.param() };
  }
  createOscillator() {
    const osc = {
      ...this.node(),
      type: '',
      frequency: this.param(),
      detune: this.param(),
      start: (at: number) => this.oscillators.push({ freq: osc.frequency.value, startAt: at }),
      stop: () => {},
      addEventListener: () => {},
    };
    return osc;
  }
}

/** Steps the fake clock at 60 fps for `sec` seconds, updating the player each frame. */
function run(ctx: FakeCtx, player: MusicPlayer, c: StarClass, key: number, sec: number, audible = true) {
  const end = ctx.currentTime + sec;
  while (ctx.currentTime < end) {
    player.update(c, key, audible);
    ctx.currentTime += 1 / 60;
  }
}

function setup(rand = () => 0.5) {
  const ctx = new FakeCtx();
  const out = ctx.createGain();
  const player = new MusicPlayer(ctx as unknown as AudioContext, out as unknown as AudioNode, rand);
  return { ctx, player };
}

describe('music player', () => {
  it('keeps CPU cost negligible: only a handful of oscillators per second', () => {
    for (const c of CLASSES) {
      const { ctx, player } = setup(() => 0); // rand 0: every arp step sounds (worst case)
      run(ctx, player, c, 1, 60);
      expect(ctx.oscillators.length / 60).toBeLessThan(5);
      expect(ctx.oscillators.length).toBeGreaterThan(0);
    }
  });

  it('never schedules notes in the past or far ahead of the clock', () => {
    const { ctx, player } = setup();
    for (let i = 0; i < 600; i++) {
      const before = ctx.oscillators.length;
      player.update('G', 1, true);
      for (const o of ctx.oscillators.slice(before)) {
        expect(o.startAt).toBeGreaterThanOrEqual(ctx.currentTime);
        expect(o.startAt).toBeLessThan(ctx.currentTime + 0.5);
      }
      ctx.currentTime += 1 / 60;
    }
  });

  it('skips missed steps after the context was suspended instead of bursting them', () => {
    const { ctx, player } = setup(() => 0);
    run(ctx, player, 'B', 1, 2);
    const before = ctx.oscillators.length;
    ctx.currentTime += 30;
    player.update('B', 1, true);
    expect(ctx.oscillators.length - before).toBeLessThan(5);
  });

  it('plays in the new mood after a warp to another star class', () => {
    const { ctx, player } = setup(() => 0.99); // only downbeats + pads
    run(ctx, player, 'M', 1, 1);
    const n = ctx.oscillators.length;
    run(ctx, player, 'B', 2, 1);
    const fresh = ctx.oscillators.slice(n).map((o) => o.freq);
    const bChord = chordAt(MOODS.B, 0);
    for (const f of bChord) expect(fresh.some((x) => Math.abs(x - f) < 0.01)).toBe(true);
  });

  it('schedules nothing while muted', () => {
    const { ctx, player } = setup(() => 0);
    run(ctx, player, 'G', 1, 10, false);
    expect(ctx.oscillators).toHaveLength(0);
  });
});
