// Whether `window.__amh` is attached. Dev builds always expose it. A production
// build exposes it only with `?debug` or localStorage DEBUG_HOOK_KEY set to
// `'1'`, so browser tests can still drive `vite preview` or the Pages build.

/** localStorage key. The value `'1'` exposes `window.__amh` on a production build. */
export const DEBUG_HOOK_KEY = 'asteroid-miner-horizons/debug';

/** Query parameter. Present (`?debug` or `?debug=1`) exposes the hook on a production build. */
export const DEBUG_QUERY = 'debug';

export interface DebugHookEnv {
  /** `import.meta.env.DEV`. */
  dev: boolean;
  /** `location.search`, including the leading `?` when there is one. */
  search: string;
  /** localStorage, or null when it is missing or blocked. */
  storage: Pick<Storage, 'getItem'> | null;
}

/** True when the debug hook should be assigned to `window`. A blocked store counts as off. */
export function debugHookEnabled(env: DebugHookEnv): boolean {
  if (env.dev) return true;
  if (new URLSearchParams(env.search).has(DEBUG_QUERY)) return true;
  if (!env.storage) return false;
  try {
    return env.storage.getItem(DEBUG_HOOK_KEY) === '1';
  } catch {
    return false;
  }
}

/** Assigns `hook` to `target.__amh` when the hook is enabled, and does not touch `target` otherwise. */
export function installDebugHook(target: object, env: DebugHookEnv, hook: object): void {
  if (!debugHookEnabled(env)) return;
  Object.assign(target, { __amh: hook });
}
