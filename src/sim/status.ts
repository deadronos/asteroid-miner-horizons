// Ship status: what each AI ship is doing and why, written by the brains and read by the fleet panel.

import type { RawResource } from '../data/resources';
import type { Outbox, Rock } from './types';

export type StatusKind =
  | 'mining'
  | 'heading'
  | 'collecting'
  | 'returning'
  | 'docked'
  | 'repairing'
  | 'unloading'
  | 'haulOutpost'
  | 'haulMiner'
  | 'buildHeading'
  | 'building'
  | 'avoidComet'
  | 'flare'
  | 'escorting'
  | 'idle';

/** Why a ship is idle (or, for a hauling builder, why it is not building). */
export type IdleReason = 'noRocks' | 'outpostLimit' | 'noBuildSite' | 'belowReserve' | 'repairMoney' | 'nothingToHaul';

export interface ShipStatus {
  kind: StatusKind;
  reason: IdleReason | null;
  /** Kind of the rock being worked or approached, else null. */
  rockKind: RawResource | null;
  /** True when that rock is a large one. */
  large: boolean;
}

/**
 * Records what ship `shipId` is doing this tick. Reuses the ship's existing record, so it allocates only on a
 * ship's first call.
 */
export function setStatus(
  out: Outbox,
  shipId: number,
  kind: StatusKind,
  reason: IdleReason | null = null,
  rock: Rock | null = null,
): void {
  let st = out.status.get(shipId);
  if (!st) out.status.set(shipId, (st = { kind, reason, rockKind: null, large: false }));
  st.kind = kind;
  st.reason = reason;
  st.rockKind = rock ? rock.kind : null;
  st.large = rock ? rock.size === 0 : false;
}
