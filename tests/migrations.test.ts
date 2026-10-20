import { describe, expect, it } from 'vitest';
import { newStats } from '../src/sim/achievements';
import { newAutomation } from '../src/sim/automation';
import { defaultVariant } from '../src/data/components';
import { RESOURCES } from '../src/data/resources';
import { TUNING } from '../src/data/tuning';
import { SAVE_VERSION } from '../src/sim/create';
import { newHazards } from '../src/sim/hazards';
import { SimIndex } from '../src/sim/index';
import { migrate, migrations, type Migration, type SaveData } from '../src/sim/migrations';
import { newRefinery } from '../src/sim/refining';
import { deserialize, parseImport } from '../src/sim/save';
import type { Command } from '../src/sim/commands';
import { tick } from '../src/sim/update';
// Real saves frozen at versions 2 to 10 (belt trimmed to a few rocks), committed
// so future bumps stay loadable.
import FIXTURE from './fixtures/save-v2.json?raw';
import V3_FIXTURE from './fixtures/save-v3.json?raw';
import V4_FIXTURE from './fixtures/save-v4.json?raw';
import V5_FIXTURE from './fixtures/save-v5.json?raw';
import V6_FIXTURE from './fixtures/save-v6.json?raw';
import V7_FIXTURE from './fixtures/save-v7.json?raw';
import V8_FIXTURE from './fixtures/save-v8.json?raw';
import V9_FIXTURE from './fixtures/save-v9.json?raw';
import V10_FIXTURE from './fixtures/save-v10.json?raw';
import V11_FIXTURE from './fixtures/save-v11.json?raw';

const fixtureState = (): SaveData => JSON.parse(FIXTURE).state as SaveData;

const v3FixtureState = (): SaveData => JSON.parse(V3_FIXTURE).state as SaveData;

/** A minimal save-shaped object at the given version; contents are arbitrary. */
function saveAt(version: number): SaveData {
  return { version, profile: { marker: 'original' }, run: { ships: [] } } as unknown as SaveData;
}

/** The v3 fixture's run reshaped as current: refined columns added, a system with no modifiers, a hazard board, every fitted slot at its default variant, and no outposts. */
const currentRun = () => {
  const fixture = v3FixtureState();
  const run = fixture.run;
  const ships = run.ships.map((s) => ({
    ...s,
    cargo: { ...s.cargo, alloy: 0, fuel: 0 },
    slots: s.slots.map((f) => (f ? { ...f, variant: defaultVariant(f.type) } : null)),
    autoRepair: false,
    autoUpgrade: false,
  }));
  const system = { ...run.system, modifiers: [] };
  const hazards = newHazards(fixture.profile.seed, run.system.number);
  return {
    ...run,
    system,
    bank: { ...run.bank, alloy: 0, fuel: 0 },
    ships,
    refinery: newRefinery(),
    hazards,
    automation: newAutomation(),
  };
};

/** `run` with the v12 per-ship automation flags cleared; toEqual treats an undefined field as absent. */
const sansShipAuto = <R extends { ships: object[] }>(run: R): R => ({
  ...run,
  ships: run.ships.map((s) => ({ ...s, autoRepair: undefined, autoUpgrade: undefined })),
});

/** A valid current-version save, with the given run overrides applied on top. */
const saveCurrent = (run: Record<string, unknown> = {}): SaveData => {
  const fixture = v3FixtureState();
  const profile = {
    ...fixture.profile,
    perks: { ...fixture.profile.perks, furnace: 0, hopper: 0 },
    stats: newStats(),
    achievements: [],
  };
  return { ...fixture, profile, version: SAVE_VERSION, run: { ...currentRun(), ...run } } as unknown as SaveData;
};

/** JSON for a current save whose run carries the given (unvalidated) contract board. */
const saveWithBoard = (contracts: unknown): string => JSON.stringify(saveCurrent({ contracts }));

/** Parses a frozen fixture through the production registry, failing loudly if it will not load. */
const loadFrozen = (raw: string) => {
  const r = parseImport(raw);
  if (!r.ok) throw new Error('expected the frozen fixture to load');
  return r.record.state;
};

const merge =
  (extra: Record<string, unknown>) =>
  (d: SaveData): SaveData =>
    ({ ...d, profile: { ...(d.profile as object), ...extra } }) as unknown as SaveData;

