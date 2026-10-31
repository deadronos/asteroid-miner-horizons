import { describe, expect, it } from 'vitest';
import { dist } from '../src/core/vec';
import { ANOMALY_INFO, ANOMALY_KINDS, DERELICT_SALVAGE } from '../src/data/exploration';
import { TUNING } from '../src/data/tuning';
import { newProfile, newRun, SAVE_VERSION } from '../src/sim/create';
import { explorationSeed, newExploration, rollAnomalies } from '../src/sim/exploration';
import { generateSystem } from '../src/sim/generate';
import { migrate, migrations, type SaveData } from '../src/sim/migrations';
import { deserialize, serialize } from '../src/sim/save';
import V15_FIXTURE from './fixtures/save-v15.json?raw';
import V16_FIXTURE from './fixtures/save-v16.json?raw';

const systemFor = (seed = 4242, number = 1, route = 0) => generateSystem(seed, number, route);

const v15State = (): SaveData => JSON.parse(V15_FIXTURE).state as SaveData;

/** The v15 fixture after its v16 migration, which every validator case starts from. */
const current = (): SaveData => {
  const state = migrate(v15State());
  if (!state) throw new Error('expected the v15 fixture to migrate');
  return state;
};

/** JSON for a current save whose run carries `exploration`. */
const saveWith = (exploration: unknown): string => {
  const state = current();
  return JSON.stringify({ ...state, run: { ...state.run, exploration } });
};

describe('rollAnomalies', () => {
  it('is deterministic for the same seed and system', () => {
    const system = systemFor(4242, 2);
    expect(rollAnomalies(1234, system)).toEqual(rollAnomalies(1234, system));
  });

  it('changes when the seed changes', () => {
    const system = systemFor(4242, 2);
    expect(rollAnomalies(1, system)).not.toEqual(rollAnomalies(2, system));
  });

  it('rolls the configured number of rich deposits and derelicts', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const anomalies = rollAnomalies(seed, systemFor(4242, (seed % 4) + 1));
      const rich = anomalies.filter((a) => a.kind === 'rich');
      const derelict = anomalies.filter((a) => a.kind === 'derelict');
      expect(rich.length).toBeGreaterThanOrEqual(TUNING.richAnomalies[0]);
      expect(rich.length).toBeLessThanOrEqual(TUNING.richAnomalies[1]);
      expect(derelict.length).toBeGreaterThanOrEqual(TUNING.derelictAnomalies[0]);
      expect(derelict.length).toBeLessThanOrEqual(TUNING.derelictAnomalies[1]);
      // Ids are the indices in the generated list.
      expect(anomalies.map((a) => a.id)).toEqual(anomalies.map((_, i) => i));
    }
  });

  it('places every anomaly inside a belt and clear of the station', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const system = systemFor(4242, (seed % 4) + 1);
      for (const anomaly of rollAnomalies(seed, system)) {
        const radius = Math.hypot(anomaly.pos.x, anomaly.pos.z);
        expect(
          system.belts.some((b) => radius >= b.inner && radius <= b.outer),
          `seed ${seed}`,
        ).toBe(true);
        expect(dist(anomaly.pos, system.station.pos)).toBeGreaterThanOrEqual(TUNING.dockRadius * 2);
      }
    }
  });

  it('gives rich deposits a raw resource and derelicts a salvage entry', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const anomalies = rollAnomalies(seed, systemFor(4242, 2));
      for (const anomaly of anomalies) expect(ANOMALY_KINDS).toContain(anomaly.kind);
      const resources = anomalies.flatMap((a) => (a.kind === 'rich' ? [a.resource] : []));
      const salvages = anomalies.flatMap((a) => (a.kind === 'derelict' ? [a.salvage] : []));
      expect(resources.length).toBeGreaterThan(0);
      expect(resources.every((r) => ['ore', 'ice', 'crystal'].includes(r))).toBe(true);
      expect(salvages.every((s) => Number.isInteger(s) && s >= 0 && s < DERELICT_SALVAGE.length)).toBe(true);
    }
  });

  it('labels every kind with a short non-colour glyph', () => {
    for (const kind of ANOMALY_KINDS) {
      expect(ANOMALY_INFO[kind].label.length).toBeGreaterThan(0);
      expect(ANOMALY_INFO[kind].glyph.length).toBeGreaterThan(0);
      expect(ANOMALY_INFO[kind].glyph).not.toMatch(/#|rgb|hsl|color/i);
    }
  });
});

