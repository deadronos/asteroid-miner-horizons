// Hull types. A hull fixes base stats, how many component slots a ship starts
// with, and how many it can be expanded to at the station (#141).
// Flagship hulls replace your command ship (keeping fitted parts); drone hulls
// are bought as extra autonomous fleet members, and hauler hulls are fleet
// members that ferry cargo from miners and outposts instead of mining, and
// builder hulls are fleet members that build outposts instead of mining.

import type { ComponentId, Tier, VariantId } from './components';
import type { Cost } from './resources';

export type HullId = 'prospector' | 'excavator' | 'drone' | 'harvester' | 'hauler' | 'constructionDrone';

export interface HullDef {
  id: HullId;
  name: string;
  role: 'flagship' | 'drone' | 'hauler' | 'builder';
  /** Slots a new ship of this hull starts with. */
  slots: number;
  /** Slots it can be expanded to by buying more at the station. */
  maxSlots: number;
  hull: number;
  speed: number;
  accel: number;
  cargo: number;
  magnet: number;
  /** Collision radius in world units. */
  size: number;
  cost: Cost;
  loadout: ({ type: ComponentId; variant: VariantId; tier: Tier } | null)[];
  color: number;
}

export const HULLS: Record<HullId, HullDef> = {
  prospector: {
    id: 'prospector',
    name: 'Prospector',
    role: 'flagship',
    slots: 4,
    maxSlots: 6,
    hull: 100,
    speed: 105,
    accel: 340,
    cargo: 80,
    magnet: 70,
    size: 11,
    cost: {},
    loadout: [{ type: 'laser', variant: 'focused', tier: 1 }, { type: 'engine', variant: 'ion', tier: 1 }, null, null],
    color: 0xffd659,
  },
  excavator: {
    id: 'excavator',
    name: 'Excavator',
    role: 'flagship',
    slots: 6,
    maxSlots: 8,
    hull: 240,
    speed: 95,
    accel: 280,
    cargo: 160,
    magnet: 85,
    size: 15,
    cost: { ore: 300, alloy: 150, ice: 300 },
    loadout: [],
    color: 0xffb13d,
  },
  drone: {
    id: 'drone',
    name: 'Mining Drone',
    role: 'drone',
    slots: 2,
    maxSlots: 6,
    hull: 45,
    speed: 90,
    accel: 300,
    cargo: 40,
    magnet: 55,
    size: 8,
    cost: { ore: 70, ice: 8 },
    loadout: [{ type: 'laser', variant: 'focused', tier: 1 }, null],
    color: 0x59c2ff,
  },
  harvester: {
    id: 'harvester',
    name: 'Harvester',
    role: 'drone',
    slots: 3,
    maxSlots: 6,
    hull: 110,
    speed: 85,
    accel: 260,
    cargo: 90,
    magnet: 65,
    size: 11,
    cost: { ore: 150, alloy: 50, ice: 120 },
    loadout: [{ type: 'laser', variant: 'focused', tier: 1 }, { type: 'cargo', variant: 'standard', tier: 1 }, null],
    color: 0x7fe0c8,
  },
  hauler: {
    id: 'hauler',
    name: 'Hauler',
    role: 'hauler',
    slots: 2,
    maxSlots: 6,
    hull: 80,
    speed: 115,
    accel: 300,
    cargo: 140,
    magnet: 50,
    size: 10,
    cost: { ore: 160, ice: 25, alloy: 20 },
    loadout: [{ type: 'engine', variant: 'ion', tier: 1 }, null],
    color: 0xc9a2ff,
  },
  constructionDrone: {
    id: 'constructionDrone',
    name: 'Construction Drone',
    role: 'builder',
    slots: 2,
    maxSlots: 6,
    hull: 60,
    speed: 95,
    accel: 300,
    cargo: 70,
    magnet: 50,
    size: 9,
    cost: { ore: 80, ice: 10, alloy: 10 },
    loadout: [],
    color: 0xffa86b,
  },
};

export const HULL_IDS = Object.keys(HULLS) as HullId[];
