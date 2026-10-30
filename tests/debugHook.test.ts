// When window.__amh is attached (#218). Dev builds always get it; a production
// build gets it only with ?debug or the localStorage opt-in, so browser tests
// (#129) can still drive the built page.
import { describe, expect, it } from 'vitest';
import { DEBUG_HOOK_KEY, DEBUG_QUERY, debugHookEnabled, installDebugHook, type DebugHookEnv } from '../src/debugHook';

const off: DebugHookEnv = { dev: false, search: '', storage: null };

function storage(value: string | null): Pick<Storage, 'getItem'> {
  return { getItem: () => value };
}

describe('debugHookEnabled', () => {
  it('is on in a dev build even with no opt-in', () => {
    expect(debugHookEnabled({ ...off, dev: true })).toBe(true);
  });

  it('is off on a plain production load', () => {
    expect(debugHookEnabled(off)).toBe(false);
    expect(debugHookEnabled({ ...off, search: '?foo=1', storage: storage(null) })).toBe(false);
    expect(debugHookEnabled({ ...off, storage: storage('0') })).toBe(false);
    expect(debugHookEnabled({ ...off, storage: storage('true') })).toBe(false);
  });

  it('is on in production when the debug query parameter is present', () => {
    expect(debugHookEnabled({ ...off, search: `?${DEBUG_QUERY}` })).toBe(true);
    expect(debugHookEnabled({ ...off, search: `?${DEBUG_QUERY}=1` })).toBe(true);
    expect(debugHookEnabled({ ...off, search: `?${DEBUG_QUERY}=0` })).toBe(true);
    expect(debugHookEnabled({ ...off, search: `?foo=1&${DEBUG_QUERY}=` })).toBe(true);
  });

  it('is on in production when the localStorage flag is exactly "1"', () => {
    expect(DEBUG_HOOK_KEY).toBe('asteroid-miner-horizons/debug');
    expect(debugHookEnabled({ ...off, storage: storage('1') })).toBe(true);
  });

  it('stays off when storage throws', () => {
    const blocked: Pick<Storage, 'getItem'> = {
      getItem() {
        throw new Error('blocked');
      },
    };
    expect(debugHookEnabled({ ...off, storage: blocked })).toBe(false);
  });
});

describe('installDebugHook', () => {
  const hook = {
    state: () => 'state',
    send: () => undefined,
    settings: {},
    renderer: {},
    input: {},
    audio: {},
    autoQuality: {},
    info: () => 'info',
    title: {},
  };

  it('does not attach __amh when the hook is disabled', () => {
    const target: { __amh?: typeof hook } = {};
    installDebugHook(target, off, hook);
    expect(target).not.toHaveProperty('__amh');
  });

  it('attaches the full hook when dev, the query param, or storage opts in', () => {
    for (const env of [
      { ...off, dev: true },
      { ...off, search: `?${DEBUG_QUERY}` },
      { ...off, storage: storage('1') },
    ]) {
      const target: { __amh?: typeof hook } = {};
      installDebugHook(target, env, hook);
      expect(Reflect.get(target, '__amh')).toBe(hook);
    }
  });
});

describe('main.ts wiring', () => {
  it('installs the hook through installDebugHook instead of always assigning it', () => {
    // The root tsconfig has `types: []`; referencing @types/node here would leak Node globals into src/.
    interface Fs {
      readFileSync(path: URL, encoding: 'utf8'): string;
    }
    const { readFileSync } = (
      globalThis as unknown as { process: { getBuiltinModule(id: 'node:fs'): Fs } }
    ).process.getBuiltinModule('node:fs');
    const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
    expect(main).toContain('installDebugHook(');
    expect(main).toContain('import.meta.env.DEV');
    expect(main).not.toMatch(/Object\.assign\(\s*window/);
  });
});
