import { describe, expect, it } from 'vitest';
import { SAVE_VERSION } from '../src/sim/create';
import { migrate, migrations, type Migration, type SaveData } from '../src/sim/migrations';
import { deserialize, parseImport } from '../src/sim/save';
// A real save frozen at version 2, committed so future bumps stay loadable.
import FIXTURE from './fixtures/save-v2.json?raw';

const fixtureState = (): SaveData => JSON.parse(FIXTURE).state as SaveData;

/** A minimal save-shaped object at the given version; contents are arbitrary. */
function saveAt(version: number): SaveData {
  return { version, profile: { marker: 'original' }, run: { ships: [] } } as unknown as SaveData;
}

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
    const old = { ...fixtureState(), version: SAVE_VERSION - 1 };
    migrations[SAVE_VERSION - 1] = (d) => d;
    try {
      const state = deserialize(JSON.stringify(old));
      expect(state).not.toBeNull();
      expect(state?.version).toBe(SAVE_VERSION);
    } finally {
      delete migrations[SAVE_VERSION - 1];
    }
  });

  it('still refuses an older save when no migration exists for it', () => {
    const old = { ...fixtureState(), version: SAVE_VERSION - 1 };
    expect(deserialize(JSON.stringify(old))).toBeNull();
  });

  it('explains that a save from a newer version cannot be loaded', () => {
    const rec = { format: 'amh-save', savedAt: 0, state: { ...fixtureState(), version: SAVE_VERSION + 1 } };
    const r = parseImport(JSON.stringify(rec));
    if (r.ok) throw new Error('expected a newer-version save to be rejected');
    expect(r.error).toMatch(/newer version/i);
  });
});