describe('migrate', () => {
  it('applies one migration and stamps the target version', () => {
    const table = { [SAVE_VERSION - 1]: merge({ migrated: true }) };
    const out = migrate(saveAt(SAVE_VERSION - 1), { table });
    expect(out?.version).toBe(SAVE_VERSION);
    expect(out?.profile).toEqual({ marker: 'original', migrated: true });
  });

  it('applies chained migrations in ascending order', () => {
    const order: number[] = [];
    const step =
      (n: number, key: string): Migration =>
      (d) => {
        order.push(n);
        return merge({ [key]: true })(d);
      };
    const table: Record<number, Migration> = { 1: step(1, 'a'), 2: step(2, 'b'), 3: step(3, 'c') };

    const out = migrate(saveAt(1), { table, to: 4 });

    expect(order).toEqual([1, 2, 3]);
    expect(out?.version).toBe(4);
    expect(out?.profile).toEqual({ marker: 'original', a: true, b: true, c: true });
  });

  it('refuses a save when the starting migration step is missing', () => {
    expect(migrate(saveAt(1), { table: {}, to: 2 })).toBeNull();
  });

  it('refuses a save when a later migration step is missing', () => {
    const table = { 1: merge({ a: true }) };
    expect(migrate(saveAt(1), { table, to: 3 })).toBeNull();
  });

  it('refuses a save from a newer version', () => {
    expect(migrate(saveAt(SAVE_VERSION + 1))).toBeNull();
  });

  it('refuses a save with no usable version', () => {
    expect(migrate(null)).toBeNull();
    expect(migrate({ profile: {}, run: {} })).toBeNull();
    expect(migrate({ version: 0 })).toBeNull();
    expect(migrate({ version: 1.5 })).toBeNull();
  });

  it('returns null when a migration step throws on the payload', () => {
    const table: Record<number, Migration> = {
      1: () => {
        throw new Error('malformed payload');
      },
    };
    expect(migrate(saveAt(1), { table, to: 2 })).toBeNull();
  });

  it('does not mutate the save it was given', () => {
    const input = saveAt(SAVE_VERSION - 1);
    migrate(input, { table: { [SAVE_VERSION - 1]: (d) => ({ ...d }) } });
    expect(input.version).toBe(SAVE_VERSION - 1);
  });
});

