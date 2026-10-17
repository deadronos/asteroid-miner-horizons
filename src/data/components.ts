// Ship components. Every hull has N generic slots; each slot holds one
// component at tier 1–3. Effects stack across slots (two lasers = more DPS).

import type { Cost } from './resources';

export type ComponentId = 'laser' | 'engine' | 'shield' | 'armor' | 'cargo' | 'sensor';
export type Tier = 1 | 2 | 3;

export interface ComponentDef {
  id: ComponentId;
  name: string;
  short: string;
  /** Human-readable effect per tier, index 0 = tier 1. */
  describe: (tier: Tier) => string;
  /** Price to install at tier 1, or to upgrade into the given tier. */
  cost: (tier: Tier) => Cost;
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
  },
  engine: {
    id: 'engine',
    name: 'Ion Engine',
    short: 'ENG',
    describe: (t) => `+${ENGINE_SPEED[t - 1]} top speed`,
    cost: tiered(1),
  },
  shield: {
    id: 'shield',
    name: 'Deflector Shield',
    short: 'SHD',
    describe: (t) => `+${SHIELD_CAP[t - 1]} shield · ${SHIELD_REGEN[t - 1]}/s regen`,
    cost: tiered(1),
  },
  armor: {
    id: 'armor',
    name: 'Composite Armor',
    short: 'ARM',
    describe: (t) => `+${ARMOR_HULL[t - 1]} hull · −${Math.round((1 - ARMOR_DMG_MUL[t - 1]) * 100)}% damage`,
    cost: tiered(1),
  },
  cargo: {
    id: 'cargo',
    name: 'Cargo Pod',
    short: 'CRG',
    describe: (t) => `+${CARGO_CAP[t - 1]} cargo`,
    cost: tiered(0.8),
  },
  sensor: {
    id: 'sensor',
    name: 'Sensor & Tractor Array',
    short: 'SNS',
    describe: (t) => `+${SENSOR_MAGNET[t - 1]} pickup radius`,
    cost: tiered(0.9),
  },
};

export const COMPONENT_IDS = Object.keys(COMPONENTS) as ComponentId[];
