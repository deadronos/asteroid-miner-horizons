// Permanent prestige perks, bought with Horizon Data earned by warping.
// They survive warps; everything else in a run is reset.

export type PerkId = 'yield' | 'optics' | 'thrust' | 'bay' | 'kit' | 'warp';

export interface PerkDef {
  id: PerkId;
  name: string;
  describe: (level: number) => string;
  max: number;
  /** Horizon Data cost to go from `level` to `level + 1`. */
  cost: (level: number) => number;
}

export const PERKS: Record<PerkId, PerkDef> = {
  yield: {
    id: 'yield',
    name: 'Refined Assays',
    describe: (l) => `+${l * 10}% resource yield`,
    max: 10,
    cost: (l) => 1 + l,
  },
  optics: {
    id: 'optics',
    name: 'Focused Optics',
    describe: (l) => `+${l * 12}% laser damage`,
    max: 10,
    cost: (l) => 1 + l,
  },
  thrust: {
    id: 'thrust',
    name: 'Gravitic Thrusters',
    describe: (l) => `+${l * 8}% ship speed`,
    max: 8,
    cost: (l) => 1 + l,
  },
  bay: {
    id: 'bay',
    name: 'Drone Bay',
    describe: (l) => `+${l} fleet capacity`,
    max: 4,
    cost: (l) => 3 * (l + 1),
  },
  kit: {
    id: 'kit',
    name: 'Starter Kit',
    describe: (l) => `start each system with +${l * 80} ore, +${l * 25} ice${l >= 3 ? ', a free drone' : ''}`,
    max: 5,
    cost: (l) => 1 + l,
  },
  warp: {
    id: 'warp',
    name: 'Warp Theory',
    describe: (l) => `−${l * 8}% warp fuel cost`,
    max: 5,
    cost: (l) => 2 * (l + 1),
  },
};

export const PERK_IDS = Object.keys(PERKS) as PerkId[];
