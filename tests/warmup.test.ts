import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { withVisible } from '../src/render/warmup';

describe('withVisible', () => {
  it('makes hidden objects visible during the callback and restores them after', () => {
    const a = new THREE.Object3D();
    const b = new THREE.Object3D();
    a.visible = false;
    b.visible = false;
    let seen: boolean[] = [];
    withVisible([a, b], () => {
      seen = [a.visible, b.visible];
    });
    expect(seen).toEqual([true, true]);
    expect(a.visible).toBe(false);
    expect(b.visible).toBe(false);
  });

  it('restores previously visible objects too', () => {
    const hidden = new THREE.Object3D();
    const shown = new THREE.Object3D();
    hidden.visible = false;
    shown.visible = true;
    withVisible([hidden, shown], () => {});
    expect(hidden.visible).toBe(false);
    expect(shown.visible).toBe(true);
  });

  it('restores visibility and rethrows when the callback throws', () => {
    const a = new THREE.Object3D();
    a.visible = false;
    expect(() =>
      withVisible([a], () => {
        throw new Error('compile failed');
      }),
    ).toThrow('compile failed');
    expect(a.visible).toBe(false);
  });

  it('restores the original value when an object is listed twice', () => {
    const a = new THREE.Object3D();
    a.visible = false;
    withVisible([a, a], () => {
      expect(a.visible).toBe(true);
    });
    expect(a.visible).toBe(false);
  });

  it('still runs the callback for an empty list', () => {
    let ran = false;
    withVisible([], () => {
      ran = true;
    });
    expect(ran).toBe(true);
  });
});
