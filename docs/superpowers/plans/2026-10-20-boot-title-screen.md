# Boot / Title Screen and Metadata — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give issue #163 a styled first paint with Continue / New game / Settings, freeze the sim and input behind it, and add the document metadata (description, theme colour, favicon, Open Graph) that a link preview needs.

**Architecture:** Static boot markup plus critical CSS in `index.html` paint before the module runs; `TitleScreen` wires that markup to the already-loaded `GameSession`, opens the gear menu, and releases `#app` from `inert` on dismiss. `main.ts` treats an open title as a manual pause and passes a `blocked` predicate to `Input`, while the renderer keeps warming behind the opaque card.

**Tech Stack:** TypeScript, DOM APIs, Vite, Vitest, oxlint/oxfmt. No new dependency and no binary asset.

**Spec:** `docs/superpowers/specs/2026-10-20-boot-title-screen-design.md` — read it with this plan; it is the design of record.

## Global Constraints

- **`GameSession`, `src/sim/**`, the save format and the settings shape are not touched.** The session still loads, credits offline progress and arms autosave exactly when it does today.
- **The boot markup and its critical CSS live in `index.html`**, not in a module-created element, so the styled screen is the first paint. `#boot` sits after `#app` and uses `z-index: 28` (above the pause banner at 25, below the gear modal at 30).
- **Continue is shown only when `slotStatus(saves.active()).kind === 'ok'`.** New game re-reads the active slot at click time and calls `session.newGame(active)` only for a readable save; it never clears an unreadable one.
- **While the title is open:** the tick does not run (manual-pause path), the pause banner is suppressed, `Input.onKey` returns immediately, and Tab cycles through the visible boot buttons. `#app` is **not** inert, because the gear menu lives inside it and Settings must remain usable. The renderer and HUD still run.
- **Exact metadata:** description and `og:description` are `Mine asteroids, command a drone fleet and warp across a procedural star system in this top-down sci-fi mining sim.`; `theme-color` is `#03060d`; `og:type` is `website`; `og:url` is `https://deadronos.github.io/asteroid-miner-horizons/`; `twitter:card` is `summary`; the favicon is an inline `data:image/svg+xml` URL.
- **No `og:image`** (the spec rules it out: no asset pipeline for a raster preview).
- **No new setting** for skipping the title screen (spec ruling).
- **Keep the full CI gate green:** `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm test`, `npx vite build`.
- **Browser verification is mandatory** for layout, audio unlock, pause and the live `<head>`; Vitest sees no layout.

Before every commit in every task, run `npm run check` and confirm it passes.

## Review Focus

Failure modes the unit tests do not exercise, most-likely-first.

1. **The first paint is still the canvas** because the boot screen is built in JS. Owning task: Task 1 — markup and critical CSS are static in `index.html`, pinned by `tests/indexHtml.test.ts`.
2. **The game ticks behind the title, or a key opens a panel there.** Owning task: Task 2 — manual-pause freeze, `Input.onKey` blocker, Tab cycle; Task 3 checks `run.time` stays put, `R` does nothing and Tab stays on the title.
3. **New game erases an unreadable save or a slot changed via Settings.** Owning task: Task 2 — click-time `slotStatus` check and `session.newGame` only for a readable save.
4. **Settings opens behind the title, or closing it loses the title.** Owning task: Task 2/Task 3 — z-index 28 vs modal 30 and the browser open/close probe.
5. **Continue does not resume the same game** (session/autosave regression). Owning task: Task 2 keeps `GameSession` untouched; Task 3 reloads, reads the summary, clicks Continue and compares system/time.
6. **Metadata is incomplete, malformed, or the favicon still 404s.** Owning task: Task 1 tags + unit test, Task 3 live `<head>` and console check.

---

## Task 1: Static boot screen and document metadata

**Files:**
- Modify: `index.html`
- Test: create `tests/indexHtml.test.ts`