describe('newExploration', () => {
  it('derives the seed from the profile seed, system number and warp route', () => {
    const profile = { ...newProfile(4242), warps: 1 };
    expect(newRun(profile, 2).exploration).toEqual({
      seed: explorationSeed(4242, 2, 2),
      pingCd: 0,
      revealed: [],
      claimed: [],
    });
  });

  it('gives each warp route its own anomaly seed', () => {
    const profile = { ...newProfile(4242), warps: 1 };
    expect(newRun(profile, 1).exploration.seed).not.toBe(newRun(profile, 2).exploration.seed);
  });

  it('rolls anomalies from its own stream, not run.rng', () => {
    const run = newRun(newProfile(4242));
    const state = run.rng.s;
    rollAnomalies(run.exploration.seed, run.system);
    expect(run.rng.s).toBe(state);
  });
});

describe('exploration migration to v16', () => {
  it('adds an empty exploration seeded from the saved profile and system', () => {
    const state = current();
    expect(state.version).toBe(SAVE_VERSION);
    expect(state.version).toBe(16);
    expect(state.run.exploration).toEqual(newExploration(state.profile.seed, state.run.system.number));
    expect(state.run.exploration.revealed).toEqual([]);
    expect(state.run.exploration.claimed).toEqual([]);
  });

  it('is idempotent', () => {
    const once = migrations[15]!(v15State());
    const twice = migrations[15]!(JSON.parse(JSON.stringify(once)));
    expect(twice).toEqual(once);

    const revealed = { ...once.run.exploration, pingCd: 7, revealed: [1] };
    once.run.exploration = revealed;
    const again = migrations[15]!(JSON.parse(JSON.stringify(once)));
    expect(again.run.exploration).toEqual(revealed);
  });
});

describe('exploration validation', () => {
  it('accepts a v16 save with revealed and claimed ids', () => {
    const exploration = { ...current().run.exploration, pingCd: 3, revealed: [0, 2], claimed: [1] };
    const state = deserialize(saveWith(exploration));
    expect(state?.run.exploration).toEqual(exploration);
  });

  it('rejects a v16 save without exploration', () => {
    const state = current();
    const { exploration: _omit, ...run } = state.run;
    expect(deserialize(JSON.stringify({ ...state, run }))).toBeNull();
  });

  it('rejects malformed exploration', () => {
    const good = current().run.exploration;
    const bad: unknown[] = [
      null,
      'explored',
      [],
      { ...good, seed: undefined },
      { ...good, seed: 'x' },
      { ...good, seed: null },
      { ...good, pingCd: undefined },
      { ...good, pingCd: 'soon' },
      { ...good, pingCd: null },
      { ...good, revealed: undefined },
      { ...good, revealed: 'none' },
      { ...good, revealed: [-1] },
      { ...good, revealed: [1.5] },
      { ...good, revealed: [1, 1] },
      { ...good, revealed: ['1'] },
      { ...good, claimed: undefined },
      { ...good, claimed: [0, 0] },
      { ...good, claimed: [-2] },
      { ...good, claimed: [null] },
    ];
    expect(deserialize(saveWith(good))).not.toBeNull();
    for (const exploration of bad) expect(deserialize(saveWith(exploration))).toBeNull();
  });

  it('rejects non-finite exploration numbers that survive JSON.parse', () => {
    const text = saveWith(current().run.exploration);
    for (const field of ['"seed":4242', '"pingCd":0']) {
      expect(text).toContain(field);
      const broken = text.replace(field, field.replace(/:.*/, ':1e999'));
      expect(deserialize(broken)).toBeNull();
    }
  });
});

describe('frozen v16 fixture', () => {
  it('loads, keeps its exploration and round-trips through save', () => {
    const frozen = JSON.parse(V16_FIXTURE).state as SaveData;
    expect(frozen.version).toBe(16);
    expect(frozen.run.exploration).toEqual(newExploration(frozen.profile.seed, frozen.run.system.number));

    const state = deserialize(JSON.stringify(frozen));
    if (!state) throw new Error('expected the v16 fixture to load');
    expect(state.version).toBe(SAVE_VERSION);
    expect(state.run.exploration).toEqual(frozen.run.exploration);
    const again = deserialize(serialize(state));
    expect(again && serialize(again)).toBe(serialize(state));
  });
});
