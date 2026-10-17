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
