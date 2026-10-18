import { describe, expect, it } from 'vitest';
import { RESOURCES } from '../src/data/resources';
import { TUNING } from '../src/data/tuning';
import { SAVE_VERSION } from '../src/sim/create';
import { SimIndex } from '../src/sim/index';
import { migrate, migrations, type Migration, type SaveData } from '../src/sim/migrations';
import { newRefinery } from '../src/sim/refining';
import { deserialize, parseImport } from '../src/sim/save';
import type { Command } from '../src/sim/commands';
import { tick } from '../src/sim/update';
// Real saves frozen at versions 2 and 3 (belt trimmed to a few rocks), committed
// so future bumps stay loadable.
import FIXTURE from './fixtures/save-v2.json?raw';
import V3_FIXTURE from './fixtures/save-v3.json?raw';

const fixtureState = (): SaveData => JSON.parse(FIXTURE).state as SaveData;

const v3FixtureState = (): SaveData => JSON.parse(V3_FIXTURE).state as SaveData;

/** A minimal save-shaped object at the given version; contents are arbitrary. */
function saveAt(version: number): SaveData {
  return { version, profile: { marker: 'original' }, run: { ships: [] } } as unknown as SaveData;
}

/** The v3 fixture's run reshaped as v4: refined columns added to bank and cargo. */
const v4Run = () => {
  const run = v3FixtureState().run;
  const ships = run.ships.map((s) => ({ ...s, cargo: { ...s.cargo, alloy: 0, fuel: 0 } }));
  return { ...run, bank: { ...run.bank, alloy: 0, fuel: 0 }, ships, refinery: newRefinery() };
};

/** A valid v4 save, with the given run overrides applied on top. */
const saveV4 = (run: Record<string, unknown> = {}): SaveData =>
  ({ ...v3FixtureState(), version: SAVE_VERSION, run: { ...v4Run(), ...run } }) as unknown as SaveData;

/** JSON for a v4 save whose run carries the given (unvalidated) contract board. */
const saveWithBoard = (contracts: unknown): string => JSON.stringify(saveV4({ contracts }));

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

  it('migrates the v2 fixture to a v4 save with an empty board and refinery', () => {
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

  it('rejects a v4 save whose run has no contract board', () => {
    expect(deserialize(JSON.stringify(saveV4({ contracts: undefined })))).toBeNull();
  });

  it('rejects a v4 save whose contract board has no offers array', () => {
    expect(deserialize(JSON.stringify(saveV4({ contracts: {} })))).toBeNull();
  });

  it('rejects a v4 save whose contract board cannot be walked by the tick', () => {
    expect(deserialize(saveWithBoard({ offers: [], nextId: 1, rng: {} }))).toBeNull(); // no rng.s
    expect(deserialize(saveWithBoard({ offers: [], nextId: 1, rng: null }))).toBeNull(); // no rng at all
    expect(deserialize(saveWithBoard({ offers: [], nextId: 'x', rng: { s: 1 } }))).toBeNull(); // bad counter
  });

  it('rejects a v4 save whose run has no refinery', () => {
    expect(deserialize(JSON.stringify(saveV4({ refinery: undefined })))).toBeNull();
  });

  it('rejects a v4 save whose bank is missing a resource key', () => {
    const run = v4Run();
    expect(deserialize(JSON.stringify(saveV4({ bank: { ...run.bank, fuel: undefined } })))).toBeNull();
  });

  it('rejects a v4 save whose ship cargo is missing a resource key', () => {
    const ship = v4Run().ships[0];
    const cargo = { ...ship.cargo } as Record<string, unknown>;
    delete cargo.alloy;
    expect(deserialize(JSON.stringify(saveV4({ ships: [{ ...ship, cargo }] })))).toBeNull();
  });

  it('rejects a v4 save whose refinery queue is not an array', () => {
    expect(
      deserialize(JSON.stringify(saveV4({ refinery: { queue: 'nope', produced: { alloy: 0, fuel: 0 } } }))),
    ).toBeNull();
  });

  it('rejects a v4 save whose refinery has no produced map', () => {
    expect(deserialize(JSON.stringify(saveV4({ refinery: { queue: [], produced: null } })))).toBeNull();
  });

  it('rejects a v4 save whose refinery produced is an array', () => {
    expect(deserialize(JSON.stringify(saveV4({ refinery: { queue: [], produced: [] } })))).toBeNull();
  });

  it('rejects a v4 save whose refinery produced lacks a recipe key', () => {
    expect(deserialize(JSON.stringify(saveV4({ refinery: { queue: [], produced: { alloy: 0 } } })))).toBeNull();
  });

  it('rejects a v4 save whose refinery job names an unknown recipe', () => {
    const job = { recipe: 'gold', count: 2, total: 2, progress: 0 };
    const refinery = { queue: [job], produced: { alloy: 0, fuel: 0 } };
    expect(deserialize(JSON.stringify(saveV4({ refinery })))).toBeNull();
  });

  it('accepts a v4 save with a well-formed refinery job', () => {
    const job = { recipe: 'fuel', count: 2, total: 2, progress: 0 };
    const refinery = { queue: [job], produced: { alloy: 0, fuel: 0 } };
    const state = deserialize(JSON.stringify(saveV4({ refinery })));
    expect(state?.run.refinery.queue).toEqual([job]);
  });

  it('rejects a v4 save whose refinery job counters are out of range', () => {
    const bad = [
      { recipe: 'fuel', count: 0, total: 0, progress: 0 },
      { recipe: 'fuel', count: -1, total: 2, progress: 0 },
      { recipe: 'fuel', count: 3, total: 2, progress: 0 },
      { recipe: 'fuel', count: 2, total: 2, progress: -1 },
    ];
    for (const job of bad) {
      const refinery = { queue: [job], produced: { alloy: 0, fuel: 0 } };
      expect(deserialize(JSON.stringify(saveV4({ refinery })))).toBeNull();
    }
  });

  it('rejects a v4 save whose refinery job counters are not finite', () => {
    // JSON.parse turns an overflowing literal into Infinity, so isQueue's finite
    // checks are load-bearing rather than merely defensive.
    const job = { recipe: 'fuel', count: 2, total: 2, progress: 0 };
    const json = JSON.stringify(saveV4({ refinery: { queue: [job], produced: { alloy: 0, fuel: 0 } } }));
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
    const broken = JSON.stringify({ version: SAVE_VERSION - 1, profile: {}, run: {} });
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
