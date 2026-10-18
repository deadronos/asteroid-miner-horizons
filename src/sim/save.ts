// Save slots in localStorage, plus import/export text. GameState is plain data,
// so a save is its JSON minus the transient outbox, wrapped in a small record:
//   { format: 'amh-save', savedAt: <epoch ms>, state: { version, profile, run } }
// The same record is what export produces and import accepts (a bare state
// object is accepted too). Older versions are upgraded through sim/migrations;
// saves from a newer version are rejected rather than half-loaded.

import { MODIFIERS } from '../data/modifiers';
import { RECIPES, RECIPE_IDS } from '../data/refining';
import { RESOURCES } from '../data/resources';
import { SAVE_VERSION } from './create';
import { chainCovers, type MigrateOptions, migrate } from './migrations';
import type { GameState, Profile, Run } from './types';

export const SLOT_COUNT = 3;
const PREFIX = 'asteroid-miner-horizons';
const slotKey = (i: number): string => `${PREFIX}/slot/${i}`;
const ACTIVE_KEY = `${PREFIX}/active-slot`;
/** Pre-slot single save key; migrated into slot 0 on first run. */
const LEGACY_KEY = `${PREFIX}/save`;
const FORMAT = 'amh-save';

export interface SaveRecord {
  savedAt: number;
  state: GameState;
}

/** localStorage, or null where it's missing or blocked (private mode, tests). */
function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function serialize(state: GameState): string {
  return JSON.stringify({ version: state.version, profile: state.profile, run: state.run });
}

/** `opts` swaps in a migration table (tests); the game always uses the default. */
export function deserialize(json: string, opts?: MigrateOptions): GameState | null {
  try {
    return fromData(JSON.parse(json), opts);
  } catch {
    return null;
  }
}

/** True when `w` is an object with a number under every `RESOURCES` key. */
function isWallet(w: unknown): boolean {
  return !!w && typeof w === 'object' && RESOURCES.every((r) => typeof (w as Record<string, unknown>)[r] === 'number');
}

/** True when every entry is a refine job the tick can process: a known recipe and sane numeric counters. */
function isQueue(queue: unknown[]): boolean {
  return queue.every((j) => {
    const job = j as { id?: unknown; recipe?: unknown; count?: unknown; total?: unknown; progress?: unknown };
    return (
      !!job &&
      typeof job === 'object' &&
      typeof job.id === 'number' &&
      Number.isFinite(job.id) &&
      typeof job.recipe === 'string' &&
      Object.hasOwn(RECIPES, job.recipe) &&
      typeof job.count === 'number' &&
      Number.isFinite(job.count) &&
      job.count >= 1 &&
      typeof job.total === 'number' &&
      Number.isFinite(job.total) &&
      job.total >= job.count &&
      typeof job.progress === 'number' &&
      Number.isFinite(job.progress) &&
      job.progress >= 0
    );
  });
}

/** Validates the shape of parsed JSON well enough that the game can run on it. */
function fromData(data: unknown, opts?: MigrateOptions): GameState | null {
  const migrated = migrate(data, opts);
  if (!migrated) return null;
  // migrate() only guarantees the version envelope; validate the payload shape.
  const { profile, run } = migrated as { profile?: Profile; run?: Run };
  if (!profile || typeof profile.seed !== 'number' || typeof profile.perks !== 'object') return null;
  if (!run || !run.system || !Array.isArray(run.ships) || !Array.isArray(run.rocks) || !Array.isArray(run.pickups))
    return null;
  // The tick indexes MODIFIERS by key, so every entry must be a known modifier;
  // a duplicate would apply its effect twice.
  const mods = run.system.modifiers as unknown;
  if (!Array.isArray(mods) || !mods.every((m) => typeof m === 'string' && Object.hasOwn(MODIFIERS, m))) return null;
  if (new Set(mods).size !== mods.length) return null;
  // A wallet missing a resource column (e.g. alloy) would poison every later
  // read with NaN, so the bank and each ship's cargo must be complete.
  if (!isWallet(run.bank) || !run.ships.every((s) => isWallet(s.cargo))) return null;
  // The tick walks the board, so reject anything it cannot handle: offers, the
  // id counter and the RNG state must all be present.
  const board = run.contracts as { offers?: unknown; nextId?: unknown; rng?: { s?: unknown } | null };
  if (
    !board ||
    typeof board !== 'object' ||
    !Array.isArray(board.offers) ||
    typeof board.nextId !== 'number' ||
    typeof board.rng !== 'object' ||
    !board.rng ||
    typeof board.rng.s !== 'number'
  )
    return null;
  if (!run.ships.some((s) => s.hullId === 'prospector' || s.hullId === 'excavator')) return null;
  // The tick will process the queue, and the HUD and balance report read
  // `produced`, so both must be well-formed before the run is accepted.
  const refinery = run.refinery as { queue?: unknown; nextId?: unknown; produced?: unknown };
  if (!refinery || typeof refinery !== 'object' || Array.isArray(refinery) || !Array.isArray(refinery.queue))
    return null;
  const produced = refinery.produced as Record<string, unknown> | null;
  if (!produced || typeof produced !== 'object' || Array.isArray(produced)) return null;
  if (RECIPE_IDS.some((r) => typeof produced[r] !== 'number')) return null;
  if (!isQueue(refinery.queue)) return null;
  // New jobs must not reuse a queued job's id, or a cancel could hit the wrong one.
  const { nextId } = refinery;
  if (typeof nextId !== 'number' || !Number.isFinite(nextId)) return null;
  if ((refinery.queue as { id: number }[]).some((j) => j.id >= nextId)) return null;
  return { version: migrated.version, profile, run, out: { fx: [], log: [] } };
}

