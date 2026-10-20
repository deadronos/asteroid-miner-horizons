// First-steps checklist (#171): which onboarding goals are done, which one is
// next, and a hint for whatever is blocking the player right now. Pure reads of
// GameState, so the HUD only renders the result. Progress comes from lifetime
// stats, plus `run.runValue` for the first unload; the checklist only ever
// shows before the first warp, so a per-run value is enough there.

import { RECIPES } from '../data/refining';
import { warpCost } from '../sim/economy';
import { flagship, isAlive, isFlagship, isHauler, isHoldFull, shipStats } from '../sim/ships';
import type { GameState } from '../sim/types';

export type GoalId = 'mine' | 'unload' | 'install' | 'drone' | 'contract' | 'warp';

/** Units the first goal asks for. */
export const MINE_GOAL = 20;

export interface GoalDef {
  id: GoalId;
  label: string;
  /** One line on how to do it, shown under the current goal. */
  how: string;
}

/** The checklist, in the order a new player meets each step. */
export const GOALS: readonly GoalDef[] = [
  { id: 'mine', label: `Mine ${MINE_GOAL} units`, how: 'Click an asteroid, then fly over the debris to collect it.' },
  { id: 'unload', label: 'Dock and unload', how: 'Click the station to fly home and unload your hold.' },
  {
    id: 'install',
    label: 'Install a component',
    how: 'While docked, fit a part into an empty slot in the ship panel.',
  },
  { id: 'drone', label: 'Buy a drone', how: 'Buy a Mining Drone from the shipyard in the fleet panel.' },
  {
    id: 'contract',
    label: 'Complete a contract',
    how: 'Accept an offer in the contracts panel, then meet its goal in time.',
  },
  { id: 'warp', label: 'Warp to a new system', how: 'Refine ice into fuel, then press WARP in the top bar.' },
];

/** True once goal `id` is met. */
export function goalDone(state: GameState, id: GoalId): boolean {
  const { stats } = state.profile;
  switch (id) {
    case 'mine':
      return stats.unitsMined >= MINE_GOAL;
    case 'unload':
      return state.run.runValue > 0 || stats.warps > 0;
    case 'install':
      return stats.installs > 0;
    case 'drone':
      return stats.drones > 0;
    case 'contract':
      return stats.contracts > 0;
    case 'warp':
      return stats.warps > 0;
  }
}

/** True while the checklist should show: not dismissed, and the first warp (the last goal) not yet made. */
export function goalsVisible(state: GameState): boolean {
  return !state.profile.goalsDismissed && state.profile.stats.warps === 0;
}

/** The first goal not yet met, or null when all are. */
export function currentGoal(state: GameState): GoalDef | null {
  return GOALS.find((g) => !goalDone(state, g.id)) ?? null;
}

/** Progress text for a goal that counts, e.g. "12/20"; null for yes/no goals. */
export function goalProgress(state: GameState, id: GoalId): string | null {
  if (id === 'mine') return `${Math.min(MINE_GOAL, Math.floor(state.profile.stats.unitsMined))}/${MINE_GOAL}`;
  if (id === 'contract' && state.run.contracts.active && state.profile.stats.contracts === 0) {
    const c = state.run.contracts.active;
    return `${Math.floor(c.progress)}/${c.target}`;
  }
  if (id === 'warp') return `${Math.floor(state.run.bank.fuel)}/${warpCost(state)} fuel`;
  return null;
}

/**
 * The most pressing blocker, or null when nothing is in the way. In order: the
 * flagship is being rebuilt · it has no mining laser · its hold is full · a
 * mining drone has nothing to do · the warp is next but the bank lacks fuel.
 */
export function goalHint(state: GameState): string | null {
  const { run, profile } = state;
  const fs = flagship(run);
  if (!isAlive(fs)) return `${fs.name} is being rebuilt at the station.`;
  const st = shipStats(fs, profile);
  if (st.dps <= 0) return 'No mining laser fitted: dock and install one in the ship panel.';
  if (isHoldFull(fs, st) && fs.order?.kind !== 'dock') return 'Hold full: click the station to unload.';
  for (const s of run.ships) {
    if (isFlagship(s) || isHauler(s) || !isAlive(s) || s.order) continue;
    if (s.beamOn || s.aiTargetId != null || shipStats(s, profile).dps <= 0) continue;
    if (isHoldFull(s, shipStats(s, profile))) continue;
    return s.aiMode === 'assist'
      ? `${s.name} is idle: fly near asteroids, or set it to AUTO in the fleet panel.`
      : `${s.name} is idle: no asteroids near the station. Set it to ASSIST to follow you.`;
  }
  if (currentGoal(state)?.id === 'warp') {
    const need = warpCost(state) - run.bank.fuel;
    if (need > 0) {
      const ice = (RECIPES.fuel.input.ice ?? 0) / RECIPES.fuel.output;
      return `Warp needs ${Math.ceil(need)} more fuel: refine it from ice (${ice} each) in the refinery panel.`;
    }
  }
  return null;
}
