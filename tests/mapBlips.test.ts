import { describe, expect, it } from 'vitest';
import { RAW_RESOURCES } from '../src/data/resources';
import { BLIP_GLYPH, type Blip, beltLabel, collectBlips, dominantResource } from '../src/render/mapBlips';
import { newGame } from '../src/sim/create';
import { anomalies } from '../src/sim/exploration';
import { generateSystem } from '../src/sim/generate';
import type { Belt } from '../src/sim/types';

const belt = (ore: number, ice: number, crystal: number): Belt => ({
  inner: 100,
  outer: 200,
  mix: { ore, ice, crystal },
  initialCount: 10,
});

describe('dominant resource', () => {
  it('picks the largest share and breaks ties toward the earlier kind', () => {
    expect(dominantResource(belt(0.2, 0.7, 0.1))).toBe('ice');
    expect(dominantResource(belt(0.1, 0.2, 0.7))).toBe('crystal');
    expect(dominantResource(belt(0.5, 0.5, 0))).toBe('ore');
  });

  it('is a raw resource for every generated belt', () => {
    for (let n = 1; n <= 6; n++) {
      for (const b of generateSystem(7, n).belts) expect(RAW_RESOURCES).toContain(dominantResource(b));
    }
  });

  it('labels belts by letter with the resource icon', () => {
    expect(beltLabel(belt(0.2, 0.7, 0.1), 0)).toBe('Belt A ❄');
    expect(beltLabel(belt(0.9, 0.1, 0), 1)).toBe('Belt B ⬢');
  });
});

describe('collectBlips', () => {
  it('marks the selected ship apart from the rest of the fleet', () => {
    const { run } = newGame(5);
    const out: Blip[] = [];
    const n = collectBlips(run, out);
    expect(n).toBe(run.ships.length);
    expect(
      out
        .slice(0, n)
        .map((b) => b.kind)
        .filter((k) => k === 'selected'),
    ).toHaveLength(1);
  });

  it('skips dead ships and adds outposts', () => {
    const { run } = newGame(5);
    const out: Blip[] = [];
    const before = collectBlips(run, out);
    run.ships[0]!.respawn = 5;
    expect(collectBlips(run, out)).toBe(before - 1);
    run.automation.outposts.push({
      rockId: 1,
      kind: 'ore',
      pos: { x: 30, z: 40 },
      stored: { ore: 0, ice: 0, crystal: 0, alloy: 0, fuel: 0 },
      reserve: 10,
    });
    const n = collectBlips(run, out);
    expect(out[n - 1]).toEqual({ kind: 'outpost', x: 30, z: 40 });
  });

  it('marks a warned comet at its entry point and a flare at the star', () => {
    const { run } = newGame(5);
    const out: Blip[] = [];
    const base = collectBlips(run, out);
    run.hazards.comet = { from: { x: 9, z: -9 }, vel: { x: 1, z: 1 }, belt: 0, timeLeft: 3 };
    run.hazards.flare = { phase: 'warning', timeLeft: 3 };
    const n = collectBlips(run, out);
    expect(n).toBe(base + 2);
    expect(out.slice(base, n)).toEqual([
      { kind: 'comet', x: 9, z: -9 },
      { kind: 'flare', x: 0, z: 0 },
    ]);
  });

  it('marks revealed anomalies with their glyph and drops claimed derelicts', () => {
    const { run } = newGame(5);
    const out: Blip[] = [];
    const base = collectBlips(run, out);
    const derelict = anomalies(run).find((a) => a.kind === 'derelict')!;
    run.exploration.revealed.push(derelict.id);
    expect(collectBlips(run, out)).toBe(base + 1);
    expect(out[base]).toEqual({ kind: 'derelict', x: derelict.pos.x, z: derelict.pos.z });
    expect(BLIP_GLYPH.derelict).toBe('⌖');
    run.exploration.claimed.push(derelict.id);
    expect(collectBlips(run, out)).toBe(base);
  });

  it('reuses blip objects between calls', () => {
    const { run } = newGame(5);
    const out: Blip[] = [];
    collectBlips(run, out);
    const first = out[0];
    collectBlips(run, out);
    expect(out[0]).toBe(first);
  });
});
