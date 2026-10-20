// Player-chosen autopilot helpers, passed into each tick from Settings.

/** Player-chosen autopilot helpers (from Settings). All on by default. */
export interface Assists {
  /** Autopilot steers around rocks. */
  avoid: boolean;
  /** Drones fly home to unload when their hold is full. */
  autoDock: boolean;
  /** A manual mining order moves on to the fragments when its rock breaks. */
  chain: boolean;
}

export const DEFAULT_ASSISTS: Assists = { avoid: true, autoDock: true, chain: true };

/** Player-chosen limits for per-ship autorepair and autoupgrade (#140, from Settings). */
export interface FleetAuto {
  /** Autorepair sends a ship home once its hull falls below this share of max (0–1). */
  repairAt: number;
  /** Automation never spends a resource below this many units in the bank. */
  reserve: number;
}

export const DEFAULT_FLEET_AUTO: FleetAuto = { repairAt: 0.5, reserve: 100 };
