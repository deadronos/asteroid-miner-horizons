// Save slots in localStorage, plus import/export text. GameState is plain data,
// so a save is its JSON minus the transient outbox, wrapped in a small record:
//   { format: 'amh-save', savedAt: <epoch ms>, state: { version, profile, run } }
// Slots keep exact floats. Export rounds them to a few significant digits, and
// the copy-paste text is that JSON gzipped and base64'd behind a short prefix.
// Import accepts the compact text, a record or a bare state object. Older
// versions are upgraded through sim/migrations; saves from a newer version are
// rejected rather than half-loaded.

import { ACHIEVEMENTS, STAT_KEYS } from '../data/achievements';
import { COMPONENTS, isVariant, type ComponentId } from '../data/components';
import { MODIFIERS } from '../data/modifiers';
import { PERK_IDS } from '../data/perks';
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

/** True for any non-null object (arrays included); narrows so fields can be read as `unknown`. */
const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object';
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const isVec = (p: unknown): boolean => isObj(p) && finite(p.x) && finite(p.z);
/** True when `r` is a serialised `Rng`: an object with a finite numeric state. */
const isRng = (r: unknown): boolean => isObj(r) && finite(r.s);
/** True when `k` names a raw resource a rock, pickup or belt can carry. */
const isRawKind = (k: unknown): boolean => typeof k === 'string' && (RAW_RESOURCES as readonly string[]).includes(k);

/** True when `w` is an object with a number under every `RESOURCES` key. */
function isWallet(w: unknown): boolean {
  return isObj(w) && RESOURCES.every((r) => typeof w[r] === 'number');
}

/** True when every entry is a refine job the tick can process: a known recipe and sane numeric counters. */
function isQueue(queue: unknown[]): boolean {
  return queue.every(
    (job) =>
      isObj(job) &&
      finite(job.id) &&
      typeof job.recipe === 'string' &&
      Object.hasOwn(RECIPES, job.recipe) &&
      finite(job.count) &&
      job.count >= 1 &&
      finite(job.total) &&
      job.total >= job.count &&
      finite(job.progress) &&
      job.progress >= 0,
  );
}

/** True when a rock carries no trait, or one the sim can actually run. */
function isTrait(r: unknown): boolean {
  // A corrupt save can put a non-object (e.g. `null`) in the rocks array.
  if (!isObj(r)) return false;
  const trait = r.trait;
  return trait === undefined || (typeof trait === 'string' && Object.hasOwn(TRAITS, trait));
}

/** True when one slot is empty, or a component variant at a real tier. */
function isFitted(f: unknown): boolean {
  if (f === null) return true;
  if (!isObj(f)) return false;
  return (
    typeof f.type === 'string' &&
    Object.hasOwn(COMPONENTS, f.type) &&
    isVariant(f.type as ComponentId, f.variant) &&
    (f.tier === 1 || f.tier === 2 || f.tier === 3)
  );
}

/** True when `s` is a ship whose slot list the tick can derive stats from. */
function isShipSlots(s: unknown): boolean {
  return isObj(s) && Array.isArray(s.slots) && s.slots.every(isFitted);
}

/**
 * True when `s` has everything the tick moves or reads each frame: position, velocity, the scalars it steps
 * (a missing one turns NaN for good; a NaN hull can never reach 0), complete cargo and known fitted slots.
 */
function isShip(s: unknown): boolean {
  return (
    isObj(s) &&
    isVec(s.pos) &&
    isVec(s.vel) &&
    finite(s.angle) &&
    finite(s.hull) &&
    finite(s.shield) &&
    finite(s.collisionCd) &&
    finite(s.respawn) &&
    isWallet(s.cargo) &&
    isShipSlots(s)
  );
}

/** True when `r` is a rock the tick can move, mine and crack, with no trait the sim doesn't know. */
function isRock(r: unknown): boolean {
  return (
    isTrait(r) &&
    isObj(r) &&
    isRawKind(r.kind) &&
    isVec(r.pos) &&
    isVec(r.vel) &&
    finite(r.radius) &&
    finite(r.hp) &&
    finite(r.maxHp) &&
    finite(r.units) &&
    finite(r.belt)
  );
}

/** True when `p` is a pickup the tick can drift, age and collect. */
function isPickup(p: unknown): boolean {
  return isObj(p) && isRawKind(p.kind) && isVec(p.pos) && isVec(p.vel) && finite(p.amount) && finite(p.age);
}

/** True when `b` has what belt regrowth and spawning read: finite radii, a target count and a weight per raw kind. */
function isBelt(b: unknown): boolean {
  if (!isObj(b) || !finite(b.inner) || !finite(b.outer) || !finite(b.initialCount)) return false;
  const mix = b.mix;
  return isObj(mix) && RAW_RESOURCES.every((k) => finite(mix[k]));
}

/** True when `h` has what the hazard tick reads: an RNG state, finite timers, and well-formed pending hazards. */
function isHazards(h: unknown): boolean {
  if (!isObj(h)) return false;
  const { comet, flare } = h;
  return (
    isRng(h.rng) &&
    finite(h.cometTimer) &&
    finite(h.flareTimer) &&
    finite(h.comets) &&
    finite(h.flares) &&
    (comet === null ||
      (isObj(comet) && isVec(comet.from) && isVec(comet.vel) && finite(comet.belt) && finite(comet.timeLeft))) &&
    (flare === null ||
      (isObj(flare) && (flare.phase === 'warning' || flare.phase === 'active') && finite(flare.timeLeft)))
  );
}

