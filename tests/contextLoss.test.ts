import { describe, expect, it, vi } from 'vitest';
import { watchContextLoss } from '../src/render/contextLoss';

const lose = (target: EventTarget): Event => {
  const e = new Event('webglcontextlost', { cancelable: true });
  target.dispatchEvent(e);
  return e;
};

describe('watchContextLoss', () => {
  it('prevents the default and reports the first loss', () => {
    const target = new EventTarget();
    const onLost = vi.fn<() => void>();
    watchContextLoss(target, onLost);
    const e = lose(target);
    expect(e.defaultPrevented).toBe(true);
    expect(onLost).toHaveBeenCalledTimes(1);
  });

  it('ignores later losses but still prevents their default', () => {
    const target = new EventTarget();
    const onLost = vi.fn<() => void>();
    watchContextLoss(target, onLost);
    lose(target);
    const e = lose(target);
    expect(e.defaultPrevented).toBe(true);
    expect(onLost).toHaveBeenCalledTimes(1);
  });

  it('stops listening after unsubscribe', () => {
    const target = new EventTarget();
    const onLost = vi.fn<() => void>();
    const unsubscribe = watchContextLoss(target, onLost);
    unsubscribe();
    const e = lose(target);
    expect(e.defaultPrevented).toBe(false);
    expect(onLost).not.toHaveBeenCalled();
  });
});
