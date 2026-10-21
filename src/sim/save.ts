// Save slots in localStorage, plus import/export text. GameState is plain data,
// so a save is its JSON minus the transient outbox, wrapped in a small record:
//   { format: 'amh-save', savedAt: <epoch ms>, state: { version, profile, run } }
// Slots keep exact floats. Export rounds them to a few significant digits, and
// the copy-paste text is that JSON gzipped and base64'd behind a short prefix.
// Import accepts the compact text, a record or a bare state object. Older
// versions are upgraded through sim/migrations; saves from a newer version are
// rejected rather than half-loaded.

import { SAVE_VERSION } from './create';
import { chainCovers, type MigrateOptions, migrate } from './migrations';
import type { GameState } from './types';
import { validateState } from './validate';

/** True for any non-null object (arrays included); used only for format-record detection in parseImport. */
const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object';

export const SLOT_COUNT = 3;
const PREFIX = 'asteroid-miner-horizons';
const slotKey = (i: number): string => `${PREFIX}/slot/${i}`;
const ACTIVE_KEY = `${PREFIX}/active-slot`;
/** Pre-slot single save key; migrated into slot 0 on first run. */
const LEGACY_KEY = `${PREFIX}/save`;
const FORMAT = 'amh-save';
/** Marks compact export text: base64 of the gzipped export JSON follows. */
const COMPACT_PREFIX = 'amh1:';
/** Significant digits kept for non-integer numbers in exported text. */
const EXPORT_DIGITS = 6;
/** Reject compact payloads above this compressed byte size. */
const MAX_COMPACT_BYTES = 2 * 1024 * 1024;
/** Reject compact payloads that inflate beyond this JSON byte size. */
const MAX_IMPORT_JSON_BYTES = 4 * 1024 * 1024;
/** `Date` can only represent timestamps inside this range. */
const MAX_DATE_MS = 8_640_000_000_000_000;
const TOO_LARGE_ERROR = 'This save text is too large to import safely.';
const DAMAGED_ERROR = 'This save text is damaged or incomplete.';

class TooLargeSaveError extends Error {}

export interface SaveRecord {
  savedAt: number;
  state: GameState;
}

