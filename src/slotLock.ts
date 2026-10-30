// One tab per save slot (#211). A tab takes a lock on its slot while it plays it; a second tab on the same slot
// fails to get the lock and opens read-only, so two tabs can't overwrite each other's saves or credit the same
// absence twice. Web Locks where the browser has them, else a heartbeat key in localStorage. Where neither
// exists (node tests) every claim succeeds.

/** A held slot lock; release it when the tab leaves the slot. */
export interface SlotLock {
  release(): void;
}

/**
 * Tries to take the lock on `slot` without waiting. Resolves to the lock, or null when another tab holds it.
 * `onLost` fires if a held lock is lost to another tab (heartbeat fallback only). May answer synchronously.
 */
export interface SlotLocker {
  acquire(slot: number, onLost: () => void): SlotLock | null | Promise<SlotLock | null>;
}

const lockName = (slot: number): string => `amh-slot-${slot}`;
const beatKey = (slot: number): string => `asteroid-miner-horizons/lock/${slot}`;
/** How often the owning tab refreshes its heartbeat. */
const BEAT_MS = 2000;
/** A heartbeat older than this means its tab is gone. */
const STALE_MS = 10_000;

/** Web Locks: held by a request that stays pending until released; the browser frees it when the tab closes. */
export function webLocker(locks: LockManager): SlotLocker {
  return {
    acquire: (slot) =>
      new Promise((resolve) => {
        locks
          .request(lockName(slot), { ifAvailable: true }, (lock) => {
            if (!lock) {
              resolve(null);
              return undefined;
            }
            return new Promise<void>((release) => resolve({ release }));
          })
          .catch(() => resolve(null));
      }),
  };
}

/** Fallback: a `{id, at}` key in `storage`, refreshed while held and ignored once stale. */
export function heartbeatLocker(storage: Storage, now: () => number = Date.now): SlotLocker {
  const id = Math.random().toString(36).slice(2);
  return {
    acquire(slot, onLost) {
      const key = beatKey(slot);
      try {
        const cur = JSON.parse(storage.getItem(key) ?? 'null') as { id: string; at: number } | null;
        if (cur && cur.id !== id && now() - cur.at < STALE_MS) return null;
        const beat = (): void => storage.setItem(key, JSON.stringify({ id, at: now() }));
        beat();
        const timer = setInterval(() => {
          const held = JSON.parse(storage.getItem(key) ?? 'null') as { id: string } | null;
          if (held && held.id !== id) {
            clearInterval(timer);
            onLost();
          } else beat();
        }, BEAT_MS);
        return {
          release: () => {
            clearInterval(timer);
            const held = JSON.parse(storage.getItem(key) ?? 'null') as { id: string } | null;
            if (held?.id === id) storage.removeItem(key);
          },
        };
      } catch {
        return { release() {} }; // storage blocked: nothing to coordinate through
      }
    },
  };
}

/** The locker for this environment; outside a browser (node tests) every claim succeeds. */
export function defaultLocker(): SlotLocker {
  if (typeof window === 'undefined') return { acquire: () => ({ release() {} }) };
  if (navigator.locks) return webLocker(navigator.locks);
  return heartbeatLocker(localStorage);
}
