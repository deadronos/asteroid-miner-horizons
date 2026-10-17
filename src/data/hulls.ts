// Hull types. A hull fixes base stats and how many component slots a ship has.
// Flagship hulls replace your command ship (keeping fitted parts); drone hulls
// are bought as extra autonomous fleet members.

import type { ComponentId, Tier } from './components';
import type { Cost } from './resources';

export type HullId = 'prospector' | 'excavator' | 'drone' | 'harvester';

export interface HullDef {
  id: HullId;
  name: string;
  role: 'flagship' | 'drone';
  slots: number;
  hull: number;
  speed: number;
  accel: number;
  cargo: number;
  magnet: number;
  /** Collision radius in world units. */
  size: number;
  cost: Cost;
  loadout: ({ type: ComponentId; tier: Tier } | null)[];
  color: number;
}

export const HULLS: Record<HullId, HullDef> = {
  prospector: {
    id: 'prospector',
    name: 'Prospector',
    role: 'flagship',
    slots: 4,
    hull: 100,
    speed: 105,
    accel: 340,
    cargo: 80,
    magnet: 70,
    size: 11,
    cost: {},
    loadout: [{ type: 'laser', tier: 1 }, { type: 'engine', tier: 1 }, null, null],
    color: 0xffd659,
  },
  excavator: {
    id: 'excavator',
    name: 'Excavator',
    role: 'flagship',
    slots: 6,
    hull: 240,
    speed: 95,
    accel: 280,
    cargo: 160,
    magnet: 85,
    size: 15,
    cost: { ore: 900, ice: 300 },
    loadout: [],
    color: 0xffb13d,
  },
  drone: {
    id: 'drone',
    name: 'Mining Drone',
    role: 'drone',
    slots: 2,
    hull: 45,
    speed: 90,
    accel: 300,
    cargo: 40,
    magnet: 55,
    size: 8,
    cost: { ore: 80, ice: 25 },
    loadout: [{ type: 'laser', tier: 1 }, null],
    color: 0x59c2ff,
  },
  harvester: {
    id: 'harvester',
    name: 'Harvester',
    role: 'drone',
    slots: 3,
    hull: 110,
    speed: 85,
    accel: 260,
    cargo: 90,
    magnet: 65,
    size: 11,
    cost: { ore: 350, ice: 120 },
    loadout: [{ type: 'laser', tier: 1 }, { type: 'cargo', tier: 1 }, null],
    color: 0x7fe0c8,
  },
};

export const HULL_IDS = Object.keys(HULLS) as HullId[];
