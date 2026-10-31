// Tests for src/sim/validate.ts: direct corruption cases and a seeded fuzz run.

import { describe, expect, it } from 'vitest';
import { makeRng, int, pick } from '../src/core/rng';
import { newGame } from '../src/sim/create';
import type { SaveData } from '../src/sim/migrations';
import { deserialize, serialize } from '../src/sim/save';
import { validateState } from '../src/sim/validate';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a fresh valid SaveData from seed 7. */
function validPayload(): SaveData {
  return JSON.parse(serialize(newGame(7))) as unknown as SaveData;
}

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe('validateState – valid payload', () => {
  it('returns a non-null state', () => {
    const payload = validPayload();
    expect(validateState(payload)).not.toBeNull();
  });

  it('round-trips through serialize', () => {
    const payload = validPayload();
    const state = validateState(payload);
    expect(state).not.toBeNull();
    expect(deserialize(serialize(state!))).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Corruption cases – each must return null
// ---------------------------------------------------------------------------

type Corrupt = [string, (s: SaveData) => void];

const corruptions: Corrupt[] = [
  ['missing profile', (s) => delete (s as Partial<SaveData>).profile],
  ['missing profile.seed', (s) => delete (s.profile as Partial<typeof s.profile>).seed],
  ['profile.seed a string', (s) => ((s.profile.seed as unknown) = '7')],
  ['missing run', (s) => delete (s as Partial<SaveData>).run],
  ['missing run.rng.s', (s) => delete (s.run.rng as Partial<typeof s.run.rng>).s],
  ['empty system.belts', (s) => (s.run.system.belts = [])],
  ['missing ship.pos.x', (s) => delete (s.run.ships[0]!.pos as Partial<(typeof s.run.ships)[0]['pos']>).x],
  [
    'ship slot tier 4',
    (s) => ((s.run.ships[0]!.slots[0] as unknown) = { type: 'laser', variant: 'standard', tier: 4 }),
  ],
  ['bank missing alloy', (s) => delete (s.run.bank as Partial<typeof s.run.bank>).alloy],
  ['rock size 3', (s) => ((s.run.rocks[0]!.size as unknown) = 3)],
  ['hazard timer Infinity', (s) => (s.run.hazards.flareTimer = Infinity)],
  ['duplicate ship id', (s) => s.run.ships.push({ ...s.run.ships[0]! })],
  ['duplicate rock id', (s) => s.run.rocks.push({ ...s.run.rocks[0]! })],
  ['bank alloy NaN', (s) => ((s.run.bank.alloy as unknown) = NaN)],
  ['bank alloy Infinity', (s) => ((s.run.bank.alloy as unknown) = Infinity)],
  ['ship cargo alloy NaN', (s) => ((s.run.ships[0]!.cargo.alloy as unknown) = NaN)],
];

describe('validateState – build orders', () => {
  it('validate rejects a build order without a rockId', () => {
    const payload = validPayload();
    (payload.run.ships[0]!.order as unknown) = { kind: 'build' };
    expect(validateState(payload)).toBeNull();
  });

  it('accepts a build order with a rockId', () => {
    const payload = validPayload();
    payload.run.ships[0]!.order = { kind: 'build', rockId: 3 };
    expect(validateState(payload)).not.toBeNull();
  });

  it('rejects a ship whose autoBuild is missing', () => {
    const payload = validPayload();
    delete (payload.run.ships[0] as Partial<(typeof payload.run.ships)[0]>).autoBuild;
    expect(validateState(payload)).toBeNull();
  });
});

describe('validateState – corruptions return null', () => {
  for (const [label, corrupt] of corruptions) {
    it(`validateState: ${label}`, () => {
      const payload = validPayload();
      corrupt(payload);
      expect(validateState(payload)).toBeNull();
    });
  }
});

describe('deserialize – corruptions return null', () => {
  for (const [label, corrupt] of corruptions) {
    it(`deserialize: ${label}`, () => {
      const payload = validPayload();
      corrupt(payload);
      // Some mutations (e.g. Infinity) survive JSON only as null; the round-trip
      // still must not return a valid state.
      expect(deserialize(JSON.stringify(payload))).toBeNull();
    });
  }
});

// ---------------------------------------------------------------------------
// Seeded fuzz test
// ---------------------------------------------------------------------------

/** Required-path list: each entry is a dot-separated path from SaveData root. */
const REQUIRED_PATHS = [
  'profile',
  'profile.seed',
  'profile.warps',
  'profile.doctrines',
  'run',
  'run.rng',
  'run.rng.s',
  'run.nextId',
  'run.time',
  'run.bank',
  'run.system',
  'run.system.belts',
  'run.ships',
  'run.rocks',
  'run.pickups',
  'run.hazards',
  'run.hazards.flareTimer',
  'run.hazards.cometTimer',
  'run.contracts',
  'run.refinery',
  'run.automation',
] as const;

/** Finite-number paths that can be set to NaN or Infinity. */
const FINITE_PATHS = [
  'profile.seed',
  'run.rng.s',
  'run.nextId',
  'run.time',
  'run.hazards.flareTimer',
  'run.hazards.cometTimer',
  'run.bank.alloy',
] as const;

/** Resolve a dot-path on an object. */
function resolvePath(obj: Record<string, unknown>, path: string): [Record<string, unknown>, string] | null {
  const parts = path.split('.');
  let cur: unknown = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!cur || typeof cur !== 'object') return null;
    cur = (cur as Record<string, unknown>)[parts[i]!];
  }
  if (!cur || typeof cur !== 'object') return null;
  return [cur as Record<string, unknown>, parts[parts.length - 1]!];
}

type MutationKind =
  | 'delete'
  | 'wrong-type'
  | 'set-null'
  | 'empty-ships'
  | 'empty-belts'
  | 'dup-ship'
  | 'dup-rock'
  | 'nan'
  | 'infinity';

const KINDS: MutationKind[] = [
  'delete',
  'wrong-type',
  'set-null',
  'empty-ships',
  'empty-belts',
  'dup-ship',
  'dup-rock',
  'nan',
  'infinity',
];

function applyMutation(payload: SaveData, kind: MutationKind, rng: ReturnType<typeof makeRng>): void {
  switch (kind) {
    case 'delete': {
      const path = pick(rng, REQUIRED_PATHS);
      const r = resolvePath(payload as unknown as Record<string, unknown>, path);
      if (r) delete r[0][r[1]];
      break;
    }
    case 'wrong-type': {
      const path = pick(rng, REQUIRED_PATHS);
      const r = resolvePath(payload as unknown as Record<string, unknown>, path);
      if (r) (r[0][r[1]] as unknown) = 'corrupt-string';
      break;
    }
    case 'set-null': {
      const path = pick(rng, REQUIRED_PATHS);
      const r = resolvePath(payload as unknown as Record<string, unknown>, path);
      if (r) (r[0][r[1]] as unknown) = null;
      break;
    }
    case 'empty-ships':
      payload.run.ships = [];
      break;
    case 'empty-belts':
      payload.run.system.belts = [];
      break;
    case 'dup-ship':
      if (payload.run.ships.length > 0) payload.run.ships.push({ ...payload.run.ships[0]! });
      break;
    case 'dup-rock':
      if (payload.run.rocks.length > 0) payload.run.rocks.push({ ...payload.run.rocks[0]! });
      break;
    case 'nan': {
      const path = pick(rng, FINITE_PATHS);
      const r = resolvePath(payload as unknown as Record<string, unknown>, path);
      if (r) (r[0][r[1]] as unknown) = NaN;
      break;
    }
    case 'infinity': {
      const path = pick(rng, FINITE_PATHS);
      const r = resolvePath(payload as unknown as Record<string, unknown>, path);
      if (r) (r[0][r[1]] as unknown) = Infinity;
      break;
    }
  }
}

function runFuzz(seed: number, iterations: number): Array<'valid' | null> {
  const rng = makeRng(seed);
  const results: Array<'valid' | null> = [];

  for (let i = 0; i < iterations; i++) {
    const payload = validPayload();
    const kindIndex = int(rng, 0, KINDS.length - 1);
    const kind = KINDS[kindIndex]!;
    applyMutation(payload, kind, rng);

    // Must not throw.
    let state: ReturnType<typeof validateState> = null;
    let threw = false;
    try {
      state = validateState(payload);
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);

    // JSON-safe kinds also go through deserialize (NaN/Infinity become null in JSON).
    // Always run the check; just skip the JSON kinds that would serialise differently.
    const jsonStr = JSON.stringify(payload);
    let dsThrew = false;
    try {
      deserialize(jsonStr);
    } catch {
      dsThrew = true;
    }
    // NaN/Infinity are JSON-unsafe; deserialize wraps in try/catch and returns null, so never throws.
    expect(dsThrew).toBe(false);

    // If a state is returned, it must round-trip. Always evaluate the expression
    // so expect() is unconditional; the sentinel 'skipped' is never null.
    const roundTrip = state !== null ? deserialize(serialize(state)) : ('skipped' as const);
    expect(roundTrip).not.toBeNull();
    results.push(state !== null ? 'valid' : null);
  }
  return results;
}

describe('fuzz – seeded mutations', () => {
  const SEED = 0x5eed;
  const ITERATIONS = 200;

  it('never throws over 200 iterations', () => {
    const results = runFuzz(SEED, ITERATIONS);
    expect(results).toHaveLength(ITERATIONS);
  });

  it('deterministic: same seed → same sequence', () => {
    const a = runFuzz(SEED, ITERATIONS);
    const b = runFuzz(SEED, ITERATIONS);
    expect(a).toEqual(b);
  });

  it('explicit NaN case: validateState returns null', () => {
    const payload = validPayload();
    payload.run.hazards.flareTimer = NaN;
    expect(validateState(payload)).toBeNull();
  });

  it('explicit Infinity case: validateState returns null', () => {
    const payload = validPayload();
    payload.run.hazards.flareTimer = Infinity;
    expect(validateState(payload)).toBeNull();
  });
});
