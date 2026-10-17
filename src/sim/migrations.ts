// Save schema migrations. A save is `{ version, profile, run }`. When the
// schema changes, bump SAVE_VERSION and add one entry to `migrations` that
// upgrades the previous version to the new one. Older saves are then loaded by
// replaying the entries in order instead of being rejected outright.

import { newBoard } from './contracts';
import { SAVE_VERSION } from './create';
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
