// Hazard tables: difficulty levels and per-star-class solar flare profiles. Pure data.

export type HazardLevel = 'off' | 'normal' | 'harsh';

export const HAZARD_LEVEL_IDS: readonly HazardLevel[] = ['off', 'normal', 'harsh'];

/** Per-level multipliers: `interval` scales seconds between hazards; `damage` scales flare dps and comet speed. */
export const HAZARD_LEVELS: Record<HazardLevel, { interval: number; damage: number }> = {
  off: { interval: 1, damage: 1 },
  normal: { interval: 1, damage: 1 },
  harsh: { interval: 0.65, damage: 1.4 },
};

/** Flare profile per star class; G stars have none. `reach` is the distance from the star that still takes damage. */
export const FLARES: Partial<Record<'M' | 'G' | 'B', { interval: [number, number]; dps: number; reach: number }>> = {
  M: { interval: [110, 170], dps: 10, reach: 1300 },
  B: { interval: [170, 250], dps: 22, reach: 1700 },
};
