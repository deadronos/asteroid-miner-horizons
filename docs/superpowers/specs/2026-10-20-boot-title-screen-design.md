# Boot / title screen and document metadata — Design

**Issue:** #163 (related #28, #129) · **Branch:** `feat/boot-title-screen`

## Problem

The page drops straight into a save behind a black canvas while three.js creates the
renderer and warms its shaders. A slow first frame looks like a broken page. `index.html`
also has no description, theme colour, favicon or social metadata, so a shared link is a
bare title with a default browser icon.

## Decisions

### The title screen is static markup, painted before the module runs

The boot screen is markup inside `index.html` with its critical CSS in an inline `<style>`
block. This is deliberate: if the screen were created by `main.ts`, the first paint would
still be the empty canvas. The same rules move to `style.css` only when something else
needs them; none do yet.

The screen is a full-viewport card over a dark star-field gradient with:

- the game title and a one-line save summary;
- **Continue**, shown only when the active slot holds a readable save;
- **New game**;
- **Settings**;
- a hint that sound starts after the first click.

### The session still loads before the title screen appears

`GameSession` keeps its current behaviour: it loads the active slot, credits offline
progress and starts autosave at the same point as today. The title screen is a view over
that session, not a second boot path. This is what keeps the session/autosave flow free
of regressions and makes **Continue** instant.

**Ruling — no auto-load bypass setting.** The issue offers a setting for returning
players; the title screen always appears. A returning player clicks Continue, which is
the point of the screen, and a new setting would add a branch with no visual difference.
Cost if wrong: one click per session for players who would have opted out.

### While the title screen is open, the game is paused and input is blocked

`main.ts` treats an open title screen as a manual pause: the tick does not run, the pause
banner is suppressed, and continuous audio follows `pauseAudio('manual')`. The renderer
and HUD keep running behind the opaque card, so shader warm-up and the first real frame
happen while the player is reading rather than after the fade.

`Input` gains a `blocked` predicate checked at the top of `onKey`, so `R`, `WASD`, `Esc`
and the pause key cannot open panels or queue movement behind the title. Pointer events
never reach the canvas because the card covers it. A small Tab handler on `#boot` cycles
focus through its visible buttons (Continue, New game, Settings) using the same
`nextFocusIndex` helper as the gear menu. `#app` is not made `inert`: the gear menu lives
inside it, so Settings must stay clickable while the title is open; the overlay and the
input blocker are what keep the game inert.

### Button behaviour

| Button | With a readable save in the active slot | Without one |
| --- | --- | --- |
| Continue | Hide the screen; the already-loaded game resumes | Hidden |
| New game | Confirm when `confirmDestructive` is on, then `session.newGame(active)` and hide | Hide; the session already holds a fresh game |
| Settings | Open the gear menu above the title; closing it returns to the title | Same |

Changes made through Settings (for example loading another slot from **Saves**) are
respected: **New game** re-reads `session.active()` at click time. The summary may be one
step stale until the title is reopened, which is acceptable for a boot screen.

An unreadable save is never cleared by the title screen: with no readable save the
**New game** button only dismisses, leaving `GameSession`'s existing unsaved/empty-slot
handling untouched.

### Document metadata

`index.html` gains:

- `meta name="description"` and `meta name="theme-color"` (`#03060d`, the page background);
- an inline SVG favicon as a `data:image/svg+xml` URL (no binary asset, no build step);
- Open Graph `og:title`, `og:description`, `og:type`, `og:site_name`, `og:url` and
  `twitter:card="summary"`, using the public GitHub Pages URL.

There is no `og:image`: the issue asks for basic tags, and inventing a raster preview
image would add an asset that nothing in the repo can regenerate. Title and description
are what a link preview shows without one.

## Blast radius

- `index.html`: metadata, inline critical CSS, boot markup.
- `src/ui/TitleScreen.ts` (new): wiring, save summary, dismiss/new-game/settings.
- `src/main.ts`: construct the screen, freeze while open, expose it on `__amh`.
- `src/input.ts`: optional `blocked` predicate for keyboard input.
- `tests/indexHtml.test.ts` (new): metadata and boot markup.
- `tests/title.test.ts` (new): the summary helper.
- `README.md`: one line about the title screen.
- `docs/superpowers/{specs,plans}/` + run log.

Not touched: `src/sim/**`, save format, settings shape, `GameSession`, `AudioEngine`,
renderer internals, HUD panels, autosave timing.

## What can go wrong (and where it is caught)

1. **First paint is still the canvas** because the markup is created by JS. Task 1 puts
   the boot markup and CSS in `index.html`; `tests/indexHtml.test.ts` pins it.
2. **The game ticks behind the title** or a hidden key opens a panel. Task 2 freezes the
   tick through the manual-pause path, blocks `Input.onKey` and cycles Tab inside the boot
   buttons; the browser pass checks `__amh.state().run.time` stays put until Continue,
   that `R` does nothing, and that Tab stays on the title while the menu is closed.
3. **New game erases an unreadable save or ignores a changed active slot.** Task 2
   re-reads the active slot at click time and only calls `session.newGame` when the slot
   holds a readable save; the browser pass exercises the readable case.
4. **Settings cannot be reached, or closing it loses the title.** The gear menu is a
   higher layer (`z-index: 30`) than the boot card (`28`); the browser pass opens and
   closes it with the title still up.
5. **Autosave/session regressions.** `GameSession` is unchanged; the existing
   `tests/session.test.ts`, `tests/settings.test.ts` and the full suite run after each
   task, and the browser pass reloads into Continue with the same system/time.
6. **Metadata is malformed or a tag is missed.** `tests/indexHtml.test.ts` asserts the
   description, theme colour, favicon and each Open Graph/Twitter tag, and the browser
   pass reads the live `<head>`.

## Acceptance criteria mapping (issue #163)

- **First paint shows a styled screen rather than a blank canvas.** Static boot markup and
  inline CSS (Task 1), verified by the unit test and the first browser screenshot.
- **Continue / New game / Settings; first click unlocks audio and hides warm-up.** Task 2
  wiring; the browser pass clicks each path and reads `__amh.audio.state === 'running'`.
- **No regression to the session/autosave flow.** `GameSession` untouched; full suite and
  the reload/Continue browser check (Tasks 2-3).
- **Metadata renders correctly in a link preview.** Task 1 tags and unit test; live `<head>`
  inspection in Task 3.
