// Station refinery: the queue, its validation and the tick that turns ore into
// alloy and ice into fuel. Pure and deterministic; refining never draws from
// run.rng and never touches run.runValue. The furnace and hopper perks (#84)
// shorten each cycle and let one cycle finish several batches.

import { RECIPES, type RecipeId } from '../data/refining';
import {
  credit,
  formatCost,
  pay,
  RESOURCES,
  RESOURCE_INFO,
  type Cost,
  type Resource,
  type Wallet,
} from '../data/resources';
import { TUNING } from '../data/tuning';
import type { GameState, Profile, RefineJob, Refinery, Run } from './types';

/** Seconds one refinery cycle of `recipe` takes, after the furnace perk. */
export const cycleTime = (recipe: RecipeId, profile: Profile): number =>
  RECIPES[recipe].time / (1 + TUNING.furnaceSpeedPerLevel * profile.perks.furnace);

/** A job as log text, e.g. "3 × alloy". */
export const jobLabel = (recipe: RecipeId, count: number): string => `${count} × ${RECIPES[recipe].name.toLowerCase()}`;

/** Batches one refinery cycle finishes from the front job, after the hopper perk. */
export const batchesPerCycle = (profile: Profile): number => 1 + profile.perks.hopper;

/** Fresh refinery: empty queue, no lifetime output. */
export function newRefinery(): Refinery {
  return { queue: [], nextId: 1, produced: { alloy: 0, fuel: 0 } };
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

/** How many more batches of `recipe` the queue can take right now, or why none will fit. */
function queueRoom(queue: readonly RefineJob[], recipe: RecipeId): { cap: number } | { error: string } {
  const last = queue[queue.length - 1];
  if (last && last.recipe === recipe) {
    // Clamp to the per-job cap too, so a hand-edited save with a
    // non-positive count cannot report more room than a fresh job has.
    const cap = Math.min(TUNING.refineMaxBatch, TUNING.refineMaxBatch - last.count);
    return cap < 1 ? { error: 'That refinery job is full.' } : { cap };
  }
  if (queue.length >= TUNING.refineQueueMax) return { error: 'Refinery queue is full.' };
  return { cap: TUNING.refineMaxBatch };
}

/**
 * Validates a queued refine without mutating: the clamped batch count, or a
 * reason. The sim command and the HUD buttons share this rule.
 */
export function refineBlock(run: Run, recipe: RecipeId, count: number): { n: number } | { error: string } {
  const queue = run.refinery.queue;
  const floored = Math.floor(count);
  if (!Number.isFinite(floored) || floored < 1) return { error: 'Nothing to refine.' };
  const room = queueRoom(queue, recipe);
  if ('error' in room) return room;
  const n = Math.min(floored, room.cap);
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
    queue.push({ id: run.refinery.nextId++, recipe, count: n, total: n, progress: 0 });
  }
  return { queued: n };
}

/** Largest batch count `refineBlock` would accept right now; 0 when nothing can be queued. */
export function maxBatches(run: Run, recipe: RecipeId): number {
  const room = queueRoom(run.refinery.queue, recipe);
  if ('error' in room) return 0;
  let cap = room.cap;
  const input = RECIPES[recipe].input;
  for (const r of RESOURCES) {
    const per = input[r] ?? 0;
    if (per > 0) cap = Math.min(cap, Math.floor((run.bank[r] + 1e-9) / per));
  }
  return Math.max(0, cap);
}

/** The queued job with `id`, or undefined when it has finished or been cancelled. */
export const findJob = (run: Run, id: number): RefineJob | undefined => run.refinery.queue.find((j) => j.id === id);

/** Removes the job with `id` and refunds every unfinished batch; null when it is no longer queued. */
export function cancelRefine(run: Run, id: number): RefineJob | null {
  const queue = run.refinery.queue;
  const job = findJob(run, id);
  if (!job) return null;
  const index = queue.indexOf(job);
  queue.splice(index, 1);
  const cost = batchCost(job.recipe, job.count);
  credit(run.bank, cost);
  return job;
}

/**
 * Spends a `dt` time budget on the front job, carrying leftover time across
 * cycles and jobs. A cycle finishes up to `batchesPerCycle` of the job's
 * batches at once. Called once per tick, after the contracts.
 */
export function updateRefinery(state: GameState, dt: number): void {
  const { run, profile } = state;
  const queue = run.refinery.queue;
  const perCycle = batchesPerCycle(profile);
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
    const need = Math.max(0, cycleTime(job.recipe, profile) - job.progress);
    if (budget >= need) {
      budget -= need;
      const done = Math.min(perCycle, job.count);
      run.bank[job.recipe] += def.output * done;
      run.refinery.produced[job.recipe] += def.output * done;
      profile.stats.refined += def.output * done;
      job.count -= done;
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

/** HUD label for a recipe with `profile`'s perks applied, e.g. `4⬢ → 1▣ · 2s` or `4⬢ → 1▣ · 1.6s · ×2`. */
export function describeRecipe(id: RecipeId, profile: Profile): string {
  const def = RECIPES[id];
  const t = Math.round(cycleTime(id, profile) * 100) / 100;
  const n = batchesPerCycle(profile);
  return `${formatCost(def.input)} → ${def.output}${RESOURCE_INFO[id].icon} · ${t}s${n > 1 ? ` · ×${n}` : ''}`;
}

/** Fraction of the current cycle finished, clamped to [0, 1]. */
export function jobProgress(job: RefineJob, profile: Profile): number {
  return Math.min(1, Math.max(0, job.progress / cycleTime(job.recipe, profile)));
}

/** Output units still coming from queued jobs of `recipe`. */
export function queuedOutput(run: Run, recipe: RecipeId): number {
  let total = 0;
  for (const job of run.refinery.queue) if (job.recipe === recipe) total += job.count * RECIPES[recipe].output;
  return total;
}
