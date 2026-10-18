// Station refinery: the queue, its validation and the tick that turns ore into
// alloy and ice into fuel. Pure and deterministic; refining never draws from
// run.rng and never touches run.runValue.

import { RECIPES, type RecipeId } from '../data/refining';
import { formatCost, pay, RESOURCES, RESOURCE_INFO, type Cost, type Resource, type Wallet } from '../data/resources';
import { TUNING } from '../data/tuning';
import type { GameState, RefineJob, Refinery, Run } from './types';

/** Fresh refinery: empty queue, no lifetime output. */
export function newRefinery(): Refinery {
  return { queue: [], produced: { alloy: 0, fuel: 0 } };
}

/** Bank cost of `n` batches of `recipe`, omitting empty entries. */
export function batchCost(recipe: RecipeId, n: number): Cost {
  const input = RECIPES[recipe].input;
  const cost: Cost = {};
  for (const r of RESOURCES) {
    const per = input[r] ?? 0;
    if (per > 0) cost[r] = per * n;
  }
  return cost;
}

/** First resource in `bank` short of `cost` (in RESOURCES order), or null when affordable. */
function shortOf(bank: Wallet, cost: Cost): Resource | null {
  for (const r of RESOURCES) if (bank[r] + 1e-9 < (cost[r] ?? 0)) return r;
  return null;
}

/**
 * Validates a queued refine without mutating: the clamped batch count, or a
 * reason. The sim command and the HUD buttons share this rule.
 */
export function refineBlock(run: Run, recipe: RecipeId, count: number): { n: number } | { error: string } {
  const queue = run.refinery.queue;
  const floored = Math.floor(count);
  if (!Number.isFinite(floored) || floored < 1) return { error: 'Nothing to refine.' };
  let n = Math.min(floored, TUNING.refineMaxBatch);
  const last = queue[queue.length - 1];
  if (last && last.recipe === recipe) {
    // Merging must not push the job past the per-job batch cap.
    n = Math.min(n, TUNING.refineMaxBatch - last.count);
    if (n < 1) return { error: 'That refinery job is full.' };
  } else if (queue.length >= TUNING.refineQueueMax) {
    return { error: 'Refinery queue is full.' };
  }
  const short = shortOf(run.bank, batchCost(recipe, n));
  if (short) {
    const res = RESOURCE_INFO[short].name.toLowerCase();
    return { error: `Not enough ${res} to refine ${n} ${RESOURCE_INFO[recipe].name.toLowerCase()}.` };
  }
  return { n };
}

/**
 * Pays the inputs and appends the batches to the last job when its recipe
 * matches, otherwise pushes a new job. A rejection leaves the run untouched.
 */
export function queueRefine(run: Run, recipe: RecipeId, count: number): { queued: number } | { error: string } {
  const block = refineBlock(run, recipe, count);
  if ('error' in block) return block;
  const n = block.n;
  if (!pay(run.bank, batchCost(recipe, n))) return { error: 'Not enough resources to refine.' };
  const queue = run.refinery.queue;
  const last = queue[queue.length - 1];
  if (last && last.recipe === recipe) {
    last.count += n;
    last.total += n;
  } else {
    queue.push({ recipe, count: n, total: n, progress: 0 });
  }
  return { queued: n };
}

/** Largest batch count `refineBlock` would accept right now; 0 when nothing can be queued. */
export function maxBatches(run: Run, recipe: RecipeId): number {
  const queue = run.refinery.queue;
  const last = queue[queue.length - 1];
  let cap: number = TUNING.refineMaxBatch;
  if (last && last.recipe === recipe) cap = Math.min(cap, TUNING.refineMaxBatch - last.count);
  else if (queue.length >= TUNING.refineQueueMax) return 0;
  const input = RECIPES[recipe].input;
  for (const r of RESOURCES) {
    const per = input[r] ?? 0;
    if (per > 0) cap = Math.min(cap, Math.floor((run.bank[r] + 1e-9) / per));
  }
  return Math.max(0, cap);
}

/** Removes the job at `index` and refunds every unfinished batch; null when out of range. */
export function cancelRefine(run: Run, index: number): RefineJob | null {
  const queue = run.refinery.queue;
  const job = queue[index];
  if (!job) return null;
  queue.splice(index, 1);
  const cost = batchCost(job.recipe, job.count);
  for (const r of RESOURCES) run.bank[r] += cost[r] ?? 0;
  return job;
}

/**
 * Spends a `dt` time budget on the front job, carrying leftover time across
 * batches and jobs. Called once per tick, after the contracts.
 */
export function updateRefinery(state: GameState, dt: number): void {
  const { run } = state;
  const queue = run.refinery.queue;
  let budget = dt;
  while (budget > 0 && queue.length > 0) {
    const job = queue[0]!;
    // A hand-edited save can carry a non-positive count; drop it rather than
    // producing output forever.
    if (job.count <= 0) {
      queue.shift();
      continue;
    }
    const def = RECIPES[job.recipe];
    const need = def.time - job.progress;
    if (budget >= need) {
      budget -= need;
      run.bank[job.recipe] += def.output;
      run.refinery.produced[job.recipe] += def.output;
      job.count -= 1;
      job.progress = 0;
      if (job.count === 0) {
        queue.shift();
        const icon = RESOURCE_INFO[job.recipe].icon;
        const name = RESOURCE_INFO[job.recipe].name.toLowerCase();
        state.out.log.push({ level: 'info', text: `Refinery: ${job.total * def.output}${icon} ${name} ready.` });
      }
    } else {
      job.progress += budget;
      budget = 0;
    }
  }
}

/** HUD label for a recipe, e.g. `4⬢ → 1▣ · 2s`. */
export function describeRecipe(id: RecipeId): string {
  const def = RECIPES[id];
  return `${formatCost(def.input)} → ${def.output}${RESOURCE_INFO[id].icon} · ${def.time}s`;
}

/** Fraction of the current batch finished, clamped to [0, 1]. */
export function jobProgress(job: RefineJob): number {
  return Math.min(1, Math.max(0, job.progress / RECIPES[job.recipe].time));
}

/** Output units still coming from queued jobs of `recipe`. */
export function queuedOutput(run: Run, recipe: RecipeId): number {
  let total = 0;
  for (const job of run.refinery.queue) if (job.recipe === recipe) total += job.count * RECIPES[recipe].output;
  return total;
}
