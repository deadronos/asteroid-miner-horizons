// Shared sim drivers for tests: step the tick at the fixed DT with an idle
// thrust, and apply a single command directly.

import type { HazardLevel } from '../src/data/hazards';
import { TUNING } from '../src/data/tuning';
import type { Assists } from '../src/sim/assists';
import { applyCommand, type Command } from '../src/sim/commands';
import { SimIndex } from '../src/sim/index';
import type { GameState } from '../src/sim/types';
import { tick, type TickInput } from '../src/sim/update';

export const DT = 1 / TUNING.simHz;

export interface RunOpts {
  /** Queued for the first tick (the tick drains the array). */
  commands?: Command[];
  hazards?: HazardLevel;
  assists?: Assists;
  /** Index to tick with; a fresh one by default. Pass one to keep it across calls. */
  index?: SimIndex;
}

function inputFor(opts: RunOpts): TickInput {
  return { thrust: { x: 0, z: 0 }, commands: opts.commands ?? [], assists: opts.assists, hazards: opts.hazards };
}

/** Runs exactly `n` ticks. */
export function runTicks(state: GameState, n: number, opts: RunOpts = {}): void {
  const input = inputFor(opts);
  const index = opts.index ?? new SimIndex();
  for (let i = 0; i < n; i++) tick(state, DT, input, index);
}

/**
 * Runs ticks while accumulated sim time is below `seconds` (`t += DT`), so float
 * drift can add one tick over `seconds / DT`; use `runTicks` for an exact count.
 */
export function runFor(state: GameState, seconds: number, opts: RunOpts = {}): void {
  const input = inputFor(opts);
  const index = opts.index ?? new SimIndex();
  for (let t = 0; t < seconds; t += DT) tick(state, DT, input, index);
}

/** Applies one command immediately, outside a tick. */
export const send = (state: GameState, cmd: Command): void => applyCommand(state, cmd);
