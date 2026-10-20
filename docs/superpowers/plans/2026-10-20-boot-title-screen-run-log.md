# Boot / Title Screen — Run log

**Date:** 2026-10-20 · **Issue:** #163 (related #28, #129) · **Branch:** `feat/boot-title-screen`

**Spec:** [`../specs/2026-10-20-boot-title-screen-design.md`](../specs/2026-10-20-boot-title-screen-design.md)
**Plan:** [`2026-10-20-boot-title-screen.md`](2026-10-20-boot-title-screen.md)

## Setup

- Native OpenCode worktree at `/Users/openclaw/.local/share/opencode/worktree/ee4e41/boot-title-screen`,
  branch `feat/boot-title-screen` from `main` at `6ebc367`.
- `npm install` reused the local cache; baseline `npm test`: 57 files / 847 tests green.
- Spec and plan committed as `9b6c9bd`.

## Per-task summary

| Task | Commits | Implementer | Review | Result |
| --- | --- | --- | --- | --- |
| 1. Static boot screen + metadata | `14d4f58` | DeepSeek Flash | DeepSeek V4 Pro | Approved clean |
| 2. Title wiring, pause and input | `2be46c2`, `0125bf4`, `8790436` | DeepSeek V4 Pro | DeepSeek V4 Pro + two scoped re-reviews | Approved clean after 2 fix rounds |
| 3. README, browser verification, run log | this commit | Controller | Final whole-branch review | — |

### Review findings

| Task | Finding | Decision |
| --- | --- | --- |
| 1 | Metadata test asserts tag presence, not the exact `og:url`/`twitter:card` values; one test comment misdescribes `types: []`. | Accepted as minors. The exact values are in `index.html` and were read from the live `<head>` in Task 3. |
| 2 | Escape could not close the gear menu opened by Settings, because the title blocks all keys. | **Upgraded to Important and fixed** (`0125bf4`): Escape passes only while `hud.menu.open`; every other key stays blocked. Settings is a required title action and Esc is the menu's close key. |
| 2 | Autosave saved the untouched boot game after 10 s, so the first New game asked to erase a 0 s save. | **Fixed** (`8790436`): `session.start()` moved from boot to the title's `onDismiss`; `GameSession` unchanged. |

## Verification

### Gate

| Command | Result |
| --- | --- |
| `npm run check` | 59 files / 850 tests passed; format, lint and both typechecks clean |
| `npx vite build` | passed (run in Task 3) |

### Browser probes (Chromium, Vite dev server at 1440x900 and 1024x768)

| Probe | Observation |
| --- | --- |
| First paint | `#boot` visible, `z-index: 28`, background `rgb(3, 6, 13)`; title “Asteroid Miner Horizons”; card 520x326, fits at 1440 and 1024, no horizontal page overflow; screenshot `boot-fresh-1440.png` taken during the pass (not committed). |
| Fresh storage | `localStorage` empty; Continue hidden; New game and Settings visible; summary “Start a new mining run.”; focus on `boot-new`; audio `locked`. |
| Frozen sim | `run.time` `0` → `0` after 11 s; no save keys appeared; `R` left the research panel hidden; Tab cycled `boot-new` ↔ `boot-settings`. |
| New game (fresh) | No confirm dialog; `#boot` hidden; audio `running`; `run.time` `0.37` → `1.52`; storage empty immediately, slot key appeared only after the 10 s autosave. |
| Reload → Continue | Boot visible, Continue visible, summary “Slot 1 · System 1 · 14s”, run time 14.88 s; after click `#boot` hidden, audio `running`, system 1, time `15.28` → `16.18`. |
| Settings | Gear menu `z-index: 30` above boot `28`; boot stayed visible; Escape closed the menu, boot remained, focus returned to `boot-settings`. |
| New game with a save | Confirm overridden to accept; after click `warps: 0`, `run.time` reset to `0.42`, boot hidden, audio `running`. |
| Metadata (live `<head>`) | description and `og:description` exact; `theme-color #03060d`; `og:type website`; `og:site_name Asteroid Miner Horizons`; `og:url https://deadronos.github.io/asteroid-miner-horizons/`; `twitter:card summary`; favicon href starts `data:image/svg+xml,…`. |
| Console | 0 errors (the old `favicon.ico` 404 is gone); only the pre-existing `KHR_parallel_shader_compile` warning. |

## Deviations from the plan

1. **Autosave starts on dismissal, not before the loop.** The first browser pass found the
   timer wrote the untouched boot game, turning the first New game click into a destructive
   confirm. The session still loads and credits offline progress in its constructor;
   `session.start()` now runs from `TitleScreen.onDismiss`. Recorded in the spec ruling.
2. **No `#app.inert`.** The gear menu lives inside `#app`, so inerting it would break
   Settings. The title uses a Tab trap over its own buttons; the overlay and `Input` blocker
   keep the game inert.
3. **Task 1 test source** loads `node:fs` through `process.getBuiltinModule`, because
   `tsconfig` has `types: []` (the same pattern as `tests/layers.test.ts`), and its regexes
   tolerate oxfmt wrapping the metadata attributes.

## Acceptance criteria (issue #163)

- **First paint shows a styled screen rather than a blank canvas.** Static `#boot` markup
  and inline CSS in `index.html`; verified visible before any interaction.
- **Continue / New game / Settings; first click unlocks audio and hides warm-up.**
  All three paths exercised; `__amh.audio.state` became `running` on the first title click
  and the renderer kept running behind the card.
- **No regression to the session/autosave flow.** `GameSession` untouched; fresh boot
  writes nothing, autosave begins on dismissal, reload resumes the same system/time through
  Continue, and the full suite is green.
- **Metadata renders correctly in a link preview.** Description, theme colour, favicon and
  every Open Graph/Twitter tag read back exactly from the live `<head>`.
