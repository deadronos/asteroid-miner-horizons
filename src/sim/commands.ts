// Player intent → state changes. Input and UI never mutate GameState
// directly; they enqueue Commands that the sim applies at the start of a tick.
// Invalid commands are rejected with a log line explaining why.
//
// The per-variant logic lives in `handlers.ts`; this module owns the Command
// union (imported from here across the app) and the dispatch into the map.

import type { Vec2 } from '../core/vec';
import type { ComponentId, VariantId } from '../data/components';
import type { HullId } from '../data/hulls';
import type { PerkId } from '../data/perks';
import type { RecipeId } from '../data/refining';
import { handlers } from './handlers';
import type { AiMode, GameState } from './types';

export type Command =
  | { t: 'select'; shipId: number }
  | { t: 'move'; shipId: number; to: Vec2 }
  | { t: 'mine'; shipId: number; rockId: number }
  | { t: 'dock'; shipId: number }
  | { t: 'stop'; shipId: number }
  | { t: 'aiMode'; shipId: number; mode: AiMode }
  | { t: 'shipAuto'; shipId: number; kind: 'repair' | 'upgrade' | 'build'; on: boolean }
  | { t: 'install'; shipId: number; slot: number; comp: ComponentId; variant: VariantId }
  | { t: 'upgrade'; shipId: number; slot: number }
  | { t: 'remove'; shipId: number; slot: number }
  | { t: 'buySlot'; shipId: number }
  | { t: 'repair'; shipId: number }
  | { t: 'buyHull'; hullId: HullId }
  | { t: 'scrap'; shipId: number }
  | { t: 'buyPerk'; perk: PerkId }
  | { t: 'warp'; route: number }
  | { t: 'refine'; recipe: RecipeId; count: number }
  | { t: 'cancelRefine'; jobId: number }
  | { t: 'acceptContract'; contractId: number }
  | { t: 'abandonContract' }
  | { t: 'deployOutpost'; rockId: number }
  | { t: 'dismissGoals' };

export function applyCommand(state: GameState, cmd: Command): void {
  // One cast: `handlers` is a mapped type, so `handlers[cmd.t]` is the handler for
  // exactly cmd's narrowed variant; TS just cannot correlate a union index with a
  // union value, so the correlation is asserted here and is safe by construction.
  (handlers[cmd.t] as (s: GameState, c: Command) => void)(state, cmd);
}
