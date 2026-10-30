# Suggested next issues

Rewritten 2026-10-30 at v0.12.0, after #213, #214, #215 and #218 landed (PRs #221–#223). Ordered by leverage,
not size. The index of open work is #178; the category umbrellas are #42 (scope), #51 (balance), #28 (visuals)
and #18 (performance). This file is the maintainer's notebook; agents do not edit it (see AGENTS.md).

## 0. Housekeeping

- **Close PR #224.** It duplicates #222 (save-v13 fixture for #215), which is already merged.
- **#220 needs your decision** before #211 is built: does offline income accrue while manually paused, and for
  every slot in parallel? Options (a)/(b)/(c) are in the issue; (c) needs a save field and a `SAVE_VERSION` bump.

## 1. Bugs that players hit

- **#219 slow motion below ~7.5 fps (S).** The loop drops its backlog after 8 steps, so low-end phones lose game
  time silently. Raise the cap to cover the 0.25 s clamp and report dropped time. Matters more since touch
  controls (#194) invite weaker devices.
- **#211 two tabs on one slot (M).** Autosaves clobber each other and offline income can be paid twice. A per-slot
  `navigator.locks` lock with a read-only second tab. Do it right after #220 is decided, since both touch the
  offline-credit path in `src/session.ts`.

## 2. Make the balance numbers trustworthy, then tune

Do these in order; each depends on the one before.

1. **#212 balance report does not reproduce (S).** Regenerate `docs/balance.md` from clean `main`, pin the Node
   version if the output is environment-dependent, and make the CI freshness step fail instead of warn.
2. **#208 measure hazard damage, losses and repair spend (S/M).** Harness-only counters, no save change. Gives
   #175 a baseline before combat exists.
3. **#206 refining, outposts and haulers idle until system 6** and **#207 fleet cap unused through system 5.**
   Tuning against the fresh report; add each target as a PASS/FAIL row. Keep the ≥ 40% active-play target green.

## 3. Performance and build

- **#216 vendor chunk + bundle budget (S/M).** Split three.js out so game updates stop busting an 800 kB cache
  entry; a gzip budget in CI.
- **#217 per-tick and per-frame allocations (M).** O(n²) ship scan, belt regrow closures, renderer/labels/audio
  garbage; tighten `TICK_ALLOC_BUDGET` to 32 kB.
- **#159 bench stress mode.** Pair with #217: the stress run is what shows the O(n²) cost at 50 ships.

## 4. The next pillar

- **#174 fleet command depth** first: roles, priorities and an "idle because…" reason. It explains the #206/#207
  findings to the player and builds on `src/sim/fleetAuto.ts`.
- **#175 pirates and combat** when there is appetite for a new pillar. Large; spec first, and use #208's numbers.
- Then **#173 contracts and reputation**, **#176 market and trade**, **#177 Horizon Gate / NG+**. All three can
  hang off warp routes (#172, done).

## 5. Reach and readability

- **#164 map view** (fleet, outposts, hazards, belt labels), then decide whether **#27 corner minimap** is still
  wanted.
- **#209 gamepad** onto the existing `KeyBindings` action map; **#210 colour-vision palette** and non-colour cues
  in the 3D view.

## Later / when there is appetite

- **#50 choice-based perks**, **#38 exploration**: older scope items with two-line specs; rewrite them in the
  Why / Proposal / Acceptance format before picking them up.
- **#129 headless browser tests**, **#123 AA check on HiDPI/Safari/Firefox**: `help wanted`; infra or manual.
