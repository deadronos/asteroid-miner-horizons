// First-steps checklist (#171): which onboarding goals are done, which one is
// next, and a hint for whatever is blocking the player right now. Pure reads of
// GameState (plus the player's assist settings), so the HUD only renders the
// result. Every goal is a lifetime stat.

import { dist } from '../core/vec';
import { HULLS } from '../data/hulls';
import { RECIPES } from '../data/refining';
import { TUNING } from '../data/tuning';
import { DEFAULT_ASSISTS, DEFAULT_FLEET_AUTO, type Assists, type FleetAuto } from '../sim/assists';
import { warpCost } from '../sim/economy';
import { needsRepair } from '../sim/fleetAuto';
import { flagship, isAlive, isHoldFull, shipStats, type ShipStats } from '../sim/ships';
import { canMine } from '../sim/traits';
import type { GameState, Ship } from '../sim/types';

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
      return stats.unloads > 0;
    case 'install':
      return stats.installs > 0;
    case 'drone':
      return stats.miningDrones > 0;
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

/** The player settings the drone hints depend on; the defaults match a fresh install. */
export interface HintEnv {
  assists: Pick<Assists, 'autoDock'>;
  auto: FleetAuto;
}

const DEFAULT_ENV: HintEnv = { assists: DEFAULT_ASSISTS, auto: DEFAULT_FLEET_AUTO };

/**
 * True when a mining drone with no order genuinely has nothing to do: it is not dodging a hazard or flying home
 * for repairs, and there is neither debris nor a rock it can mine within its leash of its anchor (the flagship
 * in assist mode, the station in auto mode). Mirrors the drone brain's choices without its per-tick target.
 */
function droneIdle(state: GameState, ship: Ship, st: ShipStats, auto: FleetAuto): boolean {
  const { run } = state;
  if (run.hazards.comet || run.hazards.flare || needsRepair(ship, st, auto)) return false;
  const fs = flagship(run);
  const anchor = ship.aiMode === 'assist' && isAlive(fs) ? fs.pos : run.system.station.pos;
  const leash = TUNING.droneLeash;
  if (run.pickups.some((p) => dist(p.pos, anchor) < leash)) return false;
  const hosts = run.automation.outposts;
  return !run.rocks.some((r) => dist(r.pos, anchor) < leash && canMine(st, r) && !hosts.some((o) => o.rockId === r.id));
}

/**
 * The most pressing blocker, or null when nothing is in the way. In order: the
 * flagship is being rebuilt · it has no mining laser · its hold is full · a
 * mining drone is parked full waiting for a dock order (auto-dock off) · a
 * mining drone has nothing to do · the warp is next but the bank lacks fuel.
 */
export function goalHint(state: GameState, env: HintEnv = DEFAULT_ENV): string | null {
  const { run, profile } = state;
  const fs = flagship(run);
  if (!isAlive(fs)) return `${fs.name} is being rebuilt at the station.`;
  const st = shipStats(fs, profile);
  if (st.dps <= 0) return 'No mining laser fitted: dock and install one in the ship panel.';
  if (isHoldFull(fs, st) && fs.order?.kind !== 'dock') return 'Hold full: click the station to unload.';
  let idle: Ship | null = null;
  for (const s of run.ships) {
    if (HULLS[s.hullId].role !== 'drone' || !isAlive(s) || s.order) continue;
    const ds = shipStats(s, profile);
    if (ds.dps <= 0) continue;
    if (isHoldFull(s, ds)) {
      if (!env.assists.autoDock) return `${s.name} hold full: order it to dock, or turn on auto-dock (⚙ → Gameplay).`;
      continue;
    }
    if (!idle && droneIdle(state, s, ds, env.auto)) idle = s;
  }
  if (idle)
    return idle.aiMode === 'assist'
      ? `${idle.name} is idle: fly near asteroids, or set it to AUTO in the fleet panel.`
      : `${idle.name} is idle: no asteroids near the station. Set it to ASSIST to follow you.`;
  if (currentGoal(state)?.id === 'warp') {
    const need = warpCost(state) - run.bank.fuel;
    if (need > 0) {
      const ice = (RECIPES.fuel.input.ice ?? 0) / RECIPES.fuel.output;
      return `Warp needs ${Math.ceil(need)} more fuel: refine it from ice (${ice} each) in the refinery panel.`;
    }
  }
  return null;
}
