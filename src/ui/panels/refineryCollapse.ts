// State transitions for the refinery panel's empty-queue auto-collapse behavior.

export interface RefineryCollapseState {
  collapsed: boolean;
  /** True when the player manually expanded an empty queue and asked it to stay open. */
  keepOpenWhenEmpty: boolean;
}

/** Reconciles collapse state with the current queue length. */
export function syncRefineryCollapse(state: RefineryCollapseState, queueLength: number): RefineryCollapseState {
  if (queueLength > 0) return { collapsed: false, keepOpenWhenEmpty: false };
  return state.keepOpenWhenEmpty ? state : { ...state, collapsed: true };
}

/** Applies a user toggle at the current queue length. */
export function toggleRefineryCollapse(state: RefineryCollapseState, queueLength: number): RefineryCollapseState {
  const collapsed = !state.collapsed;
  return {
    collapsed,
    keepOpenWhenEmpty: queueLength === 0 && !collapsed,
  };
}