**Interfaces:**
- The document contains these elements/attributes (the IDs are the contract Task 2 reads):
  - `#boot` (`.boot`, `role="dialog"`, `aria-modal="true"`, `aria-labelledby="boot-title"`)
  - `#boot-title`, `#boot-summary`, `#boot-continue` (with a `hidden` attribute),
    `#boot-new`, `#boot-settings`
  - `<meta name="description" ...>`, `<meta name="theme-color" content="#03060d">`,
    `<link rel="icon" href="data:image/svg+xml,...">`
  - `og:title`, `og:description`, `og:type`, `og:site_name`, `og:url`,
    `twitter:card`.

- [ ] **Step 1: Write the failing test** in `tests/indexHtml.test.ts`:

  ```ts
  import { readFileSync } from 'node:fs';
  import { describe, expect, it } from 'vitest';

  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

  describe('document metadata', () => {
    it('has a description, theme colour, favicon and social tags', () => {
      expect(html).toMatch(/<meta name="description" content="[^"]+"/);
      expect(html).toContain('<meta name="theme-color" content="#03060d"');
      expect(html).toMatch(/<link rel="icon" href="data:image\/svg\+xml,/);
      for (const property of ['og:title', 'og:description', 'og:type', 'og:site_name', 'og:url'])
        expect(html).toContain(`property="${property}"`);
      expect(html).toContain('name="twitter:card"');
    });
  });

  describe('boot screen markup', () => {
    it('paints a title screen with Continue, New game and Settings', () => {
      expect(html).toContain('id="boot"');
      expect(html).toContain('id="boot-title"');
      expect(html).toContain('id="boot-summary"');
      expect(html).toContain('id="boot-new"');
      expect(html).toContain('id="boot-settings"');
      expect(html).toMatch(/id="boot-continue"[^>]*hidden/);
    });
  });
  ```

- [ ] **Step 2: Run the test and see it fail.** Run `npx vitest run tests/indexHtml.test.ts`.
  Expected: FAIL — the metadata and boot markup do not exist.

- [ ] **Step 3: Rewrite `index.html`.** Keep the title and module script. Add the metadata
  above, the inline SVG favicon (a dark rounded square with a green asteroid and two dark
  craters), and an inline `<style>` block for first paint. The boot screen markup:
  ```html
  <div id="boot" class="boot" role="dialog" aria-modal="true" aria-labelledby="boot-title">
    <div class="boot-card">
      <p class="boot-kicker">A top-down sci-fi mining sim</p>
      <h1 id="boot-title">Asteroid<br />Miner Horizons</h1>
      <p class="boot-summary" id="boot-summary">Start a new mining run.</p>
      <div class="boot-actions">
        <button id="boot-continue" class="boot-primary" hidden>Continue</button>
        <button id="boot-new" class="boot-primary">New game</button>
        <button id="boot-settings">Settings</button>
      </div>
      <p class="boot-hint">Sound starts after your first click.</p>
    </div>
  </div>
  ```
  The inline CSS must cover: dark full-viewport `.boot` with a subtle radial/star-field
  background and `z-index: 28`; a centred `.boot-card` (max width 520px, border, dark
  translucent background, padding, shadow); the kicker/title/summary/hint typography;
  button row with `flex-wrap`; a green `.boot-primary`; `:focus-visible` outline;
  `[hidden] { display: none !important; }`; and a `max-width: 560px` rule that stacks the
  buttons. Use the existing palette (`#03060d`, `#d4ecff`, `#7f9fbd`, `#59ffa0`, edge
  `rgba(110,200,255,.22)`), no external font or image.

- [ ] **Step 4: Run the test and see it pass.** Run `npx vitest run tests/indexHtml.test.ts`.
  Expected: PASS.

- [ ] **Step 5: Gate and commit.** Run `npm run check`. Commit:
  `Paint a styled boot screen and complete the document metadata (#163)`.

