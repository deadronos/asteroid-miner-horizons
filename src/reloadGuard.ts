// Reload-loop guard for WebGL context loss. Each loss reloads the page, so a GPU
// that keeps resetting would reload forever. This keeps the timestamps of recent
// losses (kept in sessionStorage by main.ts) and decides whether one more reload
// is allowed. Pure and DOM-free: callers pass `now` and do the storage I/O.

/** sessionStorage key holding the JSON array of recent loss timestamps (ms). */
export const CONTEXT_LOSS_KEY = 'asteroid-miner-horizons/context-losses';
/** How far back a loss still counts, in ms. */
export const LOSS_WINDOW_MS = 60_000;
/** Reloads allowed inside the window; the next loss shows the notice instead. */
export const MAX_RELOADS = 2;

/** Loss timestamps from storage. Anything that is not a finite number is dropped; a bad or missing value gives []. */
export function parseLosses(raw: string | null): number[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((t): t is number => typeof t === 'number' && Number.isFinite(t));
}

/**
 * Records a loss at `now` in `store` and returns whether the page may reload. A missing store, or one whose
 * read throws, allows the reload. A failed write still returns the decision, so a full store cannot stop a reload.
 */
export function recordLoss(store: Pick<Storage, 'getItem' | 'setItem'> | null, now: number): boolean {
  if (!store) return true;
  let losses: number[];
  try {
    losses = parseLosses(store.getItem(CONTEXT_LOSS_KEY));
  } catch {
    return true;
  }
  const d = decideReload(losses, now);
  try {
    store.setItem(CONTEXT_LOSS_KEY, JSON.stringify(d.losses));
  } catch {
    // Full or blocked: the decision still stands, the loop guard just forgets this loss.
  }
  return d.reload;
}

/**
 * Whether a loss at `now` may reload the page, and the losses to store. Only losses in the window
 * `(now - windowMs, now]` count, so stale and future timestamps are ignored. The stored list is capped
 * at `maxReloads + 1` newest entries.
 */
export function decideReload(
  losses: readonly number[],
  now: number,
  windowMs = LOSS_WINDOW_MS,
  maxReloads = MAX_RELOADS,
): { reload: boolean; losses: number[] } {
  const kept = losses.filter((t) => now - windowMs < t && t <= now);
  return {
    reload: kept.length < maxReloads,
    losses: [...kept, now].slice(-(maxReloads + 1)),
  };
}