describe('load through the production registry', () => {
  it('accepts the frozen v2 fixture by migrating it up to the current version', () => {
    const state = deserialize(JSON.stringify(fixtureState()));
    expect(state?.version).toBe(SAVE_VERSION);
  });

  it('accepts the frozen fixture as exported text', () => {
    const r = parseImport(FIXTURE);
    expect(r.ok).toBe(true);
  });

  it('migrates an older save up to the current version', () => {
    const old = JSON.stringify({ ...fixtureState(), version: 2 });

    const state = deserialize(old, { table: migrations });

    expect(state).not.toBeNull();
    expect(state?.version).toBe(SAVE_VERSION);
    expect(state?.run.contracts.offers).toEqual([]);
  });

  it('migrates the v2 fixture to a current save with an empty board and refinery', () => {
    const state = deserialize(JSON.stringify(fixtureState()));

    expect(state?.version).toBe(SAVE_VERSION);
    expect(state?.run.contracts.offers).toEqual([]);
    expect(state?.run.contracts.active).toBeNull();
    expect(state?.run.refinery.queue).toEqual([]);
  });

  it('refills the migrated board on the first tick', () => {
    const state = deserialize(JSON.stringify(fixtureState()))!;
    expect(state.run.contracts.offers).toEqual([]);

    tick(state, 1 / 60, { thrust: { x: 0, z: 0 }, commands: [] as Command[] }, new SimIndex());

    expect(state.run.contracts.offers).toHaveLength(TUNING.contractOffers);
  });

  it('rejects a current save whose run has no contract board', () => {
    expect(deserialize(JSON.stringify(saveCurrent({ contracts: undefined })))).toBeNull();
  });

  it('rejects malformed tick-critical run fields before any tick reads them', () => {
    const run = currentRun();
    const ship = run.ships[0];
    const rock = run.rocks[0];
    const pickup = { id: 9001, kind: 'ore', amount: 3, pos: { x: 1, z: 2 }, vel: { x: 0, z: 0 }, age: 0 };
    const belt = run.system.belts[0];
    const withBelt = (b: unknown) => ({ system: { ...run.system, belts: [b] } });
    const cases: Array<[string, Record<string, unknown>]> = [
      ['missing run.system.belts', { system: { ...run.system, belts: undefined } }],
      ['null belt entry', withBelt(null)],
      ['empty belt entry', withBelt({})],
      ['belt missing initialCount', withBelt({ ...belt, initialCount: undefined })],
      ['belt mix missing a kind', withBelt({ ...belt, mix: { ore: 1, ice: 0 } })],
      ['missing run.system.station', { system: { ...run.system, station: undefined } }],
      [
        'corrupt run.system.station.pos (z undefined)',
        { system: { ...run.system, station: { pos: { x: 0, y: 0, z: undefined } } } },
      ],
      ['missing run.rng', { rng: undefined }],
      ['missing run.nextId', { nextId: undefined }],
      ['missing run.time', { time: undefined }],
      ['missing run.runValue', { runValue: undefined }],
      ['missing run.regrowTimer', { regrowTimer: undefined }],
      ['missing ship.vel', { ships: [{ ...ship, vel: undefined }] }],
      ['corrupt ship.vel', { ships: [{ ...ship, vel: { x: 0 } }] }],
      ['missing ship.pos', { ships: [{ ...ship, pos: undefined }] }],
      ['corrupt ship.pos', { ships: [{ ...ship, pos: { x: 0 } }] }],
      ...(['angle', 'hull', 'shield', 'collisionCd', 'respawn'] as const).map(
        (k): [string, Record<string, unknown>] => [`missing ship.${k}`, { ships: [{ ...ship, [k]: undefined }] }],
      ),
      ['missing rock.pos', { rocks: [{ ...rock, pos: undefined }] }],
      ['corrupt rock.vel', { rocks: [{ ...rock, vel: { x: 0 } }] }],
      ['missing rock.radius', { rocks: [{ ...rock, radius: undefined }] }],
      ['unknown rock.kind', { rocks: [{ ...rock, kind: 'unobtainium' }] }],
      ['missing pickup.pos', { pickups: [{ ...pickup, pos: undefined }] }],
      ['missing pickup.vel', { pickups: [{ ...pickup, vel: undefined }] }],
      ['null pickup', { pickups: [null] }],
    ];
    // The well-formed pickup is accepted, so its cases fail on the field alone.
    expect(deserialize(JSON.stringify(saveCurrent({ pickups: [pickup] })))).not.toBeNull();
    for (const [label, patch] of cases) {
      expect(parseImport(JSON.stringify(saveCurrent(patch))), `case: ${label}`).toEqual({
        ok: false,
        error: 'This is not an Asteroid Miner Horizons save.',
      });
    }
  });

  it('rejects non-finite tick-critical numbers that survive JSON.parse', () => {
    // JSON.stringify writes NaN and Infinity as null, which only tests the missing case. An
    // overflowing literal parses back to Infinity, so splice one in to reach the finite() checks.
    const INF = '"__INF__"';
    const run = currentRun();
    const ship = run.ships[0];
    const rock = run.rocks[0];
    const withInf = (patch: Record<string, unknown>): string =>
      JSON.stringify(saveCurrent(patch)).replace(INF, '1e999');
    const cases: Array<[string, Record<string, unknown>]> = [
      ['run.rng.s', { rng: { s: '__INF__' } }],
      ['run.nextId', { nextId: '__INF__' }],
      ['run.time', { time: '__INF__' }],
      ['run.runValue', { runValue: '__INF__' }],
      ['run.regrowTimer', { regrowTimer: '__INF__' }],
      ['ship.pos.x', { ships: [{ ...ship, pos: { ...ship.pos, x: '__INF__' } }] }],
      ['ship.hull', { ships: [{ ...ship, hull: '__INF__' }] }],
      ['rock.radius', { rocks: [{ ...rock, radius: '__INF__' }] }],
      [
        'belt.initialCount',
        { system: { ...run.system, belts: [{ ...run.system.belts[0], initialCount: '__INF__' }] } },
      ],
    ];
    for (const [label, patch] of cases) {
      const text = withInf(patch);
      expect(text, `case: ${label}`).toContain('1e999');
      expect(deserialize(text), `case: ${label}`).toBeNull();
    }
  });

  it('rejects a current save whose contract board has no offers array', () => {
    expect(deserialize(JSON.stringify(saveCurrent({ contracts: {} })))).toBeNull();
  });

  it('rejects a current save whose contract board cannot be walked by the tick', () => {
    expect(deserialize(saveWithBoard({ offers: [], nextId: 1, rng: {} }))).toBeNull(); // no rng.s
    expect(deserialize(saveWithBoard({ offers: [], nextId: 1, rng: null }))).toBeNull(); // no rng at all
    expect(deserialize(saveWithBoard({ offers: [], nextId: 'x', rng: { s: 1 } }))).toBeNull(); // bad counter
  });

  it('rejects a current save whose run has no refinery', () => {
    expect(deserialize(JSON.stringify(saveCurrent({ refinery: undefined })))).toBeNull();
  });

  it('rejects a current save whose bank is missing a resource key', () => {
    const run = currentRun();
    expect(deserialize(JSON.stringify(saveCurrent({ bank: { ...run.bank, fuel: undefined } })))).toBeNull();
  });

  it('rejects a current save whose ship cargo is missing a resource key', () => {
    const ship = currentRun().ships[0];
    const cargo = { ...ship.cargo } as Record<string, unknown>;
    delete cargo.alloy;
    expect(deserialize(JSON.stringify(saveCurrent({ ships: [{ ...ship, cargo }] })))).toBeNull();
  });

  it('rejects a current save whose refinery queue is not an array', () => {
    expect(
      deserialize(JSON.stringify(saveCurrent({ refinery: { queue: 'nope', produced: { alloy: 0, fuel: 0 } } }))),
    ).toBeNull();
  });

  it('rejects a current save whose refinery has no produced map', () => {
    expect(deserialize(JSON.stringify(saveCurrent({ refinery: { queue: [], produced: null } })))).toBeNull();
  });

  it('rejects a current save whose refinery produced is an array', () => {
    expect(deserialize(JSON.stringify(saveCurrent({ refinery: { queue: [], produced: [] } })))).toBeNull();
  });

  it('rejects a current save whose refinery produced lacks a recipe key', () => {
    expect(deserialize(JSON.stringify(saveCurrent({ refinery: { queue: [], produced: { alloy: 0 } } })))).toBeNull();
  });

  it('rejects a current save whose refinery job names an unknown recipe', () => {
    const job = { id: 1, recipe: 'gold', count: 2, total: 2, progress: 0 };
    const refinery = { queue: [job], nextId: 2, produced: { alloy: 0, fuel: 0 } };
    expect(deserialize(JSON.stringify(saveCurrent({ refinery })))).toBeNull();
  });

  it('accepts a current save with a well-formed refinery job', () => {
    const job = { id: 1, recipe: 'fuel', count: 2, total: 2, progress: 0 };
    const refinery = { queue: [job], nextId: 2, produced: { alloy: 0, fuel: 0 } };
    const state = deserialize(JSON.stringify(saveCurrent({ refinery })));
    expect(state?.run.refinery.queue).toEqual([job]);
  });

  it('rejects a current save whose refinery job counters are out of range', () => {
    const bad = [
      { id: 1, recipe: 'fuel', count: 0, total: 0, progress: 0 },
      { id: 1, recipe: 'fuel', count: -1, total: 2, progress: 0 },
      { id: 1, recipe: 'fuel', count: 3, total: 2, progress: 0 },
      { id: 1, recipe: 'fuel', count: 2, total: 2, progress: -1 },
    ];
    for (const job of bad) {
      const refinery = { queue: [job], nextId: 2, produced: { alloy: 0, fuel: 0 } };
      expect(deserialize(JSON.stringify(saveCurrent({ refinery })))).toBeNull();
    }
  });

  it('rejects a current save whose refinery ids could collide', () => {
    const job = { id: 4, recipe: 'fuel', count: 2, total: 2, progress: 0 };
    for (const nextId of [undefined, 4, 2]) {
      const refinery = { queue: [job], nextId, produced: { alloy: 0, fuel: 0 } };
      expect(deserialize(JSON.stringify(saveCurrent({ refinery })))).toBeNull();
    }
  });

  it('rejects a current save whose refinery job counters are not finite', () => {
    // JSON.parse turns an overflowing literal into Infinity, so isQueue's finite
    // checks are load-bearing rather than merely defensive.
    const job = { id: 1, recipe: 'fuel', count: 2, total: 2, progress: 0 };
    const json = JSON.stringify(
      saveCurrent({ refinery: { queue: [job], nextId: 2, produced: { alloy: 0, fuel: 0 } } }),
    );
    expect(deserialize(json)?.run.refinery.queue).toEqual([job]);
    const jobJson = '"recipe":"fuel","count":2,"total":2,"progress":0';
    for (const field of ['"count":2', '"total":2', '"progress":0']) {
      const broken = json.replace(jobJson, jobJson.replace(field, field.replace(/:.*/, ':1e999')));
      expect(deserialize(broken)).toBeNull();
    }
  });

  it('refuses a save whose migration chain has a gap', () => {
    // A version below everything the table covers, so this holds whatever real steps exist.
    const old = JSON.stringify({ ...fixtureState(), version: 1 });
    expect(deserialize(old, { table: {}, to: SAVE_VERSION })).toBeNull();
    expect(parseImport(old, { table: {} })).toEqual({
      ok: false,
      error: `Unsupported save version 1 (expected ${SAVE_VERSION}).`,
    });
  });

  it('does not blame the version when an upgradable save is malformed', () => {
    const broken = JSON.stringify({ version: SAVE_VERSION - 1, profile: {}, run: {} });
    const table = { [SAVE_VERSION - 1]: (d: SaveData) => d };
    expect(parseImport(broken, { table })).toEqual({
      ok: false,
      error: 'This is not an Asteroid Miner Horizons save.',
    });
  });

  it('loads a malformed upgradable save as unusable instead of throwing', () => {
    // Through the production table, migrations[3] reads fields this payload lacks.
    // The newest step (migrations[6]) is a documented no-op, so it cannot throw.
    const broken = JSON.stringify({ version: 3, profile: {}, run: {} });
    expect(migrate(JSON.parse(broken))).toBeNull();
    expect(parseImport(broken)).toEqual({
      ok: false,
      error: 'This is not an Asteroid Miner Horizons save.',
    });
  });

  it('explains that a save from a newer version cannot be loaded', () => {
    const rec = { format: 'amh-save', savedAt: 0, state: { ...fixtureState(), version: SAVE_VERSION + 1 } };
    const r = parseImport(JSON.stringify(rec));
    if (r.ok) throw new Error('expected a newer-version save to be rejected');
    expect(r.error).toMatch(/newer version/i);
  });
});

