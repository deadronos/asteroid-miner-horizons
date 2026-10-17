import { describe, expect, it } from 'vitest';
import { SAVE_VERSION } from '../src/sim/create';
import { migrate, migrations, type Migration, type SaveData } from '../src/sim/migrations';
import { deserialize, parseImport } from '../src/sim/save';
import type { ContractBoard } from '../src/sim/types';
// A real save frozen at version 2 (belt trimmed to a few rocks), committed so
// future bumps stay loadable.
import FIXTURE from './fixtures/save-v2.json?raw';

const fixtureState = (): SaveData => JSON.parse(FIXTURE).state as SaveData;

/** A minimal save-shaped object at the given version; contents are arbitrary. */
function saveAt(version: number): SaveData {
  return { version, profile: { marker: 'original' }, run: { ships: [] } } as unknown as SaveData;
}

/** JSON for a v3 save whose run carries the given (unvalidated) contract board. */
const saveWithBoard = (contracts: unknown): string =>
  JSON.stringify({ ...fixtureState(), version: SAVE_VERSION, run: { ...fixtureState().run, contracts } });

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
  it('accepts the frozen fixture at the current version', () => {
    const state = deserialize(JSON.stringify(fixtureState()));
    expect(state?.version).toBe(SAVE_VERSION);
  });

  it('accepts the frozen fixture as exported text', () => {
    const r = parseImport(FIXTURE);
    expect(r.ok).toBe(true);
  });

  it('migrates an older save up to the current version', () => {
    const old = JSON.stringify({ ...fixtureState(), version: SAVE_VERSION - 1 });

    const state = deserialize(old, { table: migrations });

    expect(state).not.toBeNull();
    expect(state?.version).toBe(SAVE_VERSION);
    expect(state?.run.contracts.offers).toEqual([]);
  });

  it('migrates the v2 fixture to a v3 save with an empty contract board', () => {
    const state = deserialize(JSON.stringify(fixtureState()));

    expect(state?.version).toBe(SAVE_VERSION);
    expect(state?.run.contracts.offers).toEqual([]);
    expect(state?.run.contracts.active).toBeNull();
  });

  it('rejects a v3 save whose run has no contract board', () => {
    const data = { ...fixtureState(), version: SAVE_VERSION };
    expect(deserialize(JSON.stringify(data))).toBeNull();
  });

  it('rejects a v3 save whose contract board has no offers array', () => {
    const base = fixtureState();
    base.run.contracts = {} as ContractBoard;
    const data = { ...base, version: SAVE_VERSION };
    expect(deserialize(JSON.stringify(data))).toBeNull();
  });

  it('rejects a v3 save whose contract board cannot be walked by the tick', () => {
    expect(deserialize(saveWithBoard({ offers: [], nextId: 1, rng: {} }))).toBeNull(); // no rng.s
    expect(deserialize(saveWithBoard({ offers: [], nextId: 1, rng: null }))).toBeNull(); // no rng at all
    expect(deserialize(saveWithBoard({ offers: [], nextId: 'x', rng: { s: 1 } }))).toBeNull(); // bad counter
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
    // Through the production table, migrations[2] reads fields this payload lacks.
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