**Done when:** `tests/indexHtml.test.ts` is green, `index.html` contains the boot markup and
metadata, and nothing else in the repo changed.

---

## Task 2: Wire the title screen to the session, the pause and the input

**Files:**
- Create: `src/ui/TitleScreen.ts`
- Modify: `src/main.ts`
- Modify: `src/input.ts`
- Test: create `tests/title.test.ts`

**Interfaces:**
- Produces in `src/ui/TitleScreen.ts`:
  ```ts
  export interface TitleActions {
    openSettings(): void;
  }

  /** One-line save summary for the boot screen. */
  export function titleSummary(state: GameState, slot: number): string;

  export class TitleScreen {
    constructor(saves: SaveActions, settings: SettingsStore, actions: TitleActions);
    get open(): boolean;
    dismiss(): void;
  }
  ```
  `titleSummary` returns `Slot ${slot + 1} · System ${state.run.system.number} · ${formatDuration(state.run.time, { seconds: true })}`.
- `Input`'s constructor gains a final optional parameter `blocked: () => boolean = () => false`.
- `main.ts` exposes `title` on `__amh`.
- The pause kind while the title is open is the literal `'manual'`.

- [ ] **Step 1: Write the failing test** in `tests/title.test.ts`:
  ```ts
  import { describe, expect, it } from 'vitest';
  import { newGame } from '../src/sim/create';
  import { titleSummary } from '../src/ui/TitleScreen';

  describe('title summary', () => {
    it('names the slot, system and time', () => {
      const state = newGame(4);
      expect(titleSummary(state, 2)).toBe(`Slot 3 · System ${state.run.system.number} · 0s`);
    });
  });
  ```

- [ ] **Step 2: Run the test and see it fail.** Run `npx vitest run tests/title.test.ts`.
  Expected: FAIL — cannot resolve `../src/ui/TitleScreen`.

- [ ] **Step 3: Implement `src/ui/TitleScreen.ts`.**
  - Header comment: the boot screen covers the canvas while the renderer warms up, freezes
    the sim through the manual-pause path, and hands control to the already-loaded session,
    a fresh run or the gear menu.
  - Use a `byId<T extends HTMLElement>(id)` helper that throws a clear error when the
    static markup is missing.
  - Compute `active = saves.active()` and `readable = slotStatus(active).kind === 'ok'`.
  - Set `#boot-summary` to `titleSummary(saves.current(), active)` when readable, else
    `'Start a new mining run.'`; set `#boot-continue`.hidden = !readable; move the
    `boot-primary` class to Continue when readable and to New game otherwise.
  - `#boot-continue` → `dismiss()`.
  - `#boot-new` → re-read `const slot = saves.active()`; if `slotStatus(slot).kind === 'ok'`
    and (`!settings.value.confirmDestructive` or `confirm(...)` accepting) then
    `saves.newGame(slot)`; then `dismiss()`. The confirm text names the slot and warns that
    progress including research is erased. If the slot is not readable, only dismiss.
  - `#boot-settings` → `actions.openSettings()`.
  - Focus the readable ? Continue : New game. Add a `keydown` listener on `#boot`: on Tab,
    return early when `e.defaultPrevented` (the gear menu's trap runs first when it is
    open), otherwise cycle `[continue, newGame, settings].filter((b) => !b.hidden)` with
    `nextFocusIndex` from `./focus` and `e.preventDefault()`.
  - `dismiss()` sets `el.hidden = true`, idempotently. Do **not** set `#app.inert`: the
    gear menu lives inside `#app` and Settings must stay clickable.
  - `get open()` returns `!el.hidden`.
- [ ] **Step 4: Run the test and see it pass.** Run `npx vitest run tests/title.test.ts`.
  Expected: PASS.