describe('refining migration to v4', () => {
  const frozen: Array<[string, string]> = [
    ['v2', FIXTURE],
    ['v3', V3_FIXTURE],
  ];

  it.each(frozen)('migrates the %s fixture to v4 with zeroed refined columns', (_label, raw) => {
    const state = loadFrozen(raw);

    expect(state.version).toBe(SAVE_VERSION);
    expect(state.run.bank.alloy).toBe(0);
    expect(state.run.bank.fuel).toBe(0);
    for (const ship of state.run.ships) {
      expect(ship.cargo.alloy).toBe(0);
      expect(ship.cargo.fuel).toBe(0);
    }
    expect(state.run.refinery.queue).toEqual([]);
    expect(state.run.refinery.produced).toEqual({ alloy: 0, fuel: 0 });
    expect(state.run.contracts).toBeDefined();
  });

  it.each(frozen)('runs a tick on the migrated %s save with a finite bank', (_label, raw) => {
    const state = loadFrozen(raw);

    tick(state, 1 / 60, { thrust: { x: 0, z: 0 }, commands: [] as Command[] }, new SimIndex());

    for (const r of RESOURCES) expect(Number.isFinite(state.run.bank[r])).toBe(true);
  });

  it("keeps the v3 fixture's three contract offers", () => {
    expect(loadFrozen(V3_FIXTURE).run.contracts.offers).toHaveLength(3);
  });

  it('loads a malformed v3 payload as unusable instead of throwing', () => {
    const run = { ...v3FixtureState().run, ships: undefined };
    expect(parseImport(JSON.stringify({ ...v3FixtureState(), version: 3, run }))).toEqual({
      ok: false,
      error: 'This is not an Asteroid Miner Horizons save.',
    });
  });
});

