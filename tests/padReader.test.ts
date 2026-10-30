import { afterEach, describe, expect, it, vi } from 'vitest';
import { PAD, PadReader } from '../src/gamepad';

function pad(pressed: number[], axes = [0, 0, 0, 0], index = 0, mapping = 'standard') {
  return {
    connected: true,
    index,
    mapping,
    axes,
    buttons: Array.from({ length: 16 }, (_, i) => ({ pressed: pressed.includes(i) })),
  };
}

function mockPads(...pads: (ReturnType<typeof pad> | null)[]): void {
  vi.stubGlobal('navigator', { getGamepads: () => pads });
}

afterEach(() => vi.unstubAllGlobals());

describe('PadReader', () => {
  it('is null with no pad, or a non-standard mapping', () => {
    mockPads(null);
    expect(new PadReader().read()).toBeNull();
    mockPads(pad([], undefined, 0, ''));
    expect(new PadReader().read()).toBeNull();
  });

  it('reports a press once, then held, then released', () => {
    const r = new PadReader();
    mockPads(pad([]));
    r.read();
    mockPads(pad([PAD.A]));
    expect(r.read()?.edges).toEqual([PAD.A]);
    expect(r.read()?.edges).toEqual([]);
    mockPads(pad([]));
    expect(r.read()?.edges).toEqual([]);
  });

  it('does not fire for buttons already held when a pad appears', () => {
    mockPads(pad([PAD.START]));
    expect(new PadReader().read()?.edges).toEqual([]);
  });

  it('reads both sticks', () => {
    mockPads(pad([], [0.5, -1, 0.1, 0.9]));
    expect(new PadReader().read()).toMatchObject({ lx: 0.5, ly: -1, rx: 0.1, ry: 0.9 });
  });
});
