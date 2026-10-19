// Save schema migrations. A save is `{ version, profile, run }`. When the
// schema changes, bump SAVE_VERSION and add one entry to `migrations` that
// upgrades the previous version to the new one. Older saves are then loaded by
// replaying the entries in order instead of being rejected outright.

import { defaultVariant } from '../data/components';
import { newStats } from './achievements';
import { newAutomation } from './automation';
import { newBoard } from './contracts';
import { SAVE_VERSION } from './create';
import { newHazards } from './hazards';
import { newRefinery } from './refining';
import type { GameState } from './types';

/** The persisted shape: all of GameState except the transient outbox. */
export type SaveData = Pick<GameState, 'version' | 'profile' | 'run'>;

/**
 * Upgrades a save at version `n` to version `n + 1`. It may edit nested
 * objects in place: migrate() only copies the top level, and its input is
 * always freshly parsed JSON that nothing else holds.
 */
export type Migration = (data: SaveData) => SaveData;

/** `migrations[n]` upgrades a v`n` save to v`n+1`. */
export const migrations: Record<number, Migration> = {
  // v3 added `run.contracts`: an empty station board that the first tick refills.
  2: (d) => {
    d.run.contracts = newBoard(d.profile.seed, d.run.system.number);
    return d;
  },
  // v4 added `alloy` and `fuel`: bank and cargo columns start empty, and an
  // empty station refinery is created.
  3: (d) => {
    d.run.bank.alloy = 0;
    d.run.bank.fuel = 0;
    for (const ship of d.run.ships) {
      ship.cargo.alloy = 0;
      ship.cargo.fuel = 0;
    }
    d.run.refinery = newRefinery();
    return d;
  },
  // v5 added `system.modifiers`. A pre-modifier system keeps its belt as
  // generated, so it gets none; modifiers are rolled from the next warp on.
  4: (d) => {
    d.run.system.modifiers = [];
    return d;
  },
  // v6 added `run.hazards`: a fresh hazard schedule for the current system.
  5: (d) => {
    d.run.hazards = newHazards(d.profile.seed, d.run.system.number);
    return d;
  },
  // v7 added an optional `rock.trait`; old rocks stay plain.
  6: (d) => d,
  // v8 added `fitted.variant`. A pre-variant part becomes its component's
  // default, whose numbers are the ones it already had.
  7: (d) => {
    for (const ship of d.run.ships) for (const f of ship.slots) if (f) f.variant = defaultVariant(f.type);
    return d;
  },
  // v9 added `run.automation`: no outposts yet.
  8: (d) => {
    d.run.automation = newAutomation();
    return d;
  },
  // v10 added the refinery perks (#84); nobody has researched them yet.
  9: (d) => {
    d.profile.perks.furnace = 0;
    d.profile.perks.hopper = 0;
    return d;
  },
  // v11 added lifetime stats and achievements (#40). Counters the save already
  // implies seed the stats: warps and research levels in full, and this run's
  // time, contracts, refined units and comets as a lower bound. Nothing is
  // unlocked yet; the first tick unlocks whatever those counters already reach.
  10: (d) => {
    const { profile, run } = d;
    const stats = newStats();
    stats.warps = profile.warps;
    stats.perks = Object.values(profile.perks).reduce((sum, l) => sum + l, 0);
    stats.time = run.time;
    stats.contracts = run.contracts.completed;
    stats.refined = Object.values(run.refinery.produced).reduce((sum, n) => sum + n, 0);
    stats.comets = run.hazards.comets;
    profile.stats = stats;
    profile.achievements = [];
    return d;
  },
};

export interface MigrateOptions {
  /** Version table to replay; defaults to the production `migrations`. */
  table?: Record<number, Migration>;
  /** Target version; defaults to the current `SAVE_VERSION`. */
  to?: number;
}

/**
 * True when `table` can replay every step from a save at `version` up to the
 * target: the version is upgradable in principle, as opposed to sitting below a
 * gap in the chain. A malformed payload still counts as upgradable here.
 */
export function chainCovers(version: number, opts: MigrateOptions = {}): boolean {
  const table = opts.table ?? migrations;
  const to = opts.to ?? SAVE_VERSION;
  for (let v = version; v < to; v++) if (!table[v]) return false;
  return true;
}

/**
 * Replays migrations to bring a parsed save up to the target version. Returns
 * null when the save is unusable: not an object, no integer version, from a
 * newer version than we understand, missing a step in the chain, or a step that
 * throws on a malformed payload (treated as unusable rather than propagated).
 */
export function migrate(data: unknown, opts: MigrateOptions = {}): SaveData | null {
  const table = opts.table ?? migrations;
  const to = opts.to ?? SAVE_VERSION;
  if (!data || typeof data !== 'object') return null;

  const version = (data as { version?: unknown }).version;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) return null;
  // A save from a newer version can't be downgraded: refuse rather than half-load.
  if (version > to) return null;

  let cur = { ...(data as SaveData) };
  // A step reads fields the previous schema guaranteed; a hand-edited or
  // truncated payload can make one throw. That save is unusable, not fatal.
  try {
    for (let v = version; v < to; v++) {
      const step = table[v];
      if (!step) return null;
      cur = step(cur);
    }
    cur.version = to;
  } catch {
    return null;
  }
  return cur;
}
