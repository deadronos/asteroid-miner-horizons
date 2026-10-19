import { describe, expect, it } from 'vitest';
import {
  type WarmKey,
  type WarmableComposer,
  claimWarm,
  composerWarmKey,
  warmComposer,
} from '../src/render/composerWarmup';

/** A composer stub that records the flag it sees during each render call. */
function fakeComposer(initial: boolean, onRender?: () => void) {
  const seen: { deltaTime: number | undefined; renderToScreen: boolean }[] = [];
  const composer: WarmableComposer = {
    renderToScreen: initial,
    render(deltaTime) {
      seen.push({ deltaTime, renderToScreen: this.renderToScreen });
      onRender?.();
    },
  };
  return { composer, seen };
}

describe('warmComposer', () => {
  it('renders once with dt 0 and renderToScreen false, then restores true', () => {
    const { composer, seen } = fakeComposer(true);
    warmComposer(composer);
    expect(seen).toEqual([{ deltaTime: 0, renderToScreen: false }]);
    expect(composer.renderToScreen).toBe(true);
  });

  it('restores a previous false value as false', () => {
    const { composer, seen } = fakeComposer(false);
    warmComposer(composer);
    expect(seen).toEqual([{ deltaTime: 0, renderToScreen: false }]);
    expect(composer.renderToScreen).toBe(false);
  });

  it('restores renderToScreen when render throws, and lets the error propagate', () => {
    const { composer } = fakeComposer(true, () => {
      throw new Error('boom');
    });
    expect(() => warmComposer(composer)).toThrow('boom');
    expect(composer.renderToScreen).toBe(true);
  });
});

describe('composerWarmKey', () => {
  it('is null when frames do not use the composer', () => {
    expect(composerWarmKey(false, false)).toBeNull();
    expect(composerWarmKey(false, true)).toBeNull();
  });

  it('is bloom when the composer runs with bloom on', () => {
    expect(composerWarmKey(true, true)).toBe('bloom');
  });

  it('is present when the composer runs with bloom off (the runtime fallback)', () => {
    expect(composerWarmKey(true, false)).toBe('present');
  });
});

/** Runs claimWarm over a sequence of keys, as Renderer.applySettings does, and returns which claims won. */
function run(keys: (WarmKey | null)[]): boolean[] {
  const warmed = new Set<WarmKey>();
  return keys.map((key) => claimWarm(key, warmed));
}

describe('claimWarm', () => {
  it('never claims when the composer is not in use', () => {
    expect(run([null])).toEqual([false]);
  });

  it('claims the first time a key is needed', () => {
    expect(run(['bloom'])).toEqual([true]);
    expect(run(['present'])).toEqual([true]);
  });

  it('does not claim an already-warmed key again', () => {
    expect(run(['bloom', 'bloom'])).toEqual([true, false]);
    expect(run(['present', 'present'])).toEqual([true, false]);
  });

  it('fallback then bloom warms twice', () => {
    expect(run(['present', 'bloom'])).toEqual([true, true]);
  });

  it('bloom then fallback warms once', () => {
    expect(run(['bloom', 'present'])).toEqual([true, false]);
  });

  it('a bloom that repeats after the fallback still warms once', () => {
    expect(run(['present', 'bloom', 'bloom', 'present'])).toEqual([true, true, false, false]);
  });

  it('a composer frame in between does not change the claims', () => {
    expect(run(['bloom', null, 'present'])).toEqual([true, false, false]);
  });
});
