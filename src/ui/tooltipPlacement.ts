// Tooltip positioning helper: keeps the popup off the cursor/target and on-screen.

import { clamp } from '../core/vec';

export interface TooltipPlacementInput {
  x: number;
  y: number;
  tooltipW: number;
  tooltipH: number;
  viewportW: number;
  viewportH: number;
  gap?: number;
  margin?: number;
}

/**
 * Places a tooltip by screen quadrant (opposite of centre) and clamps it to
 * the viewport so it stays visible.
 */
export function placeTooltip({
  x,
  y,
  tooltipW,
  tooltipH,
  viewportW,
  viewportH,
  gap = 20,
  margin = 8,
}: TooltipPlacementInput): { x: number; y: number } {
  const w = Math.max(0, tooltipW);
  const h = Math.max(0, tooltipH);
  const toRight = x < viewportW / 2;
  const toBottom = y < viewportH / 2;
  const rawX = toRight ? x + gap : x - w - gap;
  const rawY = toBottom ? y + gap : y - h - gap;
  const maxX = Math.max(margin, viewportW - w - margin);
  const maxY = Math.max(margin, viewportH - h - margin);
  return {
    x: Math.round(clamp(rawX, margin, maxX)),
    y: Math.round(clamp(rawY, margin, maxY)),
  };
}
