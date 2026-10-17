// Save schema migrations. A save is `{ version, profile, run }`. When the
// schema changes, bump SAVE_VERSION and add one entry to `migrations` that
// upgrades the previous version to the new one. Older saves are then loaded by
// replaying the entries in order instead of being rejected outright.

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

/** `migrations[n]` upgrades a v`n` save to v`n+1`. Empty until a schema change lands. */
export const migrations: Record<number, Migration> = {};

export interface MigrateOptions {
  /** Version table to replay; defaults to the production `migrations`. */
  table?: Record<number, Migration>;
  /** Target version; defaults to the current `SAVE_VERSION`. */
  to?: number;
}

/**
 * Replays migrations to bring a parsed save up to the target version. Returns
 * null when the save is unusable: not an object, no integer version, from a
 * newer version than we understand, or missing a step in the chain.
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
  for (let v = version; v < to; v++) {
    const step = table[v];
    if (!step) return null;
    cur = step(cur);
  }
  cur.version = to;
  return cur;
}
