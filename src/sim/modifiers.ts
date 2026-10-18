// System modifiers: rolling them for a system, folding them into multipliers
// and describing them for the HUD. Pure; uses its own RNG stream so the
// system generator's draws are unchanged.

import { chance, makeRng, pick } from '../core/rng';
import { MODIFIERS, MODIFIER_IDS, type ModifierDef, type ModifierId } from '../data/modifiers';
import type { RawResource } from '../data/resources';
import { TUNING } from '../data/tuning';
import type { ShipStats } from './ships';
import type { Belt, StarSystem } from './types';

export interface SystemEffects {
  beltCount: number;
  mix: Record<RawResource, number>;
  magnet: number;
  regrowInterval: number;
}

const KINDS: readonly RawResource[] = ['ore', 'ice', 'crystal'];

/** Modifiers for a system: none before `modifierMinSystem`, then one or two distinct ones. */
export function rollModifiers(seed: number, number: number): ModifierId[] {
  if (number < TUNING.modifierMinSystem) return [];
  const r = makeRng((seed ^ 0x2c1b3c6d) + number * 15485863);
  const count = chance(r, TUNING.modifierTwoChance) ? 2 : 1;
  const left = [...MODIFIER_IDS];
  const out: ModifierId[] = [];
  for (let i = 0; i < count; i++) {
    const id = pick(r, left);
    left.splice(left.indexOf(id), 1);
    out.push(id);
  }
  return out;
}

/** The product of every modifier's multipliers; 1 where a modifier says nothing. */
export function systemEffects(mods: readonly ModifierId[]): SystemEffects {
  const fx: SystemEffects = { beltCount: 1, mix: { ore: 1, ice: 1, crystal: 1 }, magnet: 1, regrowInterval: 1 };
  for (const id of mods) {
    const m = MODIFIERS[id];
    fx.beltCount *= m.beltCount ?? 1;
    fx.magnet *= m.magnet ?? 1;
    fx.regrowInterval *= m.regrowInterval ?? 1;
    for (const k of KINDS) fx.mix[k] *= m.mix?.[k] ?? 1;
  }
  return fx;
}

/** Scales every belt's rock count and mix weights in place. */
export function applyBeltModifiers(belts: Belt[], mods: readonly ModifierId[]): void {
  const fx = systemEffects(mods);
  for (const b of belts) {
    b.initialCount = Math.round(b.initialCount * fx.beltCount);
    for (const k of KINDS) b.mix[k] *= fx.mix[k];
  }
}

/** Folds already-computed system effects into a ship's stats (in place) and returns them. */
export function applyEffects(st: ShipStats, fx: SystemEffects): ShipStats {
  st.magnet *= fx.magnet;
  return st;
}

/** Applies the system's pickup-radius effect to a ship's stats (in place) and returns them. */
export function applySystemStats(st: ShipStats, system: StarSystem): ShipStats {
  return applyEffects(st, systemEffects(system.modifiers));
}

const pct = (x: number): string => `${x >= 1 ? '+' : '−'}${Math.round(Math.abs(x - 1) * 100)}%`;
const times = (x: number): string => `${Number(x.toFixed(1))}×`;

/** Effect text for a definition, built from its numbers so it cannot go stale. */
export function describeDef(def: ModifierDef): string {
  const parts: string[] = [];
  if (def.beltCount !== undefined) parts.push(`${pct(def.beltCount)} asteroids`);
  for (const [k, x] of Object.entries(def.mix ?? {})) parts.push(`${pct(x)} ${k} rocks`);
  if (def.magnet !== undefined) parts.push(`${pct(def.magnet)} pickup radius`);
  if (def.regrowInterval !== undefined) {
    const speed = 1 / def.regrowInterval;
    parts.push(speed >= 1 ? `belts regrow ${times(speed)} faster` : `belts regrow ${times(def.regrowInterval)} slower`);
  }
  return parts.join(', ');
}

/** Effect text for one modifier. */
export function describeModifier(id: ModifierId): string {
  return describeDef(MODIFIERS[id]);
}

/** `Dense belt (+40% asteroids) · Nebula (…)`; empty for none. */
export function describeModifiers(mods: readonly ModifierId[]): string {
  return mods.map((id) => `${MODIFIERS[id].name} (${describeModifier(id)})`).join(' · ');
}
