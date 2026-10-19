import { describe, expect, it } from 'vitest';
import { COMPONENTS, defaultVariant, variantDef, type ComponentId } from '../src/data/components';
import { HULLS } from '../src/data/hulls';
import { RECIPES, RECIPE_IDS, type RecipeId } from '../src/data/refining';
import {
  emptyWallet,
  RAW_RESOURCES,
  RESOURCE_INFO,
  RESOURCES,
  walletValue,
  type Cost,
  type Wallet,
} from '../src/data/resources';
import { TUNING } from '../src/data/tuning';
import type { Command } from '../src/sim/commands';
import { newGame } from '../src/sim/create';
import { SimIndex } from '../src/sim/index';
import {
  cancelRefine,
  describeRecipe,
  jobProgress,
  maxBatches,
  newRefinery,
  queueRefine,
  queuedOutput,
  refineBlock,
  updateRefinery,
} from '../src/sim/refining';
import type { GameState, Run } from '../src/sim/types';
import { tick } from '../src/sim/update';

/** A fresh game with the bank overridden for the case at hand. */
function stateWith(bank: Partial<Wallet>): GameState {
  const state = newGame(1);
  Object.assign(state.run.bank, bank);
  return state;
}

/** Appends `n` hand-built jobs, bypassing the cost so tests can fill the queue. */
function pushJobs(run: Run, recipe: RecipeId, count: number, n = 1): void {
  for (let i = 0; i < n; i++)
    run.refinery.queue.push({ id: run.refinery.nextId++, recipe, count, total: count, progress: 0 });
}

const INPUT = { thrust: { x: 0, z: 0 }, commands: [] as Command[] };

/** Ore-equivalent value gap between two prices. */
const drift = (now: Cost, before: Cost): number => Math.abs(walletValue(now) - walletValue(before));

/** A queue with more than 30 s of work: 7 fuel batches, then 20 alloy. */
function mixedRefinery(): GameState {
  const state = stateWith({ ice: 100, ore: 100 });
  queueRefine(state.run, 'fuel', 7);
  queueRefine(state.run, 'alloy', 20);
  return state;
}

describe('refined resources', () => {
  it('lists all five kinds raw-first', () => {
    expect(RESOURCES).toEqual(['ore', 'ice', 'crystal', 'alloy', 'fuel']);
    expect(RAW_RESOURCES).not.toContain('alloy');
    expect(RAW_RESOURCES).not.toContain('fuel');
  });

  it('emptyWallet has five zero keys', () => {
    const w = emptyWallet();
    expect(Object.keys(w)).toHaveLength(5);
    for (const r of RESOURCES) expect(w[r]).toBe(0);
  });

  it('a recipe produces exactly the value it consumes', () => {
    for (const id of RECIPE_IDS) {
      const r = RECIPES[id];
      expect(walletValue(r.input) / r.output).toBeCloseTo(RESOURCE_INFO[id].value, 9);
      expect(r.time).toBeGreaterThan(0);
      expect(r.output).toBeGreaterThan(0);
    }
  });
});

describe('new run refinery', () => {
  it('starts empty with zero output and no refined bank', () => {
    const { run } = newGame(1);
    expect(run.refinery).toEqual(newRefinery());
    expect(run.refinery.queue).toEqual([]);
    expect(run.refinery.produced).toEqual({ alloy: 0, fuel: 0 });
    expect(run.bank.alloy).toBe(0);
    expect(run.bank.fuel).toBe(0);
  });

  it('never generates a refined rock kind', () => {
    const { run } = newGame(1);
    expect(run.rocks.length).toBeGreaterThan(0);
    expect(run.rocks.every((r) => RAW_RESOURCES.includes(r.kind))).toBe(true);
  });
});

