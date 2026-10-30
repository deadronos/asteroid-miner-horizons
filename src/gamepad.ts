// Gamepad polling (#209): reads the first standard-mapping pad once per frame and reports sticks, held buttons and
// the buttons pressed since the last read. Mapping onto game actions lives in Input; the maths is in core/gamepad.

import { buttonEdges } from './core/gamepad';

/** Standard-mapping button indices. */
export const PAD = {
  A: 0,
  B: 1,
  X: 2,
  Y: 3,
  LB: 4,
  RB: 5,
  SELECT: 8,
  START: 9,
  UP: 12,
  DOWN: 13,
  LEFT: 14,
  RIGHT: 15,
} as const;

export interface PadFrame {
  /** Left stick, then right stick (each −1..1, down = +). */
  lx: number;
  ly: number;
  rx: number;
  ry: number;
  held: boolean[];
  /** Button indices pressed since the previous read. */
  edges: number[];
}

export class PadReader {
  private prev: boolean[] = [];
  private id = -1;

  /** The current pad's frame, or null while none is connected. */
  read(): PadFrame | null {
    const pad = [...(navigator.getGamepads?.() ?? [])].find((p) => p?.connected && p.mapping === 'standard');
    if (!pad) {
      this.prev = [];
      this.id = -1;
      return null;
    }
    const held = pad.buttons.map((b) => b.pressed);
    // A different pad starts with a clean slate, so buttons still held when it was plugged in do not fire.
    if (pad.index !== this.id) {
      this.id = pad.index;
      this.prev = held;
    }
    const edges = buttonEdges(this.prev, held);
    this.prev = held;
    const [lx = 0, ly = 0, rx = 0, ry = 0] = pad.axes;
    return { lx, ly, rx, ry, held, edges };
  }
}