describe('system modifiers migration to v5', () => {
  const frozen: Array<[string, string]> = [
    ['v2', FIXTURE],
    ['v3', V3_FIXTURE],
    ['v4', V4_FIXTURE],
  ];

  it.each(frozen)('loads the %s fixture with no modifiers', (_label, raw) => {
    const state = loadFrozen(raw);

    expect(state.version).toBe(SAVE_VERSION);
    expect(state.run.system.modifiers).toEqual([]);
  });

  it.each(frozen)('runs a tick on the %s fixture with a finite bank', (_label, raw) => {
    const state = loadFrozen(raw);

    tick(state, 1 / 60, { thrust: { x: 0, z: 0 }, commands: [] as Command[] }, new SimIndex());

    for (const r of RESOURCES) expect(Number.isFinite(state.run.bank[r])).toBe(true);
  });

  it('leaves the v4 fixture bank, refinery and contract board unchanged', () => {
    const before = JSON.parse(V4_FIXTURE).state.run;
    const run = loadFrozen(V4_FIXTURE).run;

    expect(run.bank).toEqual(before.bank);
    expect(run.refinery).toEqual(before.refinery);
    expect(run.contracts).toEqual(before.contracts);
  });

  it('rejects a v5 save without system.modifiers', () => {
    const { modifiers: _omit, ...system } = currentRun().system;
    expect(parseImport(JSON.stringify(saveCurrent({ system }))).ok).toBe(false);
  });

  it('rejects modifiers that are not an array of known keys', () => {
    for (const modifiers of ['dense', ['dense', 'warpStorm'], ['nebula', 'nebula'], [1], ['toString']]) {
      const system = { ...currentRun().system, modifiers };
      expect(parseImport(JSON.stringify(saveCurrent({ system }))).ok).toBe(false);
    }
  });

  it('accepts and keeps known modifiers', () => {
    const system = { ...currentRun().system, modifiers: ['dense', 'nebula'] };
    const r = parseImport(JSON.stringify(saveCurrent({ system })));
    if (!r.ok) throw new Error('expected the save to load');
    expect(r.record.state.run.system.modifiers).toEqual(['dense', 'nebula']);
  });

  it('loads a malformed v4 payload with no run.system as unusable instead of throwing', () => {
    const state = JSON.parse(V4_FIXTURE).state;
    const r = parseImport(JSON.stringify({ ...state, run: { ...state.run, system: undefined } }));
    expect(r.ok).toBe(false);
  });
});

