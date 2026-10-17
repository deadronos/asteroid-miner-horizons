// Headless run loop shared by the bench and balance scripts: the bot decides
// every BOT_EVERY ticks, the sim steps at its fixed 60 Hz, and the transient
// outbox (fx, log) is drained so long runs don't grow memory.

import { TUNING } from '../src/data/tuning';
import type { Command } from '../src/sim/commands';
import { SimIndex } from '../src/sim/index';
import type { GameState } from '../src/sim/types';
import { tick, type TickInput } from '../src/sim/update';
import { botCommands, type BotOptions } from './bot';

export const DT = 1 / TUNING.simHz;
/** Bot reaction time: 15 ticks = 0.25 s. */
const BOT_EVERY = 15;

export interface RunOptions extends BotOptions {
  /** Sim seconds to run at most. */
  seconds: number;
  /** Called around every tick; return true from `after` to stop early. */
  before?: (state: GameState) => void;
  after?: (state: GameState) => boolean | void;
  /** Wraps the tick call itself (the bench times it). */
  step?: (run: () => void) => void;
}

/** Runs the bot for up to `seconds` of sim time. Returns the sim seconds actually run. */
export function runBot(state: GameState, opts: RunOptions): number {
  const commands: Command[] = [];
  const input: TickInput = { thrust: { x: 0, z: 0 }, commands };
  const ticks = Math.round(opts.seconds * TUNING.simHz);
  const index = new SimIndex();
  const doTick = (): void => tick(state, DT, input, index);
  for (let i = 0; i < ticks; i++) {
    if (i % BOT_EVERY === 0) commands.push(...botCommands(state, opts));
    opts.before?.(state);
    if (opts.step) opts.step(doTick);
    else doTick();
    state.out.fx.length = 0;
    state.out.log.length = 0;
    if (opts.after?.(state)) return (i + 1) * DT;
  }
  return ticks * DT;
}
