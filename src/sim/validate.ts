// Validates the shape of a migrated save, returning a runnable state or null.
// All helpers are private; only validateState is exported.

import { ACHIEVEMENTS, STAT_KEYS } from '../data/achievements';
import { COMPONENTS, isVariant, type ComponentId } from '../data/components';
import { CONTRACTS } from '../data/contracts';
import { HULLS } from '../data/hulls';
import { MODIFIERS } from '../data/modifiers';
import { DOCTRINE_PAIR_IDS, isDoctrineSide } from '../data/doctrines';
import { GATE_STAGES, stageMet, type GateCost } from '../data/gate';
import { PERK_IDS } from '../data/perks';
import { RECIPES, RECIPE_IDS } from '../data/refining';
import { RAW_RESOURCES, RESOURCES } from '../data/resources';
import { TRAITS } from '../data/traits';
import type { SaveData } from './migrations';
import type { GameState, Profile, Run } from './types';

/** True for any non-null object (arrays included); narrows so fields can be read as `unknown`. */
const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object';
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const isVec = (p: unknown): boolean => isObj(p) && finite(p.x) && finite(p.z);
/** True when `r` is a serialised `Rng`: an object with a finite numeric state. */
const isRng = (r: unknown): boolean => isObj(r) && finite(r.s);
/** True when `k` names a raw resource a rock, pickup or belt can carry. */
const isRawKind = (k: unknown): boolean => typeof k === 'string' && (RAW_RESOURCES as readonly string[]).includes(k);

/** True when `x` is null or a finite number (an optional id the tick looks up). */
const isIdOrNull = (x: unknown): boolean => x === null || finite(x);

