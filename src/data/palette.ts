// Colour palettes for the colour-vision setting (#210). One table per mode holds every colour that carries
// meaning in the scene or the HUD: resource type, hull state, fleet roles and hazards. Render and UI read the
// active entry; nothing here touches the sim. `tests/palette.test.ts` keeps each mode's entries apart.

import type { RawResource, Resource } from './resources';

/** `deutan` also serves protan: both confuse red with green, and one palette separates them for either. */
export type ColourVision = 'default' | 'deutan' | 'tritan';

export const COLOUR_VISION_IDS: readonly ColourVision[] = ['default', 'deutan', 'tritan'];

export interface Palette {
  resource: Record<Resource, number>;
  /** Muted rock body tints; the shape family stays the primary cue (see `rockStyleOf`). */
  rock: Record<RawResource, number>;
  /** Hull bar states and the station/dock highlight. */
  ok: number;
  warn: number;
  bad: number;
  /** Selection ring on the flagship, and on every other fleet ship. */
  flagship: number;
  fleet: number;
  /** Comet path line and the flare/comet map blips. */
  hazard: number;
}

export const PALETTES: Record<ColourVision, Palette> = {
  default: {
    resource: { ore: 0xffa040, ice: 0x6fe6ff, crystal: 0xd27bff, alloy: 0xc9d3e0, fuel: 0xff7a4d },
    rock: { ore: 0x9c7b5e, ice: 0xc4ecf8, crystal: 0xc48cff },
    ok: 0x59ffa0,
    warn: 0xffc04d,
    bad: 0xff5d5d,
    flagship: 0x59ffa0,
    fleet: 0x59c2ff,
    hazard: 0x8fd0ff,
  },
  // Orange / blue / magenta / pale blue / pale yellow: separated by blue-yellow contrast and lightness, which
  // red-green loss leaves intact.
  deutan: {
    resource: { ore: 0xec7618, ice: 0x518ede, crystal: 0xd14977, alloy: 0xccebf9, fuel: 0xece5a6 },
    rock: { ore: 0xa0642c, ice: 0xa8c8f0, crystal: 0xc85a80 },
    ok: 0x048cfe,
    warn: 0xfbff39,
    bad: 0xca4b47,
    flagship: 0xfbff39,
    fleet: 0x518ede,
    hazard: 0xff8a3a,
  },
  // Tritan loses blue-yellow, so these lean on red against teal and on lightness.
  tritan: {
    resource: { ore: 0xe7ad73, ice: 0x1efcf9, crystal: 0xf63bb1, alloy: 0xe1f5cc, fuel: 0xe70907 },
    rock: { ore: 0xa87a48, ice: 0x80e8e0, crystal: 0xd04898 },
    ok: 0x21fbcb,
    warn: 0xfbb9d4,
    bad: 0xff1505,
    flagship: 0x21fbcb,
    fleet: 0xfbb9d4,
    hazard: 0xff4040,
  },
};

/** `0xrrggbb` as a CSS colour. */
export const cssColour = (n: number): string => `#${n.toString(16).padStart(6, '0')}`;