describe('refineBlock validation', () => {
  it('rejects non-positive, sub-unit and non-finite counts', () => {
    const run = stateWith({ ore: 40 }).run;
    const before = JSON.stringify({ bank: run.bank, queue: run.refinery.queue });
    const bad = [0, -3, 0.9, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];
    for (const count of bad) expect(refineBlock(run, 'alloy', count)).toEqual({ error: 'Nothing to refine.' });
    expect(JSON.stringify({ bank: run.bank, queue: run.refinery.queue })).toBe(before);
  });

  it('floors the count and clamps it to refineMaxBatch', () => {
    const run = stateWith({ ore: 1e6 }).run;
    expect(refineBlock(run, 'alloy', 3.9)).toEqual({ n: 3 });
    expect(refineBlock(run, 'alloy', TUNING.refineMaxBatch + 50)).toEqual({ n: TUNING.refineMaxBatch });
  });

  it('names the first short resource in RESOURCES order', () => {
    const run = stateWith({ ore: 0, ice: 0 }).run;
    expect(refineBlock(run, 'alloy', 2)).toEqual({ error: 'Not enough ore to refine 2 alloy.' });
    expect(refineBlock(run, 'fuel', 2)).toEqual({ error: 'Not enough ice to refine 2 fuel.' });
    expect(refineBlock(run, 'alloy', 1)).toEqual({ error: 'Not enough ore to refine 1 alloy.' });
  });

  it('reports a full queue when there is nothing to merge', () => {
    const run = stateWith({ ore: 1e6 }).run;
    pushJobs(run, 'alloy', 1, TUNING.refineQueueMax);
    expect(refineBlock(run, 'fuel', 1)).toEqual({ error: 'Refinery queue is full.' });
    // The last job has the same recipe, so it merges instead.
    expect(refineBlock(run, 'alloy', 1)).toEqual({ n: 1 });
  });

  it('reports a full merge target', () => {
    const run = stateWith({ ore: 1e6 }).run;
    pushJobs(run, 'alloy', TUNING.refineMaxBatch);
    expect(refineBlock(run, 'alloy', 1)).toEqual({ error: 'That refinery job is full.' });
  });
});

describe('maxBatches', () => {
  it('counts what the bank can pay for', () => {
    expect(maxBatches(stateWith({ ore: 23 }).run, 'alloy')).toBe(5);
    expect(maxBatches(stateWith({ ice: 12 }).run, 'fuel')).toBe(2);
    expect(maxBatches(stateWith({ ore: 3 }).run, 'alloy')).toBe(0);
  });

  it('returns 0 when the queue is full', () => {
    const run = stateWith({ ore: 1e6 }).run;
    pushJobs(run, 'fuel', 1, TUNING.refineQueueMax);
    expect(maxBatches(run, 'alloy')).toBe(0);
  });

  it('is capped by the merge headroom', () => {
    const run = stateWith({ ore: 1e6 }).run;
    pushJobs(run, 'alloy', TUNING.refineMaxBatch - 2);
    expect(maxBatches(run, 'alloy')).toBe(2);
  });

  it('merges into the last job even when the queue is full', () => {
    const run = stateWith({ ore: 1e6 }).run;
    pushJobs(run, 'alloy', 1, TUNING.refineQueueMax - 1);
    pushJobs(run, 'alloy', TUNING.refineMaxBatch - 3);
    expect(run.refinery.queue).toHaveLength(TUNING.refineQueueMax);
    expect(maxBatches(run, 'alloy')).toBe(3);
  });
});

