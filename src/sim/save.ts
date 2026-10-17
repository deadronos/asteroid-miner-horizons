// Save slots in localStorage, plus import/export text. GameState is plain data,
// so a save is its JSON minus the transient outbox, wrapped in a small record:
//   { format: 'amh-save', savedAt: <epoch ms>, state: { version, profile, run } }
// The same record is what export produces and import accepts (a bare state
// object is accepted too). Unknown versions are rejected rather than half-loaded.

import { SAVE_VERSION } from './create';
import type { GameState } from './types';

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

export function deserialize(json: string): GameState | null {
  try {
    return fromData(JSON.parse(json));
  } catch {
    return null;
  }
}

/** Validates the shape of parsed JSON well enough that the game can run on it. */
function fromData(data: unknown): GameState | null {
  const d = data as Partial<GameState> | null;
  if (!d || typeof d !== 'object' || d.version !== SAVE_VERSION) return null;
  const { profile, run } = d;
  if (!profile || typeof profile.seed !== 'number' || typeof profile.perks !== 'object') return null;
  if (!run || !run.system || !Array.isArray(run.ships) || !Array.isArray(run.rocks) || !Array.isArray(run.pickups)) return null;
  if (!run.ships.some((s) => s.hullId === 'prospector' || s.hullId === 'excavator')) return null;
  return { version: d.version, profile, run, out: { fx: [], log: [] } };
}

/** Text for export: a save record with metadata, pretty enough to eyeball. */
export function exportText(state: GameState, savedAt = Date.now()): string {
  return JSON.stringify({ format: FORMAT, savedAt, state: JSON.parse(serialize(state)) });
}

/** Parses exported text (a save record or a bare state). */
export function parseImport(text: string): { ok: true; record: SaveRecord } | { ok: false; error: string } {
  let data: unknown;
  try {
    data = JSON.parse(text.trim());
  } catch {
    return { ok: false, error: 'Not valid JSON.' };
  }
  const rec = data as { format?: string; savedAt?: number; state?: unknown };
  const isRecord = rec && typeof rec === 'object' && rec.format === FORMAT;
  const state = fromData(isRecord ? rec.state : data);
  if (!state) {
    const v = (isRecord ? (rec.state as { version?: unknown }) : (data as { version?: unknown }))?.version;
    return { ok: false, error: v != null && v !== SAVE_VERSION ? `Unsupported save version ${String(v)} (expected ${SAVE_VERSION}).` : 'This is not an Asteroid Miner Horizons save.' };
  }
  return { ok: true, record: { savedAt: isRecord && typeof rec.savedAt === 'number' ? rec.savedAt : Date.now(), state } };
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