describe('hazards migration to v6', () => {
  const frozen: Array<[string, string]> = [
    ['v2', FIXTURE],
    ['v3', V3_FIXTURE],
    ['v4', V4_FIXTURE],
    ['v5', V5_FIXTURE],
  ];

  it.each(frozen)('upgrades the %s fixture to a fresh hazard board', (_label, raw) => {
    const state = loadFrozen(raw);

    expect(state.version).toBe(SAVE_VERSION);
    expect(state.run.hazards).toEqual(newHazards(state.profile.seed, state.run.system.number));
  });

  it('runs a tick on the v5 fixture', () => {
    const state = loadFrozen(V5_FIXTURE);

    tick(state, 1 / 60, { thrust: { x: 0, z: 0 }, commands: [] as Command[] }, new SimIndex());

    expect(Number.isFinite(state.run.hazards.cometTimer)).toBe(true);
  });

  it('rejects a v6 save without hazards or with a malformed board', () => {
    const run = loadFrozen(V5_FIXTURE).run;
    const good = newHazards(1, 1);
    const bad: unknown[] = [
      undefined,
      null,
      'x',
      { ...good, rng: undefined },
      { ...good, rng: { s: 'a' } },
      { ...good, cometTimer: Number.NaN },
      { ...good, flareTimer: 'soon' },
      { ...good, comet: {} },
      { ...good, comet: { from: { x: 0, z: 0 }, vel: { x: 1, z: 0 }, belt: 0, timeLeft: 'x' } },
      { ...good, flare: { phase: 'bogus', timeLeft: 1 } },
      { ...good, flare: { phase: 'active' } },
    ];
    for (const hazards of bad) {
      const state = { version: 6, profile: loadFrozen(V5_FIXTURE).profile, run: { ...run, hazards } };
      expect(parseImport(JSON.stringify(state)).ok).toBe(false);
    }
  });

  it('accepts pending hazards', () => {
    const run = loadFrozen(V5_FIXTURE).run;
    const hazards = {
      ...newHazards(1, 1),
      comet: { from: { x: 3200, z: 0 }, vel: { x: -130, z: 0 }, belt: 1, timeLeft: 4 },
      flare: { phase: 'active', timeLeft: 2 },
    };
    const state = { version: 6, profile: loadFrozen(V5_FIXTURE).profile, run: { ...run, hazards } };
    expect(parseImport(JSON.stringify(state)).ok).toBe(true);
  });
});

describe('rock traits migration to v7', () => {
  it.each([
    ['v5', V5_FIXTURE],
    ['v6', V6_FIXTURE],
  ])('loads the %s fixture as v7 with plain rocks', (_l, raw) => {
    const state = loadFrozen(raw);
    expect(state.version).toBe(SAVE_VERSION);
    expect(state.run.rocks.every((r) => r.trait === undefined)).toBe(true);
  });

  it('rejects a rock with an unknown trait', () => {
    const run = loadFrozen(V6_FIXTURE).run;
    run.rocks[0]!.trait = 'bogus' as never;
    expect(parseImport(JSON.stringify({ version: 7, profile: loadFrozen(V6_FIXTURE).profile, run })).ok).toBe(false);
  });

  it('rejects a null rock element without throwing', () => {
    const loaded = loadFrozen(V6_FIXTURE);
    const run = { ...loaded.run, rocks: [null] };
    expect(parseImport(JSON.stringify({ version: 7, profile: loaded.profile, run })).ok).toBe(false);
  });

  it('keeps a known trait through a round-trip', () => {
    const run = loadFrozen(V6_FIXTURE).run;
    run.rocks[0]!.trait = 'volatile';
    const state = parseImport(JSON.stringify({ version: 7, profile: loadFrozen(V6_FIXTURE).profile, run }));
    if (!state.ok) throw new Error('expected the save to load');
    expect(state.record.state.run.rocks[0]!.trait).toBe('volatile');
  });
});

