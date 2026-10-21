import { describe, expect, it } from 'vitest';
import {
  arpDensity,
  arpNote,
  CALM,
  chordAt,
  degreeFreq,
  layerCutoff,
  MOODS,
  musicIntensity,
  type MusicIntensity,
  pulseNote,
  systemMood,
} from '../src/audio/music';
import { MusicPlayer } from '../src/audio/MusicPlayer';
import { newGame } from '../src/sim/create';
import type { CometWarning, StarClass } from '../src/sim/types';

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

  it('rests or sounds an off-beat step by the density it is given', () => {
    const m = MOODS.G;
    expect(arpNote(m, 0, 3, () => 0.5, 0.4)).toBeNull();
    expect(arpNote(m, 0, 3, () => 0.5, 0.6)).not.toBeNull();
  });
});

/** What a player hears as a different tune: key, chord order and arpeggio timbre. */
function tune(m: ReturnType<typeof systemMood>): string {
  return JSON.stringify([m.root.toFixed(3), m.progression, m.arpWave]);
}

/** Roots of the first 30 systems of class `c` in the run seeded 7. */
function roots(c: StarClass): number[] {
  return Array.from({ length: 30 }, (_, i) => systemMood(c, 7, i + 1).root);
}

describe('system moods', () => {
  const SEEDS = [1, 42, 0xdeadbeef, 123456789];

  for (const c of CLASSES) {
    it(`${c}: systems are related (same scale, pace, pad, opening chord) but never identical within a run`, () => {
      const base = MOODS[c];
      for (const seed of SEEDS) {
        const moods = Array.from({ length: 30 }, (_, i) => systemMood(c, seed, i + 1));
        expect(new Set(moods.map(tune)).size).toBe(moods.length);
        for (const m of moods) {
          expect(m.scale).toEqual(base.scale);
          expect([m.stepSec, m.barSteps, m.cutoff, m.padWave, m.density]).toEqual([
            base.stepSec,
            base.barSteps,
            base.cutoff,
            base.padWave,
            base.density,
          ]);
          expect(m.progression[0]).toBe(base.progression[0]);
          expect(m.progression).toHaveLength(base.progression.length);
          expect(m.progression).toEqual(expect.arrayContaining([...base.progression]));
          const semis = 12 * Math.log2(m.root / base.root);
          expect(Math.abs(semis)).toBeLessThanOrEqual(2 + 1e-9);
        }
      }
    });
  }

  it('is deterministic from the seed and differs between seeds', () => {
    expect(systemMood('G', 42, 3)).toEqual(systemMood('G', 42, 3));
    const a = Array.from({ length: 10 }, (_, i) => tune(systemMood('G', 1, i + 1)));
    const b = Array.from({ length: 10 }, (_, i) => tune(systemMood('G', 2, i + 1)));
    expect(a).not.toEqual(b);
  });

  it('keeps the warm-to-cold order whatever the transposition', () => {
    expect(Math.max(...roots('M'))).toBeLessThan(Math.min(...roots('B')));
  });
});

describe('music intensity', () => {
  it('is calm in a fresh game', () => {
    expect(musicIntensity(newGame(5).run)).toEqual(CALM);
  });

  it('keeps comet danger up while the comet is in flight, not just during its warning', () => {
    const { run: r } = newGame(5);
    r.rocks[0]!.comet = true;
    expect(musicIntensity(r).danger).toBeCloseTo(0.6);
  });

  it('reads danger from a flare (warning or burning) over a comet warning', () => {
    const { run: r } = newGame(5);
    r.hazards.comet = { timeLeft: 5 } as CometWarning;
    expect(musicIntensity(r).danger).toBeCloseTo(0.6);
    r.hazards.flare = { phase: 'warning', timeLeft: 5 };
    expect(musicIntensity(r).danger).toBe(1);
    r.hazards.comet = null;
    r.hazards.flare = { phase: 'active', timeLeft: 5 };
    expect(musicIntensity(r).danger).toBe(1);
  });

  it('reads activity from live mining beams, saturating at full', () => {
    const { run: r } = newGame(5);
    r.ships[0]!.beamOn = true;
    const one = musicIntensity(r).activity;
    expect(one).toBeGreaterThan(0);
    expect(one).toBeLessThan(1);
    for (let i = 0; i < 4; i++) r.ships.push({ ...r.ships[0]!, id: 900 + i });
    expect(musicIntensity(r).activity).toBe(1);
    for (const s of r.ships) s.respawn = 10;
    expect(musicIntensity(r).activity).toBe(0);
  });

  it('busies the arpeggio while mining and thins and darkens it under danger', () => {
    const m = MOODS.G;
    const busy = { danger: 0, activity: 1 };
    const tense = { danger: 1, activity: 0 };
    expect(arpDensity(m, CALM)).toBeCloseTo(m.density);
    expect(arpDensity(m, busy)).toBeGreaterThan(m.density);
    expect(arpDensity(m, tense)).toBeLessThan(m.density);
    expect(layerCutoff(m, CALM)).toBe(m.cutoff);
    expect(layerCutoff(m, tense)).toBeLessThan(m.cutoff);
  });

  it('pulses the chord root below the pad on each quarter bar, only under danger', () => {
    const m = MOODS.M;
    const q = m.barSteps / 4;
    expect(pulseNote(m, 0, 0, 0)).toBeNull();
    expect(pulseNote(m, 0, 1, 1)).toBeNull();
    for (let i = 0; i < 4; i++) expect(pulseNote(m, 1, i * q, 1)).toBeCloseTo(chordAt(m, 1)[0]! / 2);
  });
});

