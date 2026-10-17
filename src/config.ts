// Shared tuning + component catalogue for Asteroid Miner Horizons.
// Internal map is 2D: every position is { x, z } on the ecliptic plane.

export interface ComponentDef {
  key: SlotKey;
  name: string;
  blurb: string;
  maxLevel: number;
  /** ore cost to go from level n to n+1 (n is zero-based current level) */
  cost: (level: number) => number;
}

export type SlotKey = 'engine' | 'laser' | 'shield' | 'armor' | 'sensor';

export const COMPONENTS: Record<SlotKey, ComponentDef> = {
  engine: {
    key: 'engine',
    name: 'Ion Engines',
    blurb: '+18% thrust & top speed per level',
    maxLevel: 5,
    cost: (l) => 20 * 2 ** l,
  },
  laser: {
    key: 'laser',
    name: 'Mining Laser',
    blurb: '+40% damage, +12% range per level',
    maxLevel: 5,
    cost: (l) => 25 * 2 ** l,
  },
  shield: {
    key: 'shield',
    name: 'Deflector Shield',
    blurb: '+30 capacity, +2/s regen per level',
    maxLevel: 5,
    cost: (l) => 20 * 2 ** l,
  },
  armor: {
    key: 'armor',
    name: 'Hull Armor',
    blurb: '−8% collision & heat damage per level',
    maxLevel: 5,
    cost: (l) => 20 * 2 ** l,
  },
  sensor: {
    key: 'sensor',
    name: 'Deep Sensors',
    blurb: '+25 pickup & assist range per level',
    maxLevel: 5,
    cost: (l) => 15 * 2 ** l,
  },
};

export const TUNING = {
  baseSpeed: 95,
  baseAccel: 320,
  baseLaserDps: 14,
  baseLaserRange: 175,
  basePickupRadius: 75,
  collectRadius: 18,
  cargoCap: 220,
  droneOreCost: 60,
  droneIceCost: 20,
  maxFleet: 5,
  warpIceCost: 40,
  prestigeYieldBonus: 0.1, // +10% drops per warp
  prestigeSpeedBonus: 0.05,
  shieldBase: 30,
  shieldRegenBase: 4,
  repairOrePerHull: 0.25, // 1 ore per 4 hull
  starHeatRadiusPad: 90,
  starHeatDps: 12,
  collisionCooldown: 0.6,
  simStep: 1 / 60,
} as const;

export interface Vec2 {
  x: number;
  z: number;
}
