// Pure view of the doctrine block in the research panel: names, trade-off
// text, and whether the respec window is still open. The panel renders this.

import {
  DOCTRINE_PAIR_IDS,
  DOCTRINE_PAIRS,
  sideTrade,
  type DoctrinePairId,
  type DoctrineSideId,
} from '../data/doctrines';
import { TUNING } from '../data/tuning';
import { doctrineWindowOpen } from '../sim/economy';
import type { Profile } from '../sim/types';

export interface DoctrineSideView {
  id: DoctrineSideId;
  name: string;
  /** Bonus and cost, written out. */
  trade: string;
  picked: boolean;
  /** Choose, Swap, Chosen or Locked. */
  action: string;
}

export interface DoctrinePairView {
  id: DoctrinePairId;
  name: string;
  picked: DoctrineSideId | null;
  locked: boolean;
  /** Clear, or Locked while the window is shut. */
  clear: string;
  sides: readonly [DoctrineSideView, DoctrineSideView];
}

export interface DoctrinePanelView {
  hint: string;
  pairs: readonly DoctrinePairView[];
}

/** Button label for one side. */
function sideAction(locked: boolean, picked: boolean, anyPicked: boolean): string {
  if (picked) return 'Chosen';
  if (locked) return 'Locked';
  return anyPicked ? 'Swap' : 'Choose';
}

/** What the research panel shows for doctrines at sim time `time`. */
export function doctrinePanel(profile: Profile, time: number): DoctrinePanelView {
  const open = doctrineWindowOpen(time);
  const left = Math.ceil(Math.max(0, TUNING.doctrineWindow - time));
  const hint = open
    ? `Respec window: ${left}s left. Choose, swap or clear each doctrine. It locks when the window ends. Respec at warp.`
    : `Doctrines are locked. Respec at warp: keep, swap or clear each pair in the first ${TUNING.doctrineWindow} seconds of the next system.`;
  const pairs = DOCTRINE_PAIR_IDS.map((id) => {
    const def = DOCTRINE_PAIRS[id];
    const picked = profile.doctrines[id];
    const sides = def.sides.map((side) => ({
      id: side.id,
      name: side.name,
      trade: sideTrade(side),
      picked: picked === side.id,
      action: sideAction(!open, picked === side.id, picked != null),
    })) as [DoctrineSideView, DoctrineSideView];
    return { id, name: def.name, picked, locked: !open, clear: open ? 'Clear' : 'Locked', sides };
  });
  return { hint, pairs };
}
