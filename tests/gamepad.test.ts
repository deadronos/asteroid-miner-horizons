import { describe, expect, it } from 'vitest';
import { buttonEdges, interactTarget, padThrust, padZoom } from '../src/core/gamepad';
import { PAD, padCommand } from '../src/gamepad';

describe('padThrust', () => {
  it('is zero inside the radial dead zone, even with both axes nonzero', () => {
    expect(padThrust(0.1, -0.1)).toEqual({ x: 0, z: 0 });
    expect(padThrust(0.2, 0.2, 0.3)).toEqual({ x: 0, z: 0 });
  });

  it('rises from 0 at the dead-zone rim to 1 at full tilt, keeping direction', () => {
    const half = padThrust(0.575, 0, 0.15);
    expect(half.x).toBeCloseTo(0.5);
    expect(half.z).toBe(0);
    expect(padThrust(0, 1)).toEqual({ x: 0, z: 1 });
  });

  it('caps the diagonal at unit length (stick corners read > 1)', () => {
    const v = padThrust(1, 1);
    expect(Math.hypot(v.x, v.z)).toBeCloseTo(1);
    expect(v.x).toBeCloseTo(v.z);
  });

  it('maps stick up (−y) to screen up (−z)', () => {
    expect(padThrust(0, -1).z).toBe(-1);
  });
});

describe('padZoom', () => {
  it('ignores the dead zone', () => {
    expect(padZoom(0.1, 0.016)).toBe(1);
  });

  it('zooms in when pushed up and out when pulled down, scaled by dt', () => {
    expect(padZoom(-1, 0.1)).toBeLessThan(1);
    expect(padZoom(1, 0.1)).toBeGreaterThan(1);
    expect(padZoom(1, 0.1) * padZoom(-1, 0.1)).toBeCloseTo(1);
  });
});

describe('buttonEdges', () => {
  it('reports only buttons pressed this frame, not held ones', () => {
    expect(buttonEdges([false, true, false], [true, true, false])).toEqual([0]);
    expect(buttonEdges([true], [true])).toEqual([]);
  });

  it('treats missing previous buttons as released, and releases as no edge', () => {
    expect(buttonEdges([], [false, true])).toEqual([1]);
    expect(buttonEdges([true], [false])).toEqual([]);
  });
});

describe('padCommand', () => {
  it('sends a ping from the right trigger and leaves stateful buttons to Input', () => {
    expect(padCommand(PAD.RT)).toEqual({ t: 'ping' });
    expect(padCommand(PAD.A)).toBeNull();
    expect(padCommand(PAD.START)).toBeNull();
  });
});

describe('interactTarget', () => {
  const station = { x: 0, z: 0 };

  it('picks the rock with the nearest surface', () => {
    const rocks = [
      { id: 1, pos: { x: 300, z: 0 }, radius: 10 },
      { id: 2, pos: { x: 0, z: 200 }, radius: 10 },
    ];
    expect(interactTarget({ x: 0, z: 300 }, station, 90, rocks, 500)).toEqual({ kind: 'rock', id: 2 });
  });

  it('docks when the ship is within station range, even with a rock closer', () => {
    const rocks = [{ id: 1, pos: { x: 10, z: 40 }, radius: 5 }];
    expect(interactTarget({ x: 0, z: 40 }, station, 90, rocks, 500)).toEqual({ kind: 'station' });
  });

  it('ignores rocks beyond range and falls back to flying home', () => {
    const rocks = [{ id: 1, pos: { x: 900, z: 0 }, radius: 10 }];
    expect(interactTarget({ x: 300, z: 0 }, station, 90, rocks, 500)).toEqual({ kind: 'station' });
  });
});
