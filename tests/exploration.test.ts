import { describe, expect, it } from 'vitest';
import { dist } from '../src/core/vec';
import { defaultVariant } from '../src/data/components';
import { ANOMALY_INFO, ANOMALY_KINDS, DERELICT_SALVAGE } from '../src/data/exploration';
import { emptyWallet, RESOURCES, walletValue } from '../src/data/resources';
import { TUNING } from '../src/data/tuning';
import { newGame, newProfile, newRun, SAVE_VERSION } from '../src/sim/create';
import {
  anomalies as systemAnomalies,
  explorationSeed,
  isClaimed,
  isRevealed,
  newExploration,
  pingReady,
  rollAnomalies,
} from '../src/sim/exploration';
import { generateSystem } from '../src/sim/generate';
import { migrate, migrations, type SaveData } from '../src/sim/migrations';
import { deserialize, serialize } from '../src/sim/save';
import { flagship } from '../src/sim/ships';
import V15_FIXTURE from './fixtures/save-v15.json?raw';
import V17_FIXTURE from './fixtures/save-v17.json?raw';
import { bankDelta, runFor, runTicks, send } from './helpers';

const systemFor = (seed = 4242, number = 1, route = 0) => generateSystem(seed, number, route);

const v15State = (): SaveData => JSON.parse(V15_FIXTURE).state as SaveData;

/** The v15 fixture after its v17 migration, which every validator case starts from. */
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

describe('exploration migration to v17', () => {
  it('adds an empty exploration seeded from the saved profile and system', () => {
    const state = current();
    expect(state.version).toBe(SAVE_VERSION);
    expect(state.version).toBe(17);
    expect(state.run.exploration).toEqual(newExploration(state.profile.seed, state.run.system.number));
    expect(state.run.exploration.revealed).toEqual([]);
    expect(state.run.exploration.claimed).toEqual([]);
  });

  it('is idempotent', () => {
    const once = migrations[16]!(v15State());
    const twice = migrations[16]!(JSON.parse(JSON.stringify(once)));
    expect(twice).toEqual(once);

    const revealed = { ...once.run.exploration, pingCd: 7, revealed: [1] };
    once.run.exploration = revealed;
    const again = migrations[16]!(JSON.parse(JSON.stringify(once)));
    expect(again.run.exploration).toEqual(revealed);
  });
});

