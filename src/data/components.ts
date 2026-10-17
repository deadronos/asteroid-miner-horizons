// Ship components. Every hull has N generic slots; each slot holds one
// component at tier 1–3. Effects stack across slots (two lasers = more DPS).

import type { Cost } from './resources';

export type ComponentId = 'laser' | 'engine' | 'shield' | 'armor' | 'cargo' | 'sensor';
export type Tier = 1 | 2 | 3;

/** Every numeric stat a fitted component can contribute to. Mirrors ShipStats. */
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
  | 'size';

export type EffectOp = 'add' | 'max' | 'mul';

/** One stat contribution per tier (index 0 = tier 1). */
export interface Effect {
  stat: ShipStatKey;
  op: EffectOp;
  values: readonly number[];
}

export interface ComponentDef {
  id: ComponentId;
  name: string;
  short: string;
  /** Human-readable effect per tier, index 0 = tier 1. */
  describe: (tier: Tier) => string;
  /** Price to install at tier 1, or to upgrade into the given tier. */
  cost: (tier: Tier) => Cost;
  /** How fitting this component changes the ship's stats. */
  effects: Effect[];
}

// Numbers per tier (index tier-1). Kept here so the sim and the UI agree.
export const LASER_DPS = [18, 32, 55] as const;
export const LASER_RANGE = [170, 205, 250] as const;
export const ENGINE_SPEED = [30, 60, 95] as const;
export const SHIELD_CAP = [35, 75, 130] as const;
export const SHIELD_REGEN = [3, 6, 10] as const;
export const ARMOR_HULL = [40, 90, 170] as const;
export const ARMOR_DMG_MUL = [0.9, 0.8, 0.68] as const;
export const CARGO_CAP = [50, 120, 240] as const;
export const SENSOR_MAGNET = [50, 100, 170] as const;
/** An engine adds three times its speed bonus as acceleration. */
export const ENGINE_ACCEL = ENGINE_SPEED.map((v) => v * 3);

const tiered =
  (mul: number) =>
  (tier: Tier): Cost =>
    tier === 1
      ? { ore: Math.round(25 * mul) }
      : tier === 2
        ? { ore: Math.round(120 * mul), ice: Math.round(40 * mul) }
        : { ore: Math.round(420 * mul), ice: Math.round(160 * mul), crystal: Math.round(18 * mul) };

export const COMPONENTS: Record<ComponentId, ComponentDef> = {
  laser: {
    id: 'laser',
    name: 'Mining Laser',
    short: 'LSR',
    describe: (t) => `${LASER_DPS[t - 1]} dps · ${LASER_RANGE[t - 1]} range`,
    cost: tiered(1.25),
    effects: [
      { stat: 'dps', op: 'add', values: LASER_DPS },
      { stat: 'range', op: 'max', values: LASER_RANGE },
    ],
  },
  engine: {
    id: 'engine',
    name: 'Ion Engine',
    short: 'ENG',
    describe: (t) => `+${ENGINE_SPEED[t - 1]} top speed`,
    cost: tiered(1),
    effects: [
      { stat: 'speed', op: 'add', values: ENGINE_SPEED },
      { stat: 'accel', op: 'add', values: ENGINE_ACCEL },
    ],
  },
  shield: {
    id: 'shield',
    name: 'Deflector Shield',
    short: 'SHD',
    describe: (t) => `+${SHIELD_CAP[t - 1]} shield · ${SHIELD_REGEN[t - 1]}/s regen`,
    cost: tiered(1),
    effects: [
      { stat: 'maxShield', op: 'add', values: SHIELD_CAP },
      { stat: 'shieldRegen', op: 'add', values: SHIELD_REGEN },
    ],
  },
  armor: {
    id: 'armor',
    name: 'Composite Armor',
    short: 'ARM',
    describe: (t) => `+${ARMOR_HULL[t - 1]} hull · −${Math.round((1 - ARMOR_DMG_MUL[t - 1]) * 100)}% damage`,
    cost: tiered(1),
    effects: [
      { stat: 'maxHull', op: 'add', values: ARMOR_HULL },
      { stat: 'dmgMul', op: 'mul', values: ARMOR_DMG_MUL },
    ],
  },
  cargo: {
    id: 'cargo',
    name: 'Cargo Pod',
    short: 'CRG',
    describe: (t) => `+${CARGO_CAP[t - 1]} cargo`,
    cost: tiered(0.8),
    effects: [{ stat: 'cargoCap', op: 'add', values: CARGO_CAP }],
  },
  sensor: {
    id: 'sensor',
    name: 'Sensor & Tractor Array',
    short: 'SNS',
    describe: (t) => `+${SENSOR_MAGNET[t - 1]} pickup radius`,
    cost: tiered(0.9),
    effects: [{ stat: 'magnet', op: 'add', values: SENSOR_MAGNET }],
  },
};

export const COMPONENT_IDS = Object.keys(COMPONENTS) as ComponentId[];
