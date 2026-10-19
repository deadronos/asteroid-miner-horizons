// Ship components. Every hull has N generic slots; each slot holds one
// component variant at tier 1–3. Effects stack across slots (two lasers = more
// DPS). Variants are ordered: `variants[0]` is the default, which carries
// today's numbers so an unfitted choice is behaviour-preserving.

import type { Cost } from './resources';

export type ComponentId = 'laser' | 'engine' | 'shield' | 'armor' | 'cargo' | 'sensor';
export type Tier = 1 | 2 | 3;
export type VariantId = 'focused' | 'wide' | 'ion' | 'thruster' | 'standard';

/** Every derived ship stat; `ShipStats` (sim/ships) is built from this list. */
export type ShipStatKey =
  | 'maxHull'
  | 'maxShield'
  | 'shieldRegen'
  | 'speed'
  | 'accel'
  | 'dps'
  | 'range'
  | 'magnet'
  | 'cargoCap'
  | 'dmgMul'
  | 'size'
  | 'splash'
  | 'laserTier';

export type EffectOp = 'add' | 'max' | 'mul';

/** One number per tier (index 0 = tier 1). */
export type PerTier = readonly [number, number, number];

/**
 * One stat contribution per tier. Effects apply in slot order, so give each
 * stat a single kind of op: add, max and mul don't commute when mixed.
 */
export interface Effect {
  stat: ShipStatKey;
  op: EffectOp;
  values: PerTier;
}

/** One sidegrade of a component; `variants[0]` of its family is the default. */
export interface VariantDef {
  id: VariantId;
  /** Fitted name, e.g. 'Wide Beam'. */
  name: string;
  /** Compact glyph for the HUD, e.g. 'WDE'. */
  short: string;
  /** Human-readable effect per tier, index 0 = tier 1. */
  describe: (tier: Tier) => string;
  /** Price to install at tier 1, or to upgrade into the given tier. */
  cost: (tier: Tier) => Cost;
  /** How fitting this variant changes the ship's stats. */
  effects: Effect[];
}

export interface ComponentDef {
  id: ComponentId;
  /** Family name, e.g. 'Mining Laser'. */
  name: string;
  /** Ordered variants; `[0]` is the default. */
  variants: readonly VariantDef[];
}

// Numbers per tier (index tier-1). Kept here so the sim and the UI agree.
// Tier 1 is the starter laser and every drone's first (often only) laser, so it
// sets the whole opening pace: raised from 18 to 26 so the first large rock
// breaks in ~6 s and the first drone lands under 4 min (#45).
export const LASER_DPS = [26, 32, 55] as const;
export const LASER_RANGE = [170, 205, 250] as const;
export const ENGINE_SPEED = [30, 60, 95] as const;
export const SHIELD_CAP = [35, 75, 130] as const;
export const SHIELD_REGEN = [3, 6, 10] as const;
export const ARMOR_HULL = [40, 90, 170] as const;
export const ARMOR_DMG_MUL = [0.9, 0.8, 0.68] as const;
export const CARGO_CAP = [50, 120, 240] as const;
export const SENSOR_MAGNET = [50, 100, 170] as const;
/** An engine adds three times its speed bonus as acceleration. */
export const ENGINE_ACCEL: PerTier = [ENGINE_SPEED[0] * 3, ENGINE_SPEED[1] * 3, ENGINE_SPEED[2] * 3];

// The Wide Beam trades dps and range for a splash radius; the Vector Thruster
// trades top speed for acceleration (#49).
export const WIDE_LASER_DPS = [18, 23, 38] as const;
export const WIDE_LASER_RANGE = [150, 180, 220] as const;
export const SPLASH_RADIUS = [45, 60, 80] as const;
export const THRUSTER_SPEED = [22, 45, 70] as const;
export const THRUSTER_ACCEL = [120, 240, 380] as const;

const tiered =
  (mul: number) =>
  (tier: Tier): Cost =>
    tier === 1
      ? { ore: Math.round(25 * mul) }
      : tier === 2
        ? { ore: Math.round(120 * mul), ice: Math.round(40 * mul) }
        : {
            ore: Math.round(100 * mul),
            alloy: Math.round(80 * mul),
            ice: Math.round(160 * mul),
            crystal: Math.round(18 * mul),
          };

