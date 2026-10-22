import { describe, expect, it } from 'vitest';
import { placeTooltip } from '../src/ui/tooltipPlacement';

const VIEW = { viewportW: 800, viewportH: 600 };
const TIP = { tooltipW: 120, tooltipH: 30 };

describe('placeTooltip', () => {
  it('offsets by screen quadrant so the tooltip does not sit on the cursor target', () => {
    expect(placeTooltip({ x: 100, y: 100, ...TIP, ...VIEW })).toEqual({ x: 120, y: 120 });
    expect(placeTooltip({ x: 700, y: 100, ...TIP, ...VIEW })).toEqual({ x: 560, y: 120 });
    expect(placeTooltip({ x: 700, y: 500, ...TIP, ...VIEW })).toEqual({ x: 560, y: 450 });
    expect(placeTooltip({ x: 100, y: 500, ...TIP, ...VIEW })).toEqual({ x: 120, y: 450 });
  });

  it('clamps to the viewport margins when the tooltip would go off-screen', () => {
    expect(placeTooltip({ x: 790, y: 590, tooltipW: 300, tooltipH: 80, ...VIEW })).toEqual({ x: 470, y: 490 });
    expect(placeTooltip({ x: 410, y: 300, tooltipW: 500, tooltipH: 500, ...VIEW })).toEqual({ x: 8, y: 8 });
  });
});