/** localStorage (or sessionStorage), or null where it's missing or blocked (private mode, tests). */
export function safeStorage(area: 'localStorage' | 'sessionStorage' = 'localStorage'): Storage | null {
  try {
    return globalThis[area] ?? null;
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

/**
 * True when `state` would load back from its own save. JSON writes NaN and Infinity as null, so a game a bug left
 * holding one would otherwise be saved as text the load rejects.
 */
export function loadsBack(state: GameState): boolean {
  return deserialize(serialize(state)) !== null;
}

/** Validates the shape of parsed JSON well enough that the game can run on it. */
function fromData(data: unknown, opts?: MigrateOptions): GameState | null {
  const migrated = migrate(data, opts);
  return migrated ? validateState(migrated) : null;
}

/** The exact save record a slot stores, built without re-parsing the state. */
function recordText(state: GameState, savedAt: number): string {
  return `{"format":"${FORMAT}","savedAt":${savedAt},"state":${serialize(state)}}`;
}

/** JSON replacer that rounds non-integer numbers; integers (ids, RNG state, colours) stay exact. */
const roundFloat = (_key: string, v: unknown): unknown =>
  typeof v === 'number' && !Number.isInteger(v) ? Number(v.toPrecision(EXPORT_DIGITS)) : v;

/** Text for export: a save record with floats rounded, still plain JSON to eyeball. */
export function exportText(state: GameState, savedAt = Date.now()): string {
  const record = { format: FORMAT, savedAt, state: { version: state.version, profile: state.profile, run: state.run } };
  return JSON.stringify(record, roundFloat);
}

/** Copy-paste export: compact text when supported, else plain export text. */
export async function exportCompact(state: GameState, savedAt = Date.now()): Promise<string> {
  const json = exportText(state, savedAt);
  const Compression = globalThis.CompressionStream;
  if (typeof Compression !== 'function') return json;
  try {
    const gz = new Blob([json]).stream().pipeThrough(new Compression('gzip'));
    return COMPACT_PREFIX + toBase64(new Uint8Array(await new Response(gz).arrayBuffer()));
  } catch {
    return json;
  }
}

/** Like `parseImport`, but also accepts compact text from `exportCompact`. */
export async function parseImportText(
  text: string,
  opts?: MigrateOptions,
): Promise<{ ok: true; record: SaveRecord } | { ok: false; error: string }> {
  const t = text.trim();
  if (!t.startsWith(COMPACT_PREFIX)) return parseImport(t, opts);
  let json: string;
  try {
    const b64 = t.slice(COMPACT_PREFIX.length).replace(/\s+/g, '');
    if (b64.length > Math.ceil((MAX_COMPACT_BYTES * 4) / 3) + 4) return { ok: false, error: TOO_LARGE_ERROR };
    const bytes = fromBase64(b64);
    if (bytes.byteLength > MAX_COMPACT_BYTES) return { ok: false, error: TOO_LARGE_ERROR };
    const Decompression = globalThis.DecompressionStream;
    if (typeof Decompression !== 'function') return { ok: false, error: DAMAGED_ERROR };
    const raw = new Blob([bytes]).stream().pipeThrough(new Decompression('gzip'));
    json = await new Response(limitBytes(raw, MAX_IMPORT_JSON_BYTES)).text();
  } catch (err) {
    if (err instanceof TooLargeSaveError) return { ok: false, error: TOO_LARGE_ERROR };
    return { ok: false, error: DAMAGED_ERROR };
  }
  return parseImport(json, opts);
}

function limitBytes(stream: ReadableStream<Uint8Array>, maxBytes: number): ReadableStream<Uint8Array> {
  let total = 0;
  return stream.pipeThrough(
    new TransformStream({
      transform(chunk: Uint8Array, controller): void {
        total += chunk.byteLength;
        if (total > maxBytes) throw new TooLargeSaveError();
        controller.enqueue(chunk);
      },
    }),
  );
}

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  // Chunked so a large save doesn't overflow the argument limit.
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function fromBase64(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function validSavedAt(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= MAX_DATE_MS;
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
  const isRecord = isObj(rec) && rec.format === FORMAT;
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
    record: { savedAt: isRecord && validSavedAt(rec.savedAt) ? rec.savedAt : Date.now(), state },
  };
}

/**
 * What a slot holds. `unreadable` means something is stored but it doesn't parse or validate (corrupt, or from a
 * newer build); its raw text is kept so it can be exported, and nothing should write over it unasked.
 */
export type SlotStatus =
  | { kind: 'empty' }
  | { kind: 'ok'; record: SaveRecord }
  | { kind: 'unreadable'; reason: string; raw: string };

/** Reads slot `i` and says whether it is empty, a usable save, or stored text that can't be loaded (and why). */
export function slotStatus(i: number): SlotStatus {
  const raw = safeStorage()?.getItem(slotKey(i));
  if (!raw) return { kind: 'empty' };
  const r = parseImport(raw);
  return r.ok ? { kind: 'ok', record: r.record } : { kind: 'unreadable', reason: r.error, raw };
}

/** The save in slot `i`, or null when the slot is empty or unreadable (see `slotStatus` to tell them apart). */
export function readSlot(i: number): SaveRecord | null {
  const st = slotStatus(i);
  return st.kind === 'ok' ? st.record : null;
}

/** The first empty slot, or -1 when every slot holds something. */
export function firstEmptySlot(): number {
  for (let i = 0; i < SLOT_COUNT; i++) if (slotStatus(i).kind === 'empty') return i;
  return -1;
}

/** Writes `state` to slot `i`. False when storage is missing, full or blocked, so the caller can tell the player. */
export function writeSlot(i: number, state: GameState): boolean {
  const s = safeStorage();
  if (!s) return false;
  try {
    s.setItem(slotKey(i), recordText(state, Date.now()));
    return true;
  } catch {
    return false;
  }
}

export function clearSlot(i: number): void {
  safeStorage()?.removeItem(slotKey(i));
}

export function activeSlot(): number {
  const n = Number(safeStorage()?.getItem(ACTIVE_KEY));
  return Number.isInteger(n) && n >= 0 && n < SLOT_COUNT ? n : 0;
}

export function setActiveSlot(i: number): void {
  safeStorage()?.setItem(ACTIVE_KEY, String(i));
}

/**
 * Moves a save from the old single-save key into slot 0, or the first empty slot when slot 0 is taken. The legacy
 * key is removed only once its save is safely in a slot, so an unreadable or unplaceable one is kept.
 */
export function migrateLegacy(): void {
  const s = safeStorage();
  const raw = s?.getItem(LEGACY_KEY);
  if (!s || !raw) return;
  const state = deserialize(raw);
  if (!state) return;
  const slot = firstEmptySlot();
  if (slot >= 0 && writeSlot(slot, state)) s.removeItem(LEGACY_KEY);
}
