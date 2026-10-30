// Pushes the active colour-vision palette into the HUD's CSS custom properties (#210), so a settings change
// recolours resource counts, warnings and map blips without a reload.

import type { Palette } from '../data/palette';
import { cssColour } from '../data/palette';
import { RESOURCES } from '../data/resources';

export function applyPaletteVars(el: HTMLElement, p: Palette): void {
  for (const r of RESOURCES) el.style.setProperty(`--${r}`, cssColour(p.resource[r]));
  el.style.setProperty('--accent', cssColour(p.ok));
  el.style.setProperty('--warn', cssColour(p.warn));
  el.style.setProperty('--bad', cssColour(p.bad));
  el.style.setProperty('--flagship', cssColour(p.flagship));
  el.style.setProperty('--hazard', cssColour(p.hazard));
}
