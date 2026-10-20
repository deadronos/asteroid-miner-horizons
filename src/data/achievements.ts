// Lifetime stats and the achievements they unlock. Stats live in the profile, so
// they survive warps; each achievement is a threshold on one stat.

export const STAT_KEYS = [
  'time',
  'rocksBroken',
  'unitsMined',
  'warps',
  'contracts',
  'refined',
  'outposts',
  'drones',
  'miningDrones',
  'unloads',
  'installs',
  'perks',
  'comets',
  'shipsLost',
] as const;

export type StatKey = (typeof STAT_KEYS)[number];

export type LifetimeStats = Record<StatKey, number>;

/** Player-facing stat names, in the order the Stats tab lists them. */
export const STAT_LABELS: Record<StatKey, string> = {
  time: 'Time played',
  rocksBroken: 'Asteroids broken',
  unitsMined: 'Units mined',
  warps: 'Warps',
  contracts: 'Contracts completed',
  refined: 'Units refined',
  outposts: 'Outposts deployed',
  drones: 'Drones and haulers launched',
  miningDrones: 'Mining drones bought',
  unloads: 'Flagship unloads',
  installs: 'Components installed by hand',
  perks: 'Research levels bought',
  comets: 'Comets weathered',
  shipsLost: 'Ships lost',
};

export interface AchievementDef {
  name: string;
  desc: string;
  stat: StatKey;
  /** Unlocks once `stats[stat] >= at`. */
  at: number;
}

export const ACHIEVEMENTS = {
  firstCrack: { name: 'First Crack', desc: 'Break an asteroid.', stat: 'rocksBroken', at: 1 },
  rockbreaker: { name: 'Rockbreaker', desc: 'Break 500 asteroids.', stat: 'rocksBroken', at: 500 },
  demolition: { name: 'Demolition Crew', desc: 'Break 5,000 asteroids.', stat: 'rocksBroken', at: 5000 },
  prospector: { name: 'Prospector', desc: 'Mine 100 units.', stat: 'unitsMined', at: 100 },
  stripMiner: { name: 'Strip Miner', desc: 'Mine 10,000 units.', stat: 'unitsMined', at: 10_000 },
  motherLode: { name: 'Mother Lode', desc: 'Mine 100,000 units.', stat: 'unitsMined', at: 100_000 },
  firstJump: { name: 'First Jump', desc: 'Warp to a new system.', stat: 'warps', at: 1 },
  wanderer: { name: 'Wanderer', desc: 'Warp 5 times.', stat: 'warps', at: 5 },
  horizonChaser: { name: 'Horizon Chaser', desc: 'Warp 15 times.', stat: 'warps', at: 15 },
  settlingIn: { name: 'Settling In', desc: 'Play for 30 minutes.', stat: 'time', at: 30 * 60 },
  lifer: { name: 'Lifer', desc: 'Play for 5 hours.', stat: 'time', at: 5 * 60 * 60 },
  contractor: { name: 'Contractor', desc: 'Complete a contract.', stat: 'contracts', at: 1 },
  supplier: { name: 'Trusted Supplier', desc: 'Complete 25 contracts.', stat: 'contracts', at: 25 },
  smelter: { name: 'Smelter', desc: 'Refine 100 units.', stat: 'refined', at: 100 },
  industrialist: { name: 'Industrialist', desc: 'Refine 2,500 units.', stat: 'refined', at: 2500 },
  pioneer: { name: 'Pioneer', desc: 'Deploy an outpost.', stat: 'outposts', at: 1 },
  wingman: { name: 'Wingman', desc: 'Launch a drone or hauler.', stat: 'drones', at: 1 },
  armada: { name: 'Armada', desc: 'Launch 25 drones or haulers.', stat: 'drones', at: 25 },
  scholar: { name: 'Scholar', desc: 'Buy 10 research levels.', stat: 'perks', at: 10 },
  cometWatcher: { name: 'Comet Watcher', desc: 'Weather 10 comets.', stat: 'comets', at: 10 },
  hardLessons: { name: 'Hard Lessons', desc: 'Lose a ship.', stat: 'shipsLost', at: 1 },
} as const satisfies Record<string, AchievementDef>;

export type AchievementId = keyof typeof ACHIEVEMENTS;

export const ACHIEVEMENT_IDS = Object.keys(ACHIEVEMENTS) as AchievementId[];