- [ ] **Step 5: Wire `src/main.ts`.**
  - Import `TitleScreen` and construct it after `hud`:
    `const title = new TitleScreen(session, settings, { openSettings: () => hud.menu.toggle() });`
  - Pass a final argument to `new Input(...)`: `() => title.open`.
  - In `step`, compute `const paused = title.open ? 'manual' : pauseKind({...})` and call
    `hud.setPaused(title.open ? null : pauseBanner(paused))`. Leave the rest of the loop
    unchanged, so the renderer and HUD keep running while the title is up.
  - Add `title` to the `__amh` object.
- [ ] **Step 6: Block keyboard input in `src/input.ts`.** Add the final constructor
  parameter `private readonly blocked: () => boolean = () => false` and start `onKey` with
  `if (this.blocked()) return;`. Do not change `keyup` handling.
- [ ] **Step 7: Gate and commit.** Run `npm run check`. Commit:
  `Freeze the game and route input behind the boot title screen (#163)`.

**Done when:** `tests/title.test.ts` is green, `TitleScreen` is constructed in `main.ts`,
`__amh.title.open` is readable in the browser, and no `GameSession`/sim/settings file
changed.

---

## Task 3: README, browser verification and run log (controller-owned)

**Files:**
- Modify: `README.md`
- Create: `docs/superpowers/plans/2026-10-20-boot-title-screen-run-log.md`

- [ ] **Step 1: README.** Under “Play it online”, add one sentence: the first screen offers
  Continue for the active save, New game and Settings, and the first click also unlocks
  audio.
- [ ] **Step 2: Full gate.** Run `npm run check` and `npx vite build` on the branch head.
- [ ] **Step 3: Browser verification** in Chromium against the Vite dev server.
  - **Fresh storage:** before load, clear `localStorage`. `#boot` is visible, Continue is
    hidden, New game and Settings are visible, and the card fits at 1440x900 and 1024x768.
  - **First paint:** `#boot` has a non-transparent background and the title is readable
    without waiting for a click; no console errors and no `favicon.ico` 404.
  - **Freeze:** `__amh.title.open === true`; record `__amh.state().run.time`, wait ~1 s,
    record it again and assert it is unchanged; press `R` and assert the research panel
    did not open; press Tab and assert focus stays on a visible boot button.
  - **New game:** click it; `#boot` hidden, `__amh.audio.state === 'running'` (first click
    unlocked audio), and `run.time` starts advancing.
  - **Reload into Continue:** wait for an autosave, record system/time, reload, assert
    Continue is visible and the summary names the slot/system/time; click Continue and
    assert the same system/time is still there.
  - **Settings:** reload, click Settings, assert the gear menu is open above the title;
    close it with Esc and assert `#boot` is still visible.
  - **New game with a save:** override `window.confirm = () => true`, click New game from
    the title, and assert `profile.warps`/`run.time` reset and the title is hidden.
  - **Metadata:** read the live `<head>` and record the description, theme-color, favicon
    href prefix, every `og:*` value and `twitter:card`.
  - **Console:** only expected messages; no errors.
- [ ] **Step 4: Write the run log** with the issue/branch/spec/plan links, commands and
  results, every probe value above, screenshots if useful, and any deviation. Commit:
  `Document and verify the boot title screen (#163)`.

**Done when:** the run log records the fresh, reload/Continue, Settings and New game paths,
the freeze and metadata probes, and `npm run check` + `npx vite build` are green.

---

## Self-review notes

- **Spec coverage:** static first paint (Task 1), title actions and freeze (Task 2),
  metadata (Task 1 + Task 3), session/autosave untouched (global constraint + existing
  suite), README/run log (Task 3).
- **No placeholders:** the exact IDs, copy, metadata values, pause literal and summary
  format are above.
- **Type consistency:** `TitleScreen` consumes `SaveActions`, `SettingsStore` and
  `TitleActions`; `main.ts` passes `session`, `settings` and `hud.menu.toggle`; `Input`'s
  final parameter is a zero-argument predicate in both tasks.
- **Proportion:** two implementation tasks with one test each, plus controller browser
  verification; the CSS is described by role rather than transcribed line by line.