/** True when `a` has what the outpost tick reads, and every outpost sits on a distinct rock of this run. */
function isAutomation(a: unknown, rocks: unknown[]): boolean {
  if (!isObj(a)) return false;
  const { outposts } = a;
  if (!Array.isArray(outposts) || !finite(a.extracted)) return false;
  const ids = new Set(rocks.map((r) => (r as { id?: unknown }).id));
  const hosts = new Set<unknown>();
  return outposts.every((op) => {
    if (!isObj(op)) return false;
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

/** True when `p` has a finite number under every stat key and a duplicate-free list of known achievements. */
function isLifetime(p: Profile): boolean {
  const stats = p.stats as unknown;
  if (!isObj(stats) || !STAT_KEYS.every((k) => finite(stats[k]))) return false;
  const got = p.achievements as unknown;
  return (
    Array.isArray(got) &&
    got.every((a) => typeof a === 'string' && Object.hasOwn(ACHIEVEMENTS, a)) &&
    new Set(got).size === got.length
  );
}

/** True when `p` has a seed, a finite level for every perk, and well-formed lifetime stats. */
function isProfile(p: Profile | undefined): p is Profile {
  if (!p || typeof p.seed !== 'number' || !isObj(p.perks)) return false;
  // Stats, costs and the refinery read every perk level, so each must be a finite number.
  if (!PERK_IDS.every((k) => finite(p.perks[k]))) return false;
  // The tick adds to every stat and the Stats tab looks up every unlocked achievement.
  return isLifetime(p);
}

/** True when the contract board has everything the tick walks: offers, the id counter and the RNG state. */
function isBoard(b: unknown): boolean {
  return isObj(b) && Array.isArray(b.offers) && typeof b.nextId === 'number' && isRng(b.rng);
}

/**
 * True when the refinery's queue can be processed and its `produced` totals read (by the HUD and balance report),
 * and no queued job's id could be reused.
 */
function isRefinery(r: unknown): boolean {
  if (!isObj(r) || Array.isArray(r) || !Array.isArray(r.queue)) return false;
  const produced = r.produced;
  if (!isObj(produced) || Array.isArray(produced)) return false;
  if (RECIPE_IDS.some((id) => typeof produced[id] !== 'number')) return false;
  if (!isQueue(r.queue)) return false;
  // New jobs must not reuse a queued job's id, or a cancel could hit the wrong one.
  const { nextId } = r;
  return finite(nextId) && !(r.queue as { id: number }[]).some((j) => j.id >= nextId);
}

/** True when the tick indexes MODIFIERS by every entry: all known, none duplicated (a duplicate applies twice). */
function isModifierList(mods: unknown): boolean {
  return (
    Array.isArray(mods) &&
    mods.every((m) => typeof m === 'string' && Object.hasOwn(MODIFIERS, m)) &&
    new Set(mods).size === mods.length
  );
}

/** Validates the shape of parsed JSON well enough that the game can run on it. */
function fromData(data: unknown, opts?: MigrateOptions): GameState | null {
  const migrated = migrate(data, opts);
  if (!migrated) return null;
  // migrate() only guarantees the version envelope; validate the payload shape.
  const { profile, run } = migrated as { profile?: Profile; run?: Run };
  if (!isProfile(profile)) return null;
  if (!run || !run.system || !Array.isArray(run.ships) || !Array.isArray(run.rocks) || !Array.isArray(run.pickups))
    return null;
  // The tick steps these every frame, so a missing or non-finite one would turn NaN and stay that way.
  if (!isRng(run.rng) || !finite(run.nextId) || !finite(run.time) || !finite(run.runValue)) return null;
  if (!finite(run.regrowTimer)) return null;
  const { belts, station } = run.system;
  if (!Array.isArray(belts) || !belts.every(isBelt) || !isObj(station) || !isVec(station.pos)) return null;
  if (!run.rocks.every(isRock) || !run.pickups.every(isPickup)) return null;
  if (!isModifierList(run.system.modifiers)) return null;
  // A wallet missing a resource column (e.g. alloy) would poison every later
  // read with NaN, so the bank must be complete (ship cargo is checked by isShip).
  if (!isWallet(run.bank) || !run.ships.every(isShip)) return null;
  if (!isBoard(run.contracts)) return null;
  if (!run.ships.some((s) => s.hullId === 'prospector' || s.hullId === 'excavator')) return null;
  if (!isRefinery(run.refinery)) return null;
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
    record: { savedAt: isRecord && typeof rec.savedAt === 'number' ? rec.savedAt : Date.now(), state },
  };
}

export function readSlot(i: number): SaveRecord | null {
  const raw = safeStorage()?.getItem(slotKey(i));
  if (!raw) return null;
  const r = parseImport(raw);
  return r.ok ? r.record : null;
}

export function writeSlot(i: number, state: GameState): void {
  try {
    safeStorage()?.setItem(slotKey(i), recordText(state, Date.now()));
  } catch {
    // Storage full or blocked: the game keeps running unsaved.
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

/** Moves a save from the old single-save key into slot 0 (once). */
export function migrateLegacy(): void {
  const s = safeStorage();
  const raw = s?.getItem(LEGACY_KEY);
  if (!s || !raw) return;
  const state = deserialize(raw);
  if (state && !s.getItem(slotKey(0))) writeSlot(0, state);
  s.removeItem(LEGACY_KEY);
}
