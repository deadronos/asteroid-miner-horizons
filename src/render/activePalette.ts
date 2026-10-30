// The palette the scene and HUD currently draw with (#210). Renderer.applySettings switches it, so a change
// recolours live; views read `palette()` each frame instead of caching colours.

import { PALETTES, type ColourVision, type Palette } from '../data/palette';

let mode: ColourVision = 'default';
let generation = 0;

/** The active palette. */
export const palette = (): Palette => PALETTES[mode];

/** Bumps on every switch, for caches keyed on colour. */
export const paletteGeneration = (): number => generation;

/** Switches the active palette; returns whether it changed. */
export function setColourVision(next: ColourVision): boolean {
  if (next === mode) return false;
  mode = next;
  generation++;
  return true;
}