describe('component variants migration to v8', () => {
  const frozen: Array<[string, string]> = [
    ['v2', FIXTURE],
    ['v3', V3_FIXTURE],
    ['v4', V4_FIXTURE],
    ['v5', V5_FIXTURE],
    ['v6', V6_FIXTURE],
    ['v7', V7_FIXTURE],
  ];

  it.each(frozen)('loads the %s fixture as v8 with every fitted slot at its default variant', (_label, raw) => {
    const state = loadFrozen(raw);

    expect(state.version).toBe(SAVE_VERSION);
    const slots = state.run.ships.flatMap((s) => s.slots);
    expect(slots.every((f) => f === null || f.variant === defaultVariant(f.type))).toBe(true);
  });

  it('loads a v7 save whose fitted slots already carry a variant', () => {
    // The branch's own intermediate writes saved v7 with a variant set; a v7
    // save never legitimately had one, so the migration may overwrite it.
    const { profile, run } = JSON.parse(V7_FIXTURE).state;
    run.ships[0].slots[0] = { type: 'laser', variant: 'wide', tier: 1 };
    const r = parseImport(JSON.stringify({ version: 7, profile, run }));
    if (!r.ok) throw new Error('expected the save to load');
    expect(r.record.state.run.ships[0]!.slots[0]!.variant).toBe(defaultVariant('laser'));
  });

  it('rejects a save with a variant unknown for its slot type', () => {
    const loaded = loadFrozen(V7_FIXTURE);
    const run = loaded.run;
    run.ships[0]!.slots[0] = { type: 'laser', variant: 'thruster', tier: 1 } as never;
    expect(parseImport(JSON.stringify({ version: 8, profile: loaded.profile, run })).ok).toBe(false);
  });

  it('rejects a save whose slot tier is out of range', () => {
    const loaded = loadFrozen(V7_FIXTURE);
    const run = loaded.run;
    run.ships[0]!.slots[0] = { type: 'laser', variant: 'focused', tier: 4 } as never;
    expect(parseImport(JSON.stringify({ version: 8, profile: loaded.profile, run })).ok).toBe(false);
  });

  it('keeps a non-default variant through a round-trip', () => {
    const loaded = loadFrozen(V7_FIXTURE);
    const run = loaded.run;
    run.ships[0]!.slots[0] = { type: 'laser', variant: 'wide', tier: 2 };
    const r = parseImport(JSON.stringify({ version: 8, profile: loaded.profile, run }));
    if (!r.ok) throw new Error('expected the save to load');
    expect(r.record.state.run.ships[0]!.slots[0]).toEqual({ type: 'laser', variant: 'wide', tier: 2 });
  });
});

/** A current save from the v8 fixture whose automation is `automation`. */
const withAutomation = (automation: unknown): string => {
  const loaded = loadFrozen(V8_FIXTURE);
  return JSON.stringify({ version: SAVE_VERSION, profile: loaded.profile, run: { ...loaded.run, automation } });
};
const outpostOn = (rockId: number) => ({
  rockId,
  kind: 'ore',
  pos: { x: 0, z: 0 },
  stored: { ore: 5, ice: 0, crystal: 0, alloy: 0, fuel: 0 },
  reserve: 100,
});

describe('automation migration to v9', () => {
  const frozen: Array<[string, string]> = [
    ['v2', FIXTURE],
    ['v5', V5_FIXTURE],
    ['v7', V7_FIXTURE],
    ['v8', V8_FIXTURE],
  ];

  it.each(frozen)('loads the %s fixture as v9 with no outposts', (_label, raw) => {
    const state = loadFrozen(raw);
    expect(state.version).toBe(SAVE_VERSION);
    expect(state.run.automation).toEqual(newAutomation());
  });

  it('keeps the v8 fixture otherwise unchanged', () => {
    const before = JSON.parse(V8_FIXTURE).state;
    const state = loadFrozen(V8_FIXTURE);
    const { automation, ...run } = state.run;
    expect(automation.outposts).toEqual([]);
    expect(sansShipAuto(run)).toEqual(before.run);
  });

  it('keeps a well-formed outpost through a round-trip', () => {
    const rockId = loadFrozen(V8_FIXTURE).run.rocks[0]!.id;
    const r = parseImport(withAutomation({ outposts: [outpostOn(rockId)], extracted: 5 }));
    if (!r.ok) throw new Error('expected the save to load');
    expect(r.record.state.run.automation.outposts[0]).toEqual(outpostOn(rockId));
  });

  it('rejects malformed automation', () => {
    const rockId = loadFrozen(V8_FIXTURE).run.rocks[0]!.id;
    const bad = [
      undefined,
      { outposts: [], extracted: 'x' },
      { outposts: [outpostOn(-1)], extracted: 0 },
      { outposts: [outpostOn(rockId), outpostOn(rockId)], extracted: 0 },
      { outposts: [{ ...outpostOn(rockId), kind: 'alloy' }], extracted: 0 },
      { outposts: [{ ...outpostOn(rockId), stored: { ore: 1 } }], extracted: 0 },
      { outposts: [{ ...outpostOn(rockId), reserve: null }], extracted: 0 },
      { outposts: [null], extracted: 0 },
    ];
    for (const a of bad) expect(parseImport(withAutomation(a)).ok).toBe(false);
  });
});