/** A minimal stand-in for the Web Audio graph: records oscillators and gain automation. */
class FakeCtx {
  currentTime = 0;
  oscillators: { freq: number; startAt: number }[] = [];
  filters: { frequency: { value: number; targets: number[] } }[] = [];
  private param() {
    const p = {
      value: 0,
      ramps: [] as number[],
      targets: [] as number[],
      setValueAtTime: (v: number) => void (p.value = v),
      linearRampToValueAtTime: (v: number) => void p.ramps.push(v),
      cancelScheduledValues: () => {},
      setTargetAtTime: (v: number) => void p.targets.push(v),
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
    const f = { ...this.node(), type: '', frequency: this.param(), Q: this.param() };
    this.filters.push(f);
    return f;
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

const SEED = 42;

/** Oscillators started over 30 s of G music at `intensity`. */
function notesAt(intensity: MusicIntensity): number {
  const { ctx, player } = setup(() => 0.5);
  run(ctx, player, 'G', 1, 30, true, intensity);
  return ctx.oscillators.length;
}

/** Steps the fake clock at 60 fps for `sec` seconds, updating the player each frame. */
function run(
  ctx: FakeCtx,
  player: MusicPlayer,
  c: StarClass,
  key: number,
  sec: number,
  audible = true,
  intensity: MusicIntensity = CALM,
) {
  const end = ctx.currentTime + sec;
  while (ctx.currentTime < end) {
    player.update(c, SEED, key, audible, intensity);
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
      // rand 0: every arp step sounds, plus the danger pulse (worst case)
      const { ctx, player } = setup(() => 0);
      run(ctx, player, c, 1, 60, true, { danger: 1, activity: 1 });
      expect(ctx.oscillators.length / 60).toBeLessThan(5);
      expect(ctx.oscillators.length).toBeGreaterThan(0);
    }
  });

  it('never schedules notes in the past or far ahead of the clock', () => {
    const { ctx, player } = setup();
    for (let i = 0; i < 600; i++) {
      const before = ctx.oscillators.length;
      player.update('G', SEED, 1, true);
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
    player.update('B', SEED, 1, true);
    expect(ctx.oscillators.length - before).toBeLessThan(5);
  });

  it('plays in the new mood after a warp to another star class', () => {
    const { ctx, player } = setup(() => 0.99); // only downbeats + pads
    run(ctx, player, 'M', 1, 1);
    const n = ctx.oscillators.length;
    run(ctx, player, 'B', 2, 1);
    const fresh = ctx.oscillators.slice(n).map((o) => o.freq);
    const bChord = chordAt(systemMood('B', SEED, 2), 0);
    for (const f of bChord) expect(fresh.some((x) => Math.abs(x - f) < 0.01)).toBe(true);
  });

  it('schedules nothing while muted', () => {
    const { ctx, player } = setup(() => 0);
    run(ctx, player, 'G', 1, 10, false);
    run(ctx, player, 'G', 1, 10, false, { danger: 1, activity: 1 });
    expect(ctx.oscillators).toHaveLength(0);
  });

  it('crossfades to a fresh layer when a new game starts in the same system number', () => {
    const { ctx, player } = setup();
    player.update('G', 1, 1, true);
    player.update('G', 2, 1, true);
    expect(ctx.filters).toHaveLength(2);
  });

  it('adds a low danger pulse under the pad only while in danger', () => {
    const { ctx, player } = setup(() => 0.99); // only downbeats, pads and pulses
    const low = systemMood('M', SEED, 1).root;
    run(ctx, player, 'M', 1, 20);
    expect(ctx.oscillators.some((o) => o.freq < low - 0.01)).toBe(false);
    run(ctx, player, 'M', 1, 20, true, { danger: 1, activity: 0 });
    expect(ctx.oscillators.some((o) => o.freq < low - 0.01)).toBe(true);
  });

  it('plays a busier arpeggio while the fleet mines', () => {
    expect(notesAt({ danger: 0, activity: 1 })).toBeGreaterThan(notesAt(CALM));
  });

  it('eases the filter into and out of danger instead of jumping, and carries it across a warp', () => {
    const { ctx, player } = setup();
    const tense = { danger: 1, activity: 0 };
    run(ctx, player, 'M', 1, 2);
    run(ctx, player, 'M', 1, 10, true, tense);
    run(ctx, player, 'M', 1, 10);
    const cutoff = systemMood('M', SEED, 1).cutoff;
    const t = ctx.filters[0]!.frequency.targets;
    for (let i = 1; i < t.length; i++) expect(Math.abs(t[i]! - t[i - 1]!)).toBeLessThan(0.01 * cutoff);
    expect(Math.min(...t)).toBeLessThan(0.65 * cutoff);
    expect(t.at(-1)).toBeGreaterThan(0.98 * cutoff);

    // Warp out of a flare: the new layer starts as dark as the music is now, then brightens.
    run(ctx, player, 'M', 1, 10, true, tense);
    run(ctx, player, 'G', 2, 0.1);
    const next = ctx.filters[1]!.frequency;
    const gCutoff = systemMood('G', SEED, 2).cutoff;
    expect(next.value).toBeLessThan(0.65 * gCutoff);
    run(ctx, player, 'G', 2, 10);
    expect(next.targets.at(-1)).toBeGreaterThan(0.98 * gCutoff);
  });
});