/** Text for export: a save record with metadata, pretty enough to eyeball. */
export function exportText(state: GameState, savedAt = Date.now()): string {
  return JSON.stringify({ format: FORMAT, savedAt, state: JSON.parse(serialize(state)) });
}

/** Parses exported text (a save record or a bare state). */
export function parseImport(
  text: string,
  opts?: MigrateOptions,
): { ok: true; record: SaveRecord } | { ok: false; error: string } {
  let data: unknown;
  try {
    data = JSON.parse(text.trim());
  } catch {
    return { ok: false, error: 'Not valid JSON.' };
  }
  const rec = data as { format?: string; savedAt?: number; state?: unknown };
  const isRecord = rec && typeof rec === 'object' && rec.format === FORMAT;
  const payload = isRecord ? rec.state : data;
  const state = fromData(payload, opts);
  if (!state) {
    const v = (payload as { version?: unknown } | null | undefined)?.version;
    const to = opts?.to ?? SAVE_VERSION;
    if (typeof v === 'number' && v > to)
      return { ok: false, error: `This save is from a newer version (v${v}) and can't be loaded by this build.` };
    // Only blame the version when the chain genuinely cannot reach it; an
    // upgradable save that still fails (even by making a step throw) is just
    // not a usable save.
    if (Number.isInteger(v) && (v as number) >= 1 && !chainCovers(v as number, opts))
      return { ok: false, error: `Unsupported save version ${String(v)} (expected ${to}).` };
    return { ok: false, error: 'This is not an Asteroid Miner Horizons save.' };
  }
  return {
    ok: true,
    record: { savedAt: isRecord && typeof rec.savedAt === 'number' ? rec.savedAt : Date.now(), state },
  };
}

export function readSlot(i: number): SaveRecord | null {
  const raw = storage()?.getItem(slotKey(i));
  if (!raw) return null;
  const r = parseImport(raw);
  return r.ok ? r.record : null;
}

export function writeSlot(i: number, state: GameState): void {
  try {
    storage()?.setItem(slotKey(i), exportText(state));
  } catch {
    // Storage full or blocked: the game keeps running unsaved.
  }
}

export function clearSlot(i: number): void {
  storage()?.removeItem(slotKey(i));
}

export function activeSlot(): number {
  const n = Number(storage()?.getItem(ACTIVE_KEY));
  return Number.isInteger(n) && n >= 0 && n < SLOT_COUNT ? n : 0;
}

export function setActiveSlot(i: number): void {
  storage()?.setItem(ACTIVE_KEY, String(i));
}

/** Moves a save from the old single-save key into slot 0 (once). */
export function migrateLegacy(): void {
  const s = storage();
  const raw = s?.getItem(LEGACY_KEY);
  if (!s || !raw) return;
  const state = deserialize(raw);
  if (state && !s.getItem(slotKey(0))) writeSlot(0, state);
  s.removeItem(LEGACY_KEY);
}
