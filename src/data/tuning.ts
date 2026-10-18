// Global balance knobs. Anything that isn't per-hull, per-component or
// per-perk lives here so it can be tuned in one place.

export const TUNING = {
  simHz: 60,

  // Asteroids: hp = hpK * r^1.5, yield units = yieldK * r^2.
  rockHpK: 0.65,
  rockYieldK: 0.03,
  /** Share of a cracked rock's units passed to its fragments; the rest drops as pickups. */
  crackChildShare: 0.7,
  rockOrbitSpeed: 7,
  /** Belts regrow toward this share of their initial density. */
  beltRegrowTarget: 0.75,
  beltRegrowInterval: 4,

  pickupLifetime: 120,
  pickupCollectRadius: 16,
  tractorSpeed: 380,

  dockRadius: 90,
  collisionCooldown: 0.5,
  collisionMinSpeed: 25,
  starHeatDps: 30,
  flagshipRespawn: 4,
  repairOrePerHull: 0.3,

  baseFleetCap: 2,
  droneLeash: 700,

  // Prestige.
  warpBaseIce: 250,
  warpCostGrowth: 1.35,
  /** Horizon Data = floor(sqrt(runValue / dataDivisor)). */
  dataDivisor: 60,

  // Contracts.
  /** Offers kept on the station board per system. */
  contractOffers: 3,
  /** Seconds an un-accepted offer stays on the board. */
  contractOfferTtl: 240,
  /** Per-system multiplier on a contract's target. */
  contractGrowth: 1.15,
  /** Reward value as a fraction of the target's own value. */
  contractRewardMul: 0.58,
  /** Value of the units in one large rock (≈42 units at radius 30–44, ore/ice mix), used to price breakLarge rewards. */
  contractRockValue: 45,

  startWallet: { ore: 40, ice: 10, crystal: 0 },
} as const;
