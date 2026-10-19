// Save slots in localStorage, plus import/export text. GameState is plain data,
// so a save is its JSON minus the transient outbox, wrapped in a small record:
//   { format: 'amh-save', savedAt: <epoch ms>, state: { version, profile, run } }
// Slots keep exact floats. Export rounds them to a few significant digits, and
// the copy-paste text is that JSON gzipped and base64'd behind a short prefix.
// Import accepts the compact text, a record or a bare state object. Older
// versions are upgraded through sim/migrations; saves from a newer version are
// rejected rather than half-loaded.

import { COMPONENTS, isVariant, type ComponentId } from '../data/components';
import { MODIFIERS } from '../data/modifiers';
import { RECIPES, RECIPE_IDS } from '../data/refining';
import { RAW_RESOURCES, RESOURCES } from '../data/resources';
import { TRAITS } from '../data/traits';
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
/** Marks compact export text: base64 of the gzipped export JSON follows. */
const COMPACT_PREFIX = 'amh1:';
/** Significant digits kept for non-integer numbers in exported text. */
const EXPORT_DIGITS = 6;

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

const finite = (n: unknown): boolean => typeof n === 'number' && Number.isFinite(n);
const isVec = (p: unknown): boolean => !!p && finite((p as { x?: unknown }).x) && finite((p as { z?: unknown }).z);

/** True when a rock carries no trait, or one the sim can actually run. */
function isTrait(r: unknown): boolean {
  // A corrupt save can put a non-object (e.g. `null`) in the rocks array.
  if (!r || typeof r !== 'object') return false;
  const trait = (r as { trait?: unknown }).trait;
  return trait === undefined || (typeof trait === 'string' && Object.hasOwn(TRAITS, trait));
}

/** True when one slot is empty, or a component variant at a real tier. */
function isFitted(f: unknown): boolean {
  if (f === null) return true;
  if (!f || typeof f !== 'object') return false;
  const slot = f as { type?: unknown; variant?: unknown; tier?: unknown };
  return (
    typeof slot.type === 'string' &&
    Object.hasOwn(COMPONENTS, slot.type) &&
    isVariant(slot.type as ComponentId, slot.variant) &&
    (slot.tier === 1 || slot.tier === 2 || slot.tier === 3)
  );
}

/** True when `s` is a ship whose slot list the tick can derive stats from. */
function isShipSlots(s: unknown): boolean {
  if (!s || typeof s !== 'object') return false;
  const slots = (s as { slots?: unknown }).slots;
  return Array.isArray(slots) && slots.every(isFitted);
}

/** True when `h` has what the hazard tick reads: an RNG state, finite timers, and well-formed pending hazards. */
function isHazards(h: unknown): boolean {
  if (!h || typeof h !== 'object') return false;
  const x = h as Record<string, unknown>;
  const rng = x.rng as { s?: unknown } | null;
  const comet = x.comet as { from?: unknown; vel?: unknown; belt?: unknown; timeLeft?: unknown } | null;
  const flare = x.flare as { phase?: unknown; timeLeft?: unknown } | null;
  return (
    !!rng &&
    typeof rng === 'object' &&
    typeof rng.s === 'number' &&
    finite(x.cometTimer) &&
    finite(x.flareTimer) &&
    finite(x.comets) &&
    finite(x.flares) &&
    (comet === null ||
      (typeof comet === 'object' &&
        isVec(comet.from) &&
        isVec(comet.vel) &&
        finite(comet.belt) &&
        finite(comet.timeLeft))) &&
    (flare === null ||
      (typeof flare === 'object' && (flare.phase === 'warning' || flare.phase === 'active') && finite(flare.timeLeft)))
  );
}

/** True when `a` has what the outpost tick reads, and every outpost sits on a distinct rock of this run. */
function isAutomation(a: unknown, rocks: unknown[]): boolean {
  if (!a || typeof a !== 'object') return false;
  const x = a as { outposts?: unknown; extracted?: unknown };
  if (!Array.isArray(x.outposts) || !finite(x.extracted)) return false;
  const ids = new Set(rocks.map((r) => (r as { id?: unknown }).id));
  const hosts = new Set<unknown>();
  return x.outposts.every((o) => {
    if (!o || typeof o !== 'object') return false;
    const op = o as { rockId?: unknown; kind?: unknown; pos?: unknown; stored?: unknown; reserve?: unknown };
    if (!ids.has(op.rockId) || hosts.has(op.rockId)) return false;
    hosts.add(op.rockId);
    return (
      typeof op.kind === 'string' &&
      (RAW_RESOURCES as readonly string[]).includes(op.kind) &&
      isVec(op.pos) &&
      isWallet(op.stored) &&
      finite(op.reserve)
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
  // A trait the sim doesn't know would drive behaviour no rock can roll.
  if (!run.rocks.every(isTrait)) return null;
  // The tick indexes MODIFIERS by key, so every entry must be a known modifier;
  // a duplicate would apply its effect twice.
  const mods = run.system.modifiers as unknown;
  if (!Array.isArray(mods) || !mods.every((m) => typeof m === 'string' && Object.hasOwn(MODIFIERS, m))) return null;
  if (new Set(mods).size !== mods.length) return null;
  // A wallet missing a resource column (e.g. alloy) would poison every later
  // read with NaN, so the bank and each ship's cargo must be complete.
  if (!isWallet(run.bank) || !run.ships.every((s) => isWallet(s.cargo))) return null;
  // The tick derives each ship's stats from its fitted slots, so every one must
  // name a known component variant at a real tier.
  if (!run.ships.every(isShipSlots)) return null;
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
  if (!isHazards(run.hazards)) return null;
  if (!isAutomation(run.automation, run.rocks)) return null;
  return { version: migrated.version, profile, run, out: { fx: [], log: [] } };
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

/** Copy-paste export: `exportText` gzipped and base64'd, roughly a quarter of the exact save's size. */
export async function exportCompact(state: GameState, savedAt = Date.now()): Promise<string> {
  const gz = new Blob([exportText(state, savedAt)]).stream().pipeThrough(new CompressionStream('gzip'));
  return COMPACT_PREFIX + toBase64(new Uint8Array(await new Response(gz).arrayBuffer()));
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
    const bytes = fromBase64(t.slice(COMPACT_PREFIX.length).replace(/\s+/g, ''));
    const raw = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    json = await new Response(raw).text();
  } catch {
    return { ok: false, error: 'This save text is damaged or incomplete.' };
  }
  return parseImport(json, opts);
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
    storage()?.setItem(slotKey(i), recordText(state, Date.now()));
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
