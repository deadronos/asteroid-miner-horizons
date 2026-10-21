# Adaptive render scale and quality — design

**Issue:** #160.

## Goal

Let players choose a render scale independently of display DPR, and add an Auto quality preset that reduces render cost when a rolling frame-time window stays above 18 ms. Auto restores quality only after a longer window stays below 14 ms, preventing visible pumping.

## Design

- Keep Low, Medium and High as fixed presets. Add Auto as a quality mode; it starts with High's visual settings.
- Add a persisted render-scale setting with 100% and 75% choices. It multiplies the preset's existing DPR cap.
- Keep a small pure adaptive controller outside the sim. It maintains a one-second rolling average, samples only after each window, steps down after two consecutive windows above 18 ms, and steps up after six consecutive windows below 14 ms. Middle-band and non-finite samples reset the relevant streak. Auto's four levels are High/100%, High/75%, Medium/75%, and Low/75%, so it lowers resolution before reducing bloom and effects.
- Measure elapsed time between animation frames in `main.ts` and feed it to the controller only after a frame is rendered. Non-Auto presets reset the controller. Apply new effective settings only when the selected level changes.
- Keep Auto's effective level transient; persist only the user's mode and manual render scale.
- Leave composer creation lazy. Low with bloom disabled already skips the composer unless antialiasing requires its fallback path.

## Boundaries and trade-offs

The controller observes whole animation-frame intervals, including browser scheduling and simulation work, because that is the frame time the player experiences. A two-window downshift and six-window recovery delay are deliberately conservative. Auto changes only scale, preset bloom, star and particle levels; it does not alter simulation state or RNG.

## Verification

Unit tests cover rolling-window boundaries, sustained overload, hysteretic recovery, transitions, and finite input handling. Settings tests cover persistence and invalid stored scale values. The Graphics tab is checked in a real browser. A browser run at a 4K-sized viewport with elevated DPR checks that the controller settles without alternating quality levels.