describe('refinery perks migration to v10', () => {
  it.each([
    ['v2', FIXTURE],
    ['v8', V8_FIXTURE],
    ['v9', V9_FIXTURE],
  ])('loads the %s fixture with both refinery perks at level 0', (_label, raw) => {
    const state = loadFrozen(raw);
    expect(state.version).toBe(SAVE_VERSION);
    expect(state.profile.perks.furnace).toBe(0);
    expect(state.profile.perks.hopper).toBe(0);
  });

  it('keeps the other perk levels', () => {
    const before = JSON.parse(V9_FIXTURE).state.profile.perks;
    const { furnace, hopper, ...rest } = loadFrozen(V9_FIXTURE).profile.perks;
    expect(furnace + hopper).toBe(0);
    expect(rest).toEqual(before);
  });

  it('rejects a current save with a missing or non-numeric perk level', () => {
    const loaded = loadFrozen(V9_FIXTURE);
    for (const furnace of [undefined, 'x', null]) {
      const profile = { ...loaded.profile, perks: { ...loaded.profile.perks, furnace } };
      expect(parseImport(JSON.stringify({ version: SAVE_VERSION, profile, run: loaded.run })).ok).toBe(false);
    }
  });
});

describe('lifetime stats migration to v11', () => {
  it.each([
    ['v2', FIXTURE],
    ['v9', V9_FIXTURE],
    ['v10', V10_FIXTURE],
  ])('loads the %s fixture with complete stats and no achievements', (_label, raw) => {
    const state = loadFrozen(raw);
    expect(state.version).toBe(SAVE_VERSION);
    expect(Object.keys(state.profile.stats)).toEqual(Object.keys(newStats()));
    expect(state.profile.achievements).toEqual([]);
  });

  it('seeds the stats from what the v10 save already records', () => {
    const before = JSON.parse(V10_FIXTURE).state;
    const { stats } = loadFrozen(V10_FIXTURE).profile;
    expect(stats).toEqual({
      ...newStats(),
      time: before.run.time,
      warps: 2,
      perks: 4,
      contracts: 3,
      refined: 58,
      comets: 4,
    });
  });

  it('keeps the v10 fixture otherwise unchanged', () => {
    const before = JSON.parse(V10_FIXTURE).state;
    const loaded = loadFrozen(V10_FIXTURE);
    // toEqual treats an undefined field as absent, so this compares everything else.
    expect({ ...loaded.profile, stats: undefined, achievements: undefined }).toEqual(before.profile);
    expect(sansShipAuto(loaded.run)).toEqual(before.run);
  });

  it('unlocks what the seeded stats already reach on the first tick', () => {
    const state = loadFrozen(V10_FIXTURE);
    const commands: Command[] = [];
    tick(state, 1 / 60, { thrust: { x: 0, z: 0 }, commands }, new SimIndex());
    expect(state.profile.achievements).toEqual(['firstJump', 'contractor']);
  });

  it('rejects malformed stats or achievements', () => {
    const loaded = loadFrozen(V10_FIXTURE);
    const bad = [
      { stats: undefined },
      { stats: null },
      { stats: { ...loaded.profile.stats, warps: 'x' } },
      { stats: { ...loaded.profile.stats, rocksBroken: Infinity } },
      { stats: { ...loaded.profile.stats, time: undefined } },
      { achievements: undefined },
      { achievements: ['notAnAchievement'] },
      { achievements: ['firstJump', 'firstJump'] },
      { achievements: [7] },
    ];
    for (const patch of bad) {
      const profile = { ...loaded.profile, ...patch };
      expect(parseImport(JSON.stringify({ version: SAVE_VERSION, profile, run: loaded.run })).ok).toBe(false);
    }
    const good = { ...loaded.profile, achievements: ['firstJump'] };
    expect(parseImport(JSON.stringify({ version: SAVE_VERSION, profile: good, run: loaded.run })).ok).toBe(true);
  });
});

describe('ship automation migration to v12', () => {
  it.each([
    ['v2', FIXTURE],
    ['v10', V10_FIXTURE],
    ['v11', V11_FIXTURE],
  ])('loads the %s fixture with autorepair and autoupgrade off on every ship', (_label, raw) => {
    const state = loadFrozen(raw);
    expect(state.version).toBe(SAVE_VERSION);
    for (const ship of state.run.ships) expect([ship.autoRepair, ship.autoUpgrade]).toEqual([false, false]);
  });

  it('keeps the v11 fixture otherwise unchanged', () => {
    const before = JSON.parse(V11_FIXTURE).state;
    const loaded = loadFrozen(V11_FIXTURE);
    expect(loaded.profile).toEqual(before.profile);
    expect(sansShipAuto(loaded.run)).toEqual(before.run);
  });

  it('rejects a current save whose ship flags are not booleans', () => {
    const loaded = loadFrozen(V11_FIXTURE);
    loaded.run.ships[1]!.autoRepair = 'yes' as unknown as boolean;
    expect(parseImport(JSON.stringify({ format: 'amh-save', savedAt: 0, state: loaded })).ok).toBe(false);
  });
});