/** True when `w` is an object with a finite number under every `RESOURCES` key. */
function isWallet(w: unknown): boolean {
  return isObj(w) && RESOURCES.every((r) => finite(w[r]));
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

/** True when `o` is no order, or one `runOrder` can follow: a move with a target, a mine or build with a rock id, or dock. */
function isOrder(o: unknown): boolean {
  if (o === null) return true;
  if (!isObj(o)) return false;
  if (o.kind === 'move') return isVec(o.to);
  if (o.kind === 'mine') return finite(o.rockId);
  if (o.kind === 'build') return finite(o.rockId);
  return o.kind === 'dock';
}

/**
 * True when `s` has everything the tick moves or reads each frame: a known hull, position, velocity, the scalars
 * it steps (a missing one turns NaN for good; a NaN hull can never reach 0), a followable order and AI mode,
 * complete cargo and known fitted slots.
 */
function isShip(s: unknown): boolean {
  return (
    isObj(s) &&
    finite(s.id) &&
    typeof s.name === 'string' &&
    typeof s.hullId === 'string' &&
    Object.hasOwn(HULLS, s.hullId) &&
    isOrder(s.order) &&
    (s.aiMode === 'assist' || s.aiMode === 'auto') &&
    isIdOrNull(s.aiTargetId) &&
    isIdOrNull(s.beamTargetId) &&
    isVec(s.pos) &&
    isVec(s.vel) &&
    finite(s.angle) &&
    finite(s.hull) &&
    finite(s.shield) &&
    finite(s.collisionCd) &&
    finite(s.respawn) &&
    isWallet(s.cargo) &&
    typeof s.autoRepair === 'boolean' &&
    typeof s.autoUpgrade === 'boolean' &&
    typeof s.autoBuild === 'boolean' &&
    isShipSlots(s)
  );
}

/** True when `r` is a rock the tick can move, mine and crack, with no trait the sim doesn't know. */
function isRock(r: unknown): boolean {
  return (
    isTrait(r) &&
    isObj(r) &&
    finite(r.id) &&
    (r.size === 0 || r.size === 1 || r.size === 2) &&
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

/**
 * True when `d` stores exactly one side (or null) for every doctrine pair, and that side belongs to the pair.
 * One slot per pair is what keeps the two sides exclusive.
 */
function isDoctrines(d: unknown): boolean {
  if (!isObj(d) || Array.isArray(d)) return false;
  if (Object.keys(d).length !== DOCTRINE_PAIR_IDS.length) return false;
  return DOCTRINE_PAIR_IDS.every((pair) => {
    const side = d[pair];
    return side === null || isDoctrineSide(pair, side);
  });
}

const COST_KEYS = ['data', ...RESOURCES] as const;

/** True when `c` has a finite, non-negative number for Horizon Data and every resource. */
function isGateCost(c: unknown): c is GateCost {
  if (!isObj(c)) return false;
  return COST_KEYS.every((k) => finite(c[k]) && c[k] >= 0);
}

/**
 * True when the gate is a stage index the HUD can render, the paid columns fit that stage,
 * and a finished gate carries exactly one summary. A fully paid stage that never advanced
 * would open the gate twice, so it is rejected.
 */
const GATE_FIELDS = ['acknowledged', 'paid', 'stage', 'summary'] as const;

function isGate(g: unknown): boolean {
  if (!isObj(g) || Array.isArray(g)) return false;
  const keys = Object.keys(g);
  if (keys.length !== GATE_FIELDS.length || GATE_FIELDS.some((k) => !Object.hasOwn(g, k))) return false;
  if (typeof g.stage !== 'number' || !Number.isInteger(g.stage)) return false;
  if (g.stage < 0 || g.stage > GATE_STAGES.length) return false;
  if (!isGateCost(g.paid) || typeof g.acknowledged !== 'boolean') return false;
  const paid = g.paid;
  const open = g.stage === GATE_STAGES.length;
  if (open) {
    if (paid.data !== 0 || RESOURCES.some((r) => paid[r] !== 0) || !isObj(g.summary)) return false;
    const s = g.summary;
    if (typeof s.warps !== 'number' || !Number.isInteger(s.warps) || s.warps < 0) return false;
    if (!finite(s.time) || s.time < 0 || !finite(s.rocksBroken) || s.rocksBroken < 0) return false;
    if (!finite(s.unitsMined) || s.unitsMined < 0 || !finite(s.contracts) || s.contracts < 0) return false;
    if (!finite(s.refined) || s.refined < 0 || !finite(s.dataEarned) || s.dataEarned < 0) return false;
    return isDoctrines(s.doctrines);
  }
  if (g.summary !== null || g.acknowledged) return false;
  const cost = GATE_STAGES[g.stage]!.cost;
  const over = (key: keyof GateCost): boolean => paid[key] > cost[key] + 1e-6;
  // A column above its bill, or a stage that is already fully paid, never leaves the handler.
  if (over('data') || RESOURCES.some((r) => over(r))) return false;
  return !stageMet(paid, cost);
}

/** True when `p` has a seed, a warp count, data totals, a finite level for every perk, one side per doctrine, well-formed lifetime stats and a first-steps flag. */
function isProfile(p: Profile | undefined): p is Profile {
  if (!p || !finite(p.seed) || !isObj(p.perks)) return false;
  // The next warp numbers its system from the warp count, and research spends data.
  if (!Number.isInteger(p.warps) || p.warps < 0 || !finite(p.data) || !finite(p.dataEarned)) return false;
  // Stats, costs and the refinery read every perk level, so each must be a finite number.
  if (!PERK_IDS.every((k) => finite(p.perks[k]))) return false;
  // The tick reads every pair. A side from another pair would apply the wrong trade-off.
  if (!isDoctrines(p.doctrines)) return false;
  // The HUD reads the first-steps flag and the gate on every refresh.
  if (typeof p.goalsDismissed !== 'boolean' || !isGate(p.gate)) return false;
  // The tick adds to every stat and the Stats tab looks up every unlocked achievement.
  return isLifetime(p);
}

/** True when `c` is a contract the tick can age, complete and describe: a known kind, finite numbers, a sane reward. */
function isContract(c: unknown): boolean {
  if (!isObj(c)) return false;
  const reward = c.reward;
  return (
    finite(c.id) &&
    typeof c.kind === 'string' &&
    Object.hasOwn(CONTRACTS, c.kind) &&
    finite(c.target) &&
    finite(c.progress) &&
    finite(c.timeLimit) &&
    finite(c.timeLeft) &&
    finite(c.data) &&
    isObj(reward) &&
    !Array.isArray(reward) &&
    Object.entries(reward).every(([k, n]) => (RESOURCES as readonly string[]).includes(k) && finite(n))
  );
}

/** True when the contract board has everything the tick walks: offers, the active contract, counters and RNG state. */
function isBoard(b: unknown): boolean {
  return (
    isObj(b) &&
    Array.isArray(b.offers) &&
    b.offers.every(isContract) &&
    (b.active === null || isContract(b.active)) &&
    finite(b.nextId) &&
    finite(b.completed) &&
    finite(b.failed) &&
    finite(b.rewardValue) &&
    isRng(b.rng)
  );
}

/** True when `p` is a planet (or moon) the tick can turn: a finite angle and speed, and turnable moons. */
function isOrbiter(p: unknown, moons: boolean): boolean {
  if (!isObj(p) || !finite(p.angle) || !finite(p.speed)) return false;
  return !moons || (Array.isArray(p.moons) && p.moons.every((m) => isOrbiter(m, false)));
}

/** True when the system's star, planets and scalars are what the tick, hazards and contracts read. */
function isSystem(sys: unknown): boolean {
  if (!isObj(sys)) return false;
  const { belts, station, planets } = sys;
  return (
    typeof sys.name === 'string' &&
    finite(sys.number) &&
    (sys.starClass === 'M' || sys.starClass === 'G' || sys.starClass === 'B') &&
    finite(sys.starRadius) &&
    finite(sys.heatRadius) &&
    finite(sys.richness) &&
    Array.isArray(planets) &&
    planets.every((p) => isOrbiter(p, true)) &&
    // Comets roll a belt to cross, so there must be at least one.
    Array.isArray(belts) &&
    belts.length > 0 &&
    belts.every(isBelt) &&
    isObj(station) &&
    isVec(station.pos) &&
    isModifierList(sys.modifiers)
  );
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

/** True when every item has a unique finite `id`. */
function hasUniqueIds(items: unknown[]): boolean {
  const seen = new Set<number>();
  for (const item of items) {
    if (!isObj(item) || !finite(item.id)) return false;
    if (seen.has(item.id as number)) return false;
    seen.add(item.id as number);
  }
  return true;
}

/** Validates the shape of a migrated save, returning a runnable state or null. */
export function validateState(data: SaveData): GameState | null {
  const { profile, run } = data as { profile?: Profile; run?: Run };
  if (!isProfile(profile)) return null;
  if (!run || !run.system || !Array.isArray(run.ships) || !Array.isArray(run.rocks) || !Array.isArray(run.pickups))
    return null;
  // The tick steps these every frame, so a missing or non-finite one would turn NaN and stay that way.
  if (!isRng(run.rng) || !finite(run.nextId) || !finite(run.time) || !finite(run.runValue)) return null;
  if (!finite(run.regrowTimer) || !finite(run.selectedId)) return null;
  if (!isSystem(run.system)) return null;
  if (!run.rocks.every(isRock) || !run.pickups.every(isPickup)) return null;
  // Duplicate ids would cause tick logic to operate on the wrong entity.
  if (!hasUniqueIds(run.ships) || !hasUniqueIds(run.rocks)) return null;
  // A wallet missing a resource column (e.g. alloy) would poison every later
  // read with NaN, so the bank must be complete (ship cargo is checked by isShip).
  if (!isWallet(run.bank) || !run.ships.every(isShip)) return null;
  if (!isBoard(run.contracts)) return null;
  if (!run.ships.some((s) => s.hullId === 'prospector' || s.hullId === 'excavator')) return null;
  if (!isRefinery(run.refinery)) return null;
  if (!isHazards(run.hazards)) return null;
  if (!isAutomation(run.automation, run.rocks)) return null;
  return { version: data.version, profile, run, out: { fx: [], log: [], status: new Map() } };
}