describe('queueRefine', () => {
  it('pays exactly the input cost and appends a job', () => {
    const { run } = stateWith({ ore: 40 });
    expect(queueRefine(run, 'alloy', 3)).toEqual({ queued: 3 });
    expect(run.bank.ore).toBe(40 - 3 * 4);
    expect(run.refinery.queue).toEqual([{ id: 1, recipe: 'alloy', count: 3, total: 3, progress: 0 }]);
  });

  it('merges into the last job of the same recipe, paying once per call', () => {
    const { run } = stateWith({ ore: 100 });
    queueRefine(run, 'alloy', 2);
    queueRefine(run, 'alloy', 3);
    expect(run.bank.ore).toBe(100 - 5 * 4);
    expect(run.refinery.queue).toEqual([{ id: 1, recipe: 'alloy', count: 5, total: 5, progress: 0 }]);
  });

  it('appends a different recipe as a new job', () => {
    const { run } = stateWith({ ore: 100, ice: 100 });
    queueRefine(run, 'alloy', 2);
    queueRefine(run, 'fuel', 4);
    expect(run.refinery.queue.map((j) => j.recipe)).toEqual(['alloy', 'fuel']);
    expect(run.bank.ore).toBe(100 - 8);
    expect(run.bank.ice).toBe(100 - 20);
  });

  it('floors and clamps the queued count', () => {
    const { run } = stateWith({ ore: 1e6 });
    expect(queueRefine(run, 'alloy', TUNING.refineMaxBatch + 10)).toEqual({ queued: TUNING.refineMaxBatch });
    expect(run.refinery.queue[0]!.count).toBe(TUNING.refineMaxBatch);
    expect(run.bank.ore).toBe(1e6 - TUNING.refineMaxBatch * 4);
  });

  it('leaves the bank and queue untouched when rejected', () => {
    const full = stateWith({ ore: 1e6 }).run;
    pushJobs(full, 'fuel', 1, TUNING.refineQueueMax);
    const fullBefore = JSON.stringify({ bank: full.bank, queue: full.refinery.queue });
    expect(queueRefine(full, 'alloy', 1)).toEqual({ error: 'Refinery queue is full.' });
    expect(JSON.stringify({ bank: full.bank, queue: full.refinery.queue })).toBe(fullBefore);

    const poor = stateWith({ ore: 3 }).run;
    const poorBefore = JSON.stringify({ bank: poor.bank, queue: poor.refinery.queue });
    expect(queueRefine(poor, 'alloy', 1)).toEqual({ error: 'Not enough ore to refine 1 alloy.' });
    expect(JSON.stringify({ bank: poor.bank, queue: poor.refinery.queue })).toBe(poorBefore);

    const nan = stateWith({ ore: 1e6 }).run;
    const nanBefore = JSON.stringify({ bank: nan.bank, queue: nan.refinery.queue });
    for (const count of [Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(queueRefine(nan, 'alloy', count)).toEqual({ error: 'Nothing to refine.' });
    }
    expect(JSON.stringify({ bank: nan.bank, queue: nan.refinery.queue })).toBe(nanBefore);
  });
});

describe('cancelRefine', () => {
  it('refunds every unfinished batch', () => {
    const state = stateWith({ ore: 40 });
    const { run } = state;
    queueRefine(run, 'alloy', 5);
    updateRefinery(state, 4); // alloy takes 2 s per batch: 2 of 5 done.
    expect(run.refinery.queue[0]!.count).toBe(3);

    const job = cancelRefine(run, run.refinery.queue[0]!.id);

    expect(job).toEqual({ id: 1, recipe: 'alloy', count: 3, total: 5, progress: 0 });
    expect(run.refinery.queue).toHaveLength(0);
    expect(run.bank.ore).toBe(40 - 5 * 4 + 3 * 4);
    expect(run.bank.alloy).toBe(2);
  });

  it('returns null for an id that is not queued', () => {
    const { run } = stateWith({ ore: 40 });
    expect(cancelRefine(run, 1)).toBeNull();
    expect(cancelRefine(run, -1)).toBeNull();
  });

  it('cancels by id even after the queue has shifted', () => {
    // The HUD sends the id it last rendered; the front job may finish first.
    const state = stateWith({ ore: 100, ice: 100 });
    const { run } = state;
    queueRefine(run, 'alloy', 1);
    queueRefine(run, 'fuel', 2);
    queueRefine(run, 'alloy', 3);
    const fuelId = run.refinery.queue[1]!.id;
    updateRefinery(state, 2); // the single alloy batch finishes and leaves the queue

    expect(cancelRefine(run, fuelId)?.recipe).toBe('fuel');
    expect(run.refinery.queue.map((j) => j.recipe)).toEqual(['alloy']);
  });
});

describe('updateRefinery', () => {
  it('produces nothing just before the batch time and one unit at it', () => {
    const early = stateWith({ ice: 100 });
    queueRefine(early.run, 'fuel', 1);
    updateRefinery(early, RECIPES.fuel.time - 1e-6);
    expect(early.run.bank.fuel).toBe(0);
    expect(early.run.refinery.produced.fuel).toBe(0);
    expect(early.run.refinery.queue[0]!.count).toBe(1);

    const onTime = stateWith({ ice: 100 });
    queueRefine(onTime.run, 'fuel', 1);
    updateRefinery(onTime, RECIPES.fuel.time);
    expect(onTime.run.bank.fuel).toBe(1);
    expect(onTime.run.refinery.produced.fuel).toBe(1);
    expect(onTime.run.refinery.queue).toHaveLength(0);
  });

  it('carries leftover time across batches', () => {
    const state = stateWith({ ice: 100 });
    queueRefine(state.run, 'fuel', 3);
    updateRefinery(state, 1.25);
    expect(state.run.bank.fuel).toBe(2);
    expect(state.run.refinery.produced.fuel).toBe(2);
    expect(state.run.refinery.queue[0]!.count).toBe(1);
    expect(state.run.refinery.queue[0]!.progress).toBeCloseTo(0.25, 9);
  });

  it('carries leftover time across jobs', () => {
    const state = stateWith({ ice: 100, ore: 100 });
    queueRefine(state.run, 'fuel', 1);
    queueRefine(state.run, 'alloy', 1);
    updateRefinery(state, 1.5);
    expect(state.run.bank.fuel).toBe(1);
    expect(state.run.refinery.queue).toHaveLength(1);
    expect(state.run.refinery.queue[0]!.recipe).toBe('alloy');
    expect(state.run.refinery.queue[0]!.progress).toBeCloseTo(1, 9);
  });

  it('gives one big dt the same result as many small ones', () => {
    const big = mixedRefinery();
    updateRefinery(big, 30);
    const small = mixedRefinery();
    for (let i = 0; i < 30 * 60; i++) updateRefinery(small, 1 / 60);

    for (const r of RESOURCES) expect(big.run.bank[r]).toBeCloseTo(small.run.bank[r], 9);
    for (const id of RECIPE_IDS) expect(big.run.refinery.produced[id]).toBeCloseTo(small.run.refinery.produced[id], 9);

    // 30 s finishes the fuel and part of the alloy, so a partial job must match too.
    expect(big.run.refinery.queue).toHaveLength(1);
    expect(small.run.refinery.queue).toHaveLength(1);
    expect(big.run.refinery.queue[0]!.count).toBe(7);
    expect(big.run.refinery.queue[0]!.count).toBe(small.run.refinery.queue[0]!.count);
    expect(big.run.refinery.queue[0]!.progress).toBeCloseTo(small.run.refinery.queue[0]!.progress, 9);
  });

  it('drops a front job with a non-positive count without producing', () => {
    const state = stateWith({ ice: 100 });
    const { run } = state;
    run.refinery.queue.push({ id: 1, recipe: 'fuel', count: 0, total: 2, progress: 0 });
    run.refinery.queue.push({ id: 2, recipe: 'fuel', count: 2, total: 2, progress: 0 });
    run.refinery.nextId = 3;

    updateRefinery(state, 0.25);

    expect(run.refinery.queue.map((j) => j.count)).toEqual([2]);
    expect(run.refinery.queue[0]!.progress).toBeCloseTo(0.25, 9);
    expect(run.bank.fuel).toBe(0);
    expect(run.refinery.produced.fuel).toBe(0);
  });

  it('never touches the run rng or the prestige value', () => {
    const state = stateWith({ ice: 100, ore: 100 });
    const seed = state.run.rng.s;
    const value = state.run.runValue;
    queueRefine(state.run, 'fuel', 3);
    queueRefine(state.run, 'alloy', 2);
    updateRefinery(state, 30);
    expect(state.run.rng.s).toBe(seed);
    expect(state.run.runValue).toBe(value);
  });

  it('logs exactly one info line per finished job', () => {
    const state = stateWith({ ice: 100, ore: 100 });
    queueRefine(state.run, 'fuel', 1);
    queueRefine(state.run, 'fuel', 2); // merges into the fuel job.
    queueRefine(state.run, 'alloy', 2);
    state.out.log.length = 0;

    updateRefinery(state, 100);

    expect(state.out.log).toHaveLength(2);
    expect(state.out.log[0]!.level).toBe('info');
    expect(state.out.log[0]!.text).toBe('Refinery: 3◉ fuel ready.');
    expect(state.out.log[1]!.text).toBe('Refinery: 2▣ alloy ready.');
  });
});

describe('refinery HUD helpers', () => {
  it('describes a recipe', () => {
    expect(describeRecipe('alloy')).toBe('4⬢ → 1▣ · 2s');
    expect(describeRecipe('fuel')).toBe('5❄ → 1◉ · 0.5s');
  });

  it('reports batch progress clamped to [0, 1]', () => {
    expect(jobProgress({ id: 1, recipe: 'alloy', count: 1, total: 1, progress: 0 })).toBe(0);
    expect(jobProgress({ id: 1, recipe: 'alloy', count: 1, total: 1, progress: 1 })).toBe(0.5);
    expect(jobProgress({ id: 1, recipe: 'alloy', count: 1, total: 1, progress: 5 })).toBe(1);
  });

  it('sums the queued output of one recipe', () => {
    const { run } = stateWith({ ice: 100, ore: 100 });
    queueRefine(run, 'fuel', 3);
    queueRefine(run, 'fuel', 2);
    queueRefine(run, 'alloy', 4);
    expect(queuedOutput(run, 'fuel')).toBe(5);
    expect(queuedOutput(run, 'alloy')).toBe(4);
    expect(queuedOutput(run, 'alloy')).toBe(run.refinery.queue[1]!.count * RECIPES.alloy.output);
  });
});

describe('refinery in the tick', () => {
  it('advances the queue as the sim runs', () => {
    const state = stateWith({ ice: 100 });
    queueRefine(state.run, 'fuel', 3);
    const index = new SimIndex();
    for (let t = 0; t < 72; t++) tick(state, 1 / 60, INPUT, index);

    expect(state.run.bank.fuel).toBe(2);
    expect(state.run.refinery.produced.fuel).toBe(2);
    expect(state.run.refinery.queue[0]!.count).toBe(1);
  });
});

describe('cost table', () => {
  // Pre-refining prices, kept as literals so the rebalance is deliberate: Task 7
  // tuning must change these on purpose, not by drift.
  const T1: Record<ComponentId, Cost> = {
    laser: { ore: 31 },
    engine: { ore: 25 },
    shield: { ore: 25 },
    armor: { ore: 25 },
    cargo: { ore: 20 },
    sensor: { ore: 23 },
  };
  const T2: Record<ComponentId, Cost> = {
    laser: { ore: 150, ice: 50 },
    engine: { ore: 120, ice: 40 },
    shield: { ore: 120, ice: 40 },
    armor: { ore: 120, ice: 40 },
    cargo: { ore: 96, ice: 32 },
    sensor: { ore: 108, ice: 36 },
  };
  const OLD_T3: Record<ComponentId, Cost> = {
    laser: { ore: 525, ice: 200, crystal: 23 },
    engine: { ore: 420, ice: 160, crystal: 18 },
    shield: { ore: 420, ice: 160, crystal: 18 },
    armor: { ore: 420, ice: 160, crystal: 18 },
    cargo: { ore: 336, ice: 128, crystal: 14 },
    sensor: { ore: 378, ice: 144, crystal: 16 },
  };
  const ids = Object.keys(COMPONENTS) as ComponentId[];

  it('keeps every tier-1 and tier-2 price and the drone price unchanged', () => {
    for (const id of ids) {
      expect(variantDef(id, defaultVariant(id)).cost(1)).toEqual(T1[id]);
      expect(variantDef(id, defaultVariant(id)).cost(2)).toEqual(T2[id]);
    }
    expect(HULLS.drone.cost).toEqual({ ore: 80, ice: 25 });
  });

  it('prices every tier-3 component variant and the big hulls in alloy', () => {
    for (const id of ids) for (const v of COMPONENTS[id].variants) expect(v.cost(3).alloy ?? 0).toBeGreaterThan(0);
    expect(HULLS.excavator.cost.alloy ?? 0).toBeGreaterThan(0);
    expect(HULLS.harvester.cost.alloy ?? 0).toBeGreaterThan(0);
  });

  it('moves value rather than adding it: moved prices keep their ore-equivalent value', () => {
    for (const id of ids) expect(drift(variantDef(id, defaultVariant(id)).cost(3), OLD_T3[id])).toBe(0);
    expect(drift(HULLS.excavator.cost, { ore: 900, ice: 300 })).toBe(0);
    expect(drift(HULLS.harvester.cost, { ore: 350, ice: 120 })).toBe(0);
  });
});
