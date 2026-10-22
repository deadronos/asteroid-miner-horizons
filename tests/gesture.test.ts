import { describe, expect, it } from 'vitest';
import { pinchStep, stickVector } from '../src/core/gesture';

describe('pinchStep', () => {
  it('spreading fingers zooms in about their midpoint', () => {
    const step = pinchStep({ x: 100, y: 200 }, { x: 200, y: 200 }, { x: 50, y: 200 }, { x: 250, y: 200 });
    expect(step.zoom).toBeCloseTo(0.5);
    expect(step).toMatchObject({ cx: 150, cy: 200, dx: 0, dy: 0 });
  });

  it('closing fingers zooms out', () => {
    expect(pinchStep({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 25, y: 0 }, { x: 75, y: 0 }).zoom).toBeCloseTo(2);
  });

  it('moving both fingers together pans without zooming', () => {
    const step = pinchStep({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 10, y: 30 }, { x: 110, y: 30 });
    expect(step.zoom).toBe(1);
    expect(step).toMatchObject({ cx: 60, cy: 30, dx: 10, dy: 30 });
  });

  it('one finger moving shifts the midpoint by half its travel', () => {
    const step = pinchStep({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 0, y: 0 }, { x: 120, y: 0 });
    expect(step.dx).toBe(10);
    expect(step.zoom).toBeCloseTo(100 / 120);
  });

  it('fingers on top of each other do not zoom', () => {
    expect(pinchStep({ x: 5, y: 5 }, { x: 5, y: 5 }, { x: 0, y: 0 }, { x: 50, y: 0 }).zoom).toBe(1);
    expect(pinchStep({ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 5, y: 5 }, { x: 5, y: 5 }).zoom).toBe(1);
  });
});

describe('stickVector', () => {
  it('is zero at rest and inside the dead zone', () => {
    expect(stickVector(0, 0, 60)).toEqual({ x: 0, z: 0 });
    expect(stickVector(5, 5, 60)).toEqual({ x: 0, z: 0 });
  });

  it('points where the stick is pushed, screen down being +z', () => {
    const up = stickVector(0, -60, 60);
    expect(up.x).toBeCloseTo(0);
    expect(up.z).toBeCloseTo(-1);
    const right = stickVector(60, 0, 60);
    expect(right.x).toBeCloseTo(1);
    expect(right.z).toBeCloseTo(0);
  });

  it('rises from zero at the dead zone to one at the rim, and stays capped beyond it', () => {
    const half = stickVector(0, 9 + (60 - 9) / 2, 60);
    expect(half.z).toBeCloseTo(0.5);
    const far = stickVector(300, 400, 60);
    expect(Math.hypot(far.x, far.z)).toBeCloseTo(1);
    expect(far.x / far.z).toBeCloseTo(0.75);
  });

  it('is zero for a stick with no size', () => {
    expect(stickVector(10, 10, 0)).toEqual({ x: 0, z: 0 });
  });
});
