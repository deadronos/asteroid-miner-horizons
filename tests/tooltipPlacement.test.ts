import { describe, expect, it } from 'vitest';
import { placeTooltip } from '../src/ui/tooltipPlacement';

const VIEW = { viewportW: 800, viewportH: 600 };
const TIP = { tooltipW: 120, tooltipH: 30 };

describe('placeTooltip', () => {
  it('sits below-right of the cursor and flips an axis only when that side overflows', () => {
    expect(placeTooltip({ x: 100, y: 100, ...TIP, ...VIEW })).toEqual({ x: 120, y: 120 });
    expect(placeTooltip({ x: 700, y: 100, ...TIP, ...VIEW })).toEqual({ x: 560, y: 120 });
    expect(placeTooltip({ x: 100, y: 580, ...TIP, ...VIEW })).toEqual({ x: 120, y: 530 });
    expect(placeTooltip({ x: 700, y: 580, ...TIP, ...VIEW })).toEqual({ x: 560, y: 530 });
  });

  it('does not jump sides when the cursor crosses the screen centre', () => {
    expect(placeTooltip({ x: 399, y: 299, ...TIP, ...VIEW })).toEqual({ x: 419, y: 319 });
    expect(placeTooltip({ x: 401, y: 301, ...TIP, ...VIEW })).toEqual({ x: 421, y: 321 });
  });

  it('clamps to the viewport margins when the tooltip would go off-screen', () => {
    expect(placeTooltip({ x: 790, y: 590, tooltipW: 300, tooltipH: 80, ...VIEW })).toEqual({ x: 470, y: 490 });
    expect(placeTooltip({ x: 410, y: 300, tooltipW: 500, tooltipH: 500, ...VIEW })).toEqual({ x: 8, y: 8 });
  });

  it('keeps a too-wide tooltip off the cursor by placing it below', () => {
    const pos = placeTooltip({ x: 320, y: 100, tooltipW: 320, tooltipH: 60, viewportW: 600, viewportH: 600 });
    expect(pos).toEqual({ x: 8, y: 120 });
  });
});
