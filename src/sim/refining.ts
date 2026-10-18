// Station refinery state construction. Pure and deterministic; refining never
// draws from run.rng and never touches run.runValue.

import type { Refinery } from './types';

/** Fresh refinery: empty queue, no lifetime output. */
export function newRefinery(): Refinery {
  return { queue: [], produced: { alloy: 0, fuel: 0 } };
}
