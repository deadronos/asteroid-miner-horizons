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

  baseFleetCap: 5,
  /** A hold counts as full once free space drops below max(fullHoldMin, cap × fullHoldShare). */
  fullHoldMin: 2,
  fullHoldShare: 0.04,
  droneLeash: 700,

  // Prestige.
  /** Bank fuel the first warp costs; grows per warp, cut by the warp perk. */
  warpBaseFuel: 50,
  warpCostGrowth: 1.3,
  /** Horizon Data = floor(sqrt(runValue / dataDivisor)). */
  dataDivisor: 60,

  // Refinery.
  /** Jobs the station refinery queue can hold. */
  refineQueueMax: 5,
  /** Batches a single refine job can hold. */
  refineMaxBatch: 500,
  /** Catalytic Furnace perk: refinery speed added per level (cycle time ÷ (1 + this × level)). */
  furnaceSpeedPerLevel: 0.25,

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

  // System modifiers.
  /** First system number that rolls modifiers. */
  modifierMinSystem: 3,
  /** Chance a system rolls a second modifier. */
  modifierTwoChance: 0.25,

  // Hazards.
  /** First system number that schedules comets and flares. */
  hazardMinSystem: 2,
  /** Grace seconds at the start of a run before any hazard. */
  hazardFirstDelay: 75,
  /** Seconds between comet warnings, rolled per comet. */
  cometInterval: [140, 220],
  /** Seconds between a comet warning and its appearance. */
  cometWarning: 8,
  /** Comet speed in units per second (before the level's damage multiplier). */
  cometSpeed: 130,
  /** Radius of the circle comets spawn on and despawn past. */
  cometEdge: 3200,
  /** Comet hit points relative to a rock of the same radius. */
  cometHpMul: 1.6,
  /** Comet resource units relative to a rock of the same radius. */
  cometYieldMul: 3,
  /** Seconds between a flare warning and the flare itself. */
  flareWarning: 10,
  /** Seconds a flare stays active. */
  flareDuration: 6,
  /** AI: distance past a flare's reach that still counts as unsafe while a flare is pending or burning. */
  flareShelterPad: 120,
  /** AI: clearance either side of a comet's body that counts as its path (plus the ship's own size). */
  cometDodgePad: 40,

  // Rock traits (#48).
  /** Chance a freshly spawned belt rock rolls a trait. */
  traitChance: 0.22,
  /** Volatile: blast radius past the rock's own radius, and damage at radius 40. */
  volatileBlastPad: 120,
  volatileBlastDamage: 40,
  volatileYieldMul: 1.5,
  /** Dense: the laser tier that can cut it, and its yield bonus. */
  denseMinLaserTier: 2,
  denseYieldMul: 1.6,
  /** Magnetic: range it notices ships, its acceleration and its speed cap. */
  magnetTraitRange: 180,
  magnetTraitAccel: 6,
  magnetTraitMaxSpeed: 24,
  magnetTraitYieldMul: 1.3,

  // Component variants (#49).
  /** Share of the beam's dps dealt to each rock inside a Wide Beam's splash radius. */
  splashMul: 0.5,

  // Automation (#39).
  /** Haulers skim a miner once it carries this share of its hold. */
  haulMinShare: 0.3,
  /** Haulers empty an outpost once it holds this many units. */
  haulMinOutpost: 15,
  /** Gap between hulls (or hull and outpost rock) at which cargo can be transferred. */
  haulTransferGap: 30,
  /** Units per second a transfer moves. */
  haulTransferRate: 30,
  /** How far from the station a hauler will go to skim a miner (outposts are served anywhere). */
  haulRange: 1800,
  /** Outposts that can be deployed at once. */
  outpostMax: 3,
  /** Bank cost of one outpost. */
  outpostCost: { ore: 120, ice: 30, alloy: 15 },
  /** Gap between the flagship's hull and the rock's surface it must be inside to deploy. */
  outpostDeployGap: 120,
  /** An outpost taps a deep reserve this many times its host rock's units; the rock itself is left intact. */
  outpostReserveMul: 10,
  /** Reserve units an outpost extracts per second (before the yield perk). */
  outpostRate: 0.8,
  /** Units an outpost can hold before it stalls waiting for pickup. */
  outpostCapacity: 100,

  // Offline progress (#41).
  /** Longest absence credited, in seconds. */
  offlineCapSec: 8 * 60 * 60,
  /** Absences shorter than this (a reload) credit nothing. */
  offlineMinSec: 60,
  /** Units a drone delivers per second per point of laser dps in active play (measured headless, ≈0.03). */
  offlineUnitsPerDps: 0.03,
  /** Share of that rate credited while away: no flagship, no contracts, no supervision. */
  offlineEfficiency: 0.1,

  startWallet: { ore: 40, ice: 10, crystal: 0 },
} as const;
