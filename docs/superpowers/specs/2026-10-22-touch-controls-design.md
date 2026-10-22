# Touch controls and a phone layout (#194)

## Goal

The game cannot be played on a phone or tablet: zoom is wheel-only, flagship thrust needs held keys, the hotkey
actions (map, follow, cycle ship, research, outpost, pause) have no pointer equivalent, and on a phone-sized
screen the side panels cover the whole playfield. A full loop (mine → dock → upgrade → warp) must be playable on a
phone without a keyboard, with desktop input and layout unchanged.

## Gestures (`src/input.ts`)

`Input` tracks every active pointer by `pointerId`. Mouse and pen keep today's behaviour exactly; the new rules
apply only to `pointerType === 'touch'`.

- **One finger:** a drag past the tap slop pans, as a mouse drag does. A **tap** is the left click (select, mine,
  dock, move). A **long-press** (held ~450 ms without moving) is the right click: the same order without changing
  the selection, so a drone can be sent to a rock while the flagship stays selected.
- **Two fingers:** pinch zooms about the midpoint and moving the midpoint pans. Panning starts only after the
  midpoint's net drift passes a small threshold (net, not path length: fingers report one at a time, so the
  midpoint jitters during a plain pinch), so a plain pinch does not drop camera follow. Once a second finger
  lands, the gesture is no longer a tap or long-press, and the fingers left behind after a pinch do nothing until
  all are lifted.
- **Tooltip:** a tap shows the hover tooltip for what was tapped for a few seconds, so rock details remain
  readable without a hover.

The maths is a pure helper in `src/core/gesture.ts` with unit tests: `pinchStep` (zoom factor, new midpoint and
midpoint delta from the before/after finger positions) and `stickVector` (virtual stick offset → thrust vector
with a dead zone and a magnitude capped at 1). `steer` already treats thrust magnitude as analogue, so a half-tilted
stick is half thrust; keys still give full thrust.

## On-screen controls (`src/ui/TouchControls.ts`)

- A **virtual thrust stick** (bottom left). `Input.thrust()` uses the keys when any is held, else the stick.
- An **action strip** (bottom right) with one button per hotkey-only action: Map, Follow, Next ship, Research,
  Outpost, Pause. The keyboard switch in `Input.onKey` becomes `Input.runAction(action)`, which both keys and the
  strip call, so the two cannot drift.
- **Outpost** has no hovered asteroid on touch, so its button arms a one-shot mode: the next tap on a rock deploys
  an outpost there; a tap elsewhere or a second press disarms it.
- Shown when the new **Touch controls** setting (Interface tab) is `auto` and `matchMedia('(pointer: coarse)')`
  matches, or when it is `on`. `touchControlsShown(mode, coarse)` in `hudLayout.ts` is the pure rule. Settings are
  not part of the save, so there is no `SAVE_VERSION` bump.
- While shown, the help box describes the touch controls instead of the keys.

## Phone layout

A **narrow** screen is `(max-width: 640px), (max-height: 500px)`; `Hud` listens to that query.

- Every side panel is **collapsed by default** on a narrow screen (`autoCollapsed` gains a `narrow` flag), and the
  panels behave as an **accordion**: expanding one drops the explicit open choices of the others, so only one panel
  covers the playfield at a time. An explicit choice still wins over the automatic state, as in #161.
- A collapsed panel shrinks to its heading; an expanded one is at most the screen width.
- The top bar wraps instead of scrolling sideways, and its measured bottom edge (`--topbar-bottom`, kept by a
  `ResizeObserver`) places the side columns beneath it, so the Warp, Research and menu buttons stay reachable.
- With touch controls shown, the side columns stop above the stick/strip band (`--touch-band`). The log spans the
  screen at the bottom of the left column, so the right column stops above it; first steps, the hazard banner and
  toasts sit below the folded headings, the pause banner above the log.
- A phone on its side (`max-height: 500px`) gets a smaller stick and strip, a two-line log, first steps between the
  folded headings, and a right column that runs down to the strip.
- `touch-action: manipulation` on buttons removes the double-tap zoom delay; the canvas already has
  `touch-action: none`. The viewport gets `viewport-fit=cover` and the controls respect the safe-area insets.

## Not changed

The sim, the save shape, desktop input, the desktop layout (every new layout rule is inside the narrow query or
the `.touch` class; the one global rule is `touch-action: manipulation` on buttons) and the key bindings.