describe('exploration validation', () => {
  it('accepts a v17 save with revealed and claimed ids', () => {
    const exploration = { ...current().run.exploration, pingCd: 3, revealed: [0, 2], claimed: [1] };
    const state = deserialize(saveWith(exploration));
    expect(state?.run.exploration).toEqual(exploration);
  });

  it('rejects a v17 save without exploration', () => {
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

describe('frozen v17 fixture', () => {
  it('loads, keeps its exploration and round-trips through save', () => {
    const frozen = JSON.parse(V17_FIXTURE).state as SaveData;
    expect(frozen.version).toBe(17);
    expect(frozen.run.exploration).toEqual(newExploration(frozen.profile.seed, frozen.run.system.number));

    const state = deserialize(JSON.stringify(frozen));
    if (!state) throw new Error('expected the v17 fixture to load');
    expect(state.version).toBe(SAVE_VERSION);
    expect(state.run.exploration).toEqual(frozen.run.exploration);
    const again = deserialize(serialize(state));
    expect(again && serialize(again)).toBe(serialize(state));
  });
});

const pingCommand = { t: 'ping' } as const;

/** A fresh game whose flagship sits on its first derelict until the tick claims it. */
const claimFirstDerelict = (seed: number) => {
  const s = newGame(seed);
  const dl = systemAnomalies(s.run).find((a) => a.kind === 'derelict')!;
  s.run.exploration.revealed = [dl.id];
  flagship(s.run).pos = { ...dl.pos };
  runTicks(s, 1);
  return s;
};

describe('sensor ping', () => {
  it('reveals only anomalies within range', () => {
    const s = newGame(4242);
    const fs = flagship(s.run);
    let list = systemAnomalies(s.run);
    // Find a seed whose first anomaly has a sibling outside ping range, so the
    // test exercises both sides of the boundary.
    for (let seed = 1; seed < 200; seed++) {
      s.run.exploration.seed = seed;
      list = systemAnomalies(s.run);
      if (list.some((a) => dist(a.pos, list[0]!.pos) > TUNING.pingRange + 1)) break;
    }
    fs.pos = { ...list[0]!.pos };
    const inRange = list.filter((a) => dist(a.pos, fs.pos) <= TUNING.pingRange);
    const outOfRange = list.filter((a) => dist(a.pos, fs.pos) > TUNING.pingRange);
    expect(inRange.length).toBeGreaterThan(0);
    expect(outOfRange.length).toBeGreaterThan(0);

    send(s, pingCommand);

    expect(s.run.exploration.revealed).toEqual(inRange.map((a) => a.id));
    for (const a of outOfRange) expect(isRevealed(s.run, a.id)).toBe(false);
    expect(s.out.fx.some((f) => f.t === 'ping' && f.range === TUNING.pingRange)).toBe(true);
    expect(s.out.log.some((l) => l.event === 'ping' && l.level === 'info')).toBe(true);
  });

  it('rejects a second ping until the cooldown expires, leaving state untouched', () => {
    const s = newGame(4242);
    flagship(s.run).pos = { ...s.run.system.station.pos };
    send(s, pingCommand);
    const exploration = JSON.stringify(s.run.exploration);
    const fx = s.out.fx.length;
    const log = s.out.log.length;

    send(s, pingCommand);
    expect(s.out.log.slice(log).some((l) => l.level === 'warn' && l.text.includes('Sensors recharging'))).toBe(true);
    expect(JSON.stringify(s.run.exploration)).toBe(exploration);
    expect(s.out.fx.length).toBe(fx);

    runFor(s, TUNING.pingCooldown + 1);
    expect(pingReady(s.run)).toBe(true);
    send(s, pingCommand);
    expect(s.run.exploration.pingCd).toBe(TUNING.pingCooldown);
  });

  it('rejects a ping while the flagship is rebuilding', () => {
    const s = newGame(4242);
    const fs = flagship(s.run);
    fs.respawn = TUNING.flagshipRespawn;
    fs.hull = 0;

    send(s, pingCommand);

    expect(s.out.log.some((l) => l.level === 'warn' && l.text.includes('rebuilding'))).toBe(true);
    expect(s.run.exploration.pingCd).toBe(0);
    expect(s.out.fx.some((f) => f.t === 'ping')).toBe(false);
  });

  it('does not draw from run.rng', () => {
    const s = newGame(4242);
    const rich = systemAnomalies(s.run).find((a) => a.kind === 'rich')!;
    flagship(s.run).pos = { x: rich.pos.x + 40, z: rich.pos.z };
    const before = s.run.rng.s;

    send(s, pingCommand);

    expect(s.run.rng.s).toBe(before);
    expect(s.run.rocks.some((r) => r.rich)).toBe(true);
  });

  it('spawns one rich rock with richYieldMul units and never respawns it', () => {
    const s = newGame(4242);
    const rich = systemAnomalies(s.run).find((a) => a.kind === 'rich')!;
    flagship(s.run).pos = { x: rich.pos.x + 40, z: rich.pos.z };

    send(s, pingCommand);

    const spawned = s.run.rocks.filter((r) => r.rich);
    const rock = spawned.find((r) => r.pos.x === rich.pos.x && r.pos.z === rich.pos.z);
    expect(rock).toBeTruthy();
    expect(rock!.size).toBe(0);
    expect(rock!.kind).toBe(rich.resource);
    const base = TUNING.rockYieldK * rock!.radius ** 2 * (rock!.kind === 'crystal' ? 0.4 : 1) * s.run.system.richness;
    expect(rock!.units).toBe(Math.max(1, Math.round(base * TUNING.richYieldMul)));

    const ids = spawned.map((r) => r.id);
    runFor(s, TUNING.pingCooldown + 1);
    send(s, pingCommand);
    expect(s.run.rocks.filter((r) => r.rich).map((r) => r.id)).toEqual(ids);
  });
});

describe('derelict salvage', () => {
  it('pays once, records the claim and counts the value as run value', () => {
    const s = newGame(4242);
    const dl = systemAnomalies(s.run).find((a) => a.kind === 'derelict')!;
    s.run.exploration.revealed = [dl.id];
    const salvage = DERELICT_SALVAGE[dl.salvage]!;
    flagship(s.run).pos = { ...dl.pos };

    const before = { ...s.run.bank };
    runFor(s, 1);

    const delta = bankDelta(before, s.run.bank);
    for (const r of RESOURCES) expect(delta[r]).toBe(salvage.reward[r] ?? 0);
    expect(s.run.runValue).toBe(walletValue(salvage.reward));
    expect(isClaimed(s.run, dl.id)).toBe(true);
    expect(s.out.log.some((l) => l.level === 'major' && l.event === 'salvage' && l.text.includes(salvage.label))).toBe(
      true,
    );

    const after = { ...s.run.bank };
    runFor(s, 3);
    expect(bankDelta(after, s.run.bank)).toEqual(emptyWallet());
  });

  it('rolls component drops deterministically from the exploration seed', () => {
    // Scan for a seed whose drop actually fits, so the install path is covered.
    let seed = 1;
    for (; seed < 60; seed++) {
      const slots = flagship(claimFirstDerelict(seed).run).slots;
      if (slots.slice(2).some((f) => f !== null)) break;
    }
    expect(seed).toBeLessThan(60);

    const a = flagship(claimFirstDerelict(seed).run).slots;
    const b = flagship(claimFirstDerelict(seed).run).slots;
    expect(a).toEqual(b);
    const fitted = a.slice(2).find((f) => f !== null);
    expect(fitted).toBeTruthy();
    if (!fitted) throw new Error('expected a salvaged component in a free slot');
    expect(fitted.tier).toBe(1);
    expect(fitted.variant).toBe(defaultVariant(fitted.type));
  });

  it('round-trips revealed, claimed, pingCd and a rich rock, and a claim never pays again', () => {
    const s = newGame(4242);
    const list = systemAnomalies(s.run);
    const rich = list.find((a) => a.kind === 'rich')!;
    const dl = list.find((a) => a.kind === 'derelict')!;
    const fs = flagship(s.run);
    fs.pos = { x: rich.pos.x + 40, z: rich.pos.z };
    send(s, pingCommand);
    const richRock = s.run.rocks.find((r) => r.rich);
    expect(richRock).toBeTruthy();

    // Pin the revealed set to one rich deposit and one derelict, then claim it.
    s.run.exploration.revealed = [rich.id, dl.id];
    fs.pos = { ...dl.pos };
    runTicks(s, 2);
    expect(isClaimed(s.run, dl.id)).toBe(true);
    expect(s.run.exploration.pingCd).toBeGreaterThan(0);

    const claimedBank = { ...s.run.bank };
    const loaded = deserialize(serialize(s));
    if (!loaded) throw new Error('expected the exploration save to load');
    const exploration = s.run.exploration;
    expect(loaded.run.exploration.seed).toBe(exploration.seed);
    expect(loaded.run.exploration.revealed).toEqual(exploration.revealed);
    expect(loaded.run.exploration.claimed).toEqual(exploration.claimed);
    expect(loaded.run.exploration.pingCd).toBe(exploration.pingCd);
    expect(pingReady(loaded.run)).toBe(false);
    const loadedRock = loaded.run.rocks.find((r) => r.id === richRock!.id);
    expect(loadedRock?.rich).toBe(true);

    runFor(loaded, 3);
    expect(bankDelta(claimedBank, loaded.run.bank)).toEqual(emptyWallet());
    expect(loaded.run.exploration.claimed).toEqual(exploration.claimed);
  });
});