export const COMPONENTS: Record<ComponentId, ComponentDef> = {
  laser: {
    id: 'laser',
    name: 'Mining Laser',
    variants: [
      {
        id: 'focused',
        name: 'Focused Beam',
        short: 'FCS',
        describe: (t) => `${LASER_DPS[t - 1]} dps · ${LASER_RANGE[t - 1]} range`,
        cost: tiered(1.25),
        effects: [
          { stat: 'dps', op: 'add', values: LASER_DPS },
          { stat: 'range', op: 'max', values: LASER_RANGE },
          { stat: 'laserTier', op: 'max', values: [1, 2, 3] as const },
        ],
      },
      {
        id: 'wide',
        name: 'Wide Beam',
        short: 'WDE',
        describe: (t) =>
          `${WIDE_LASER_DPS[t - 1]} dps · ${WIDE_LASER_RANGE[t - 1]} range · ${SPLASH_RADIUS[t - 1]} splash`,
        cost: tiered(1.05),
        effects: [
          { stat: 'dps', op: 'add', values: WIDE_LASER_DPS },
          { stat: 'range', op: 'max', values: WIDE_LASER_RANGE },
          { stat: 'splash', op: 'add', values: SPLASH_RADIUS },
          { stat: 'laserTier', op: 'max', values: [1, 2, 3] as const },
        ],
      },
    ],
  },
  engine: {
    id: 'engine',
    name: 'Ion Engine',
    variants: [
      {
        id: 'ion',
        name: 'Standard Drive',
        short: 'ION',
        describe: (t) => `+${ENGINE_SPEED[t - 1]} top speed`,
        cost: tiered(1),
        effects: [
          { stat: 'speed', op: 'add', values: ENGINE_SPEED },
          { stat: 'accel', op: 'add', values: ENGINE_ACCEL },
        ],
      },
      {
        id: 'thruster',
        name: 'Vector Thruster',
        short: 'VTR',
        describe: (t) => `+${THRUSTER_SPEED[t - 1]} top speed · +${THRUSTER_ACCEL[t - 1]} accel`,
        cost: tiered(0.95),
        effects: [
          { stat: 'speed', op: 'add', values: THRUSTER_SPEED },
          { stat: 'accel', op: 'add', values: THRUSTER_ACCEL },
        ],
      },
    ],
  },
  shield: {
    id: 'shield',
    name: 'Deflector Shield',
    variants: [
      {
        id: 'standard',
        name: 'Deflector Shield',
        short: 'SHD',
        describe: (t) => `+${SHIELD_CAP[t - 1]} shield · ${SHIELD_REGEN[t - 1]}/s regen`,
        cost: tiered(1),
        effects: [
          { stat: 'maxShield', op: 'add', values: SHIELD_CAP },
          { stat: 'shieldRegen', op: 'add', values: SHIELD_REGEN },
        ],
      },
    ],
  },
  armor: {
    id: 'armor',
    name: 'Composite Armor',
    variants: [
      {
        id: 'standard',
        name: 'Composite Armor',
        short: 'ARM',
        describe: (t) => `+${ARMOR_HULL[t - 1]} hull · −${Math.round((1 - ARMOR_DMG_MUL[t - 1]) * 100)}% damage`,
        cost: tiered(1),
        effects: [
          { stat: 'maxHull', op: 'add', values: ARMOR_HULL },
          { stat: 'dmgMul', op: 'mul', values: ARMOR_DMG_MUL },
        ],
      },
    ],
  },
  cargo: {
    id: 'cargo',
    name: 'Cargo Pod',
    variants: [
      {
        id: 'standard',
        name: 'Cargo Pod',
        short: 'CRG',
        describe: (t) => `+${CARGO_CAP[t - 1]} cargo`,
        cost: tiered(0.8),
        effects: [{ stat: 'cargoCap', op: 'add', values: CARGO_CAP }],
      },
    ],
  },
  sensor: {
    id: 'sensor',
    name: 'Sensor & Tractor Array',
    variants: [
      {
        id: 'standard',
        name: 'Sensor & Tractor Array',
        short: 'SNS',
        describe: (t) => `+${SENSOR_MAGNET[t - 1]} pickup radius`,
        cost: tiered(0.9),
        effects: [{ stat: 'magnet', op: 'add', values: SENSOR_MAGNET }],
      },
    ],
  },
};

export const COMPONENT_IDS = Object.keys(COMPONENTS) as ComponentId[];

/** A component's default variant (its first), the one an install fits by default. */
export function defaultVariant(type: ComponentId): VariantId {
  return COMPONENTS[type].variants[0]!.id;
}

/** A variant's definition; an unknown id falls back to the component's default. */
export function variantDef(type: ComponentId, variant: VariantId): VariantDef {
  const defs = COMPONENTS[type].variants;
  // Indexed loop, not `.find`: this runs per fitted slot per tick (ships.ts).
  for (let i = 0; i < defs.length; i++) if (defs[i]!.id === variant) return defs[i]!;
  return defs[0]!;
}

/** True when `variant` is one of `type`'s variants. */
export function isVariant(type: ComponentId, variant: unknown): variant is VariantId {
  return COMPONENTS[type].variants.some((v) => v.id === variant);
}
