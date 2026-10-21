# Suggested next issues

Rewritten 2026-10-21 at v0.10.0, after the October review's polish wave landed (#155–#158, #160–#163,
#167/#168/#170, #171, #188). Ordered by leverage, not size. The index of open work is #178; the category
umbrellas are #42 (scope), #51 (balance), #28 (visuals), #154 (audio) and #18 (performance).

## 0. Merge #193, then #195 (stale docs)

#193 (critical-path sim coverage) is green and only needs a review. #195 is a `npm run balance` run plus a
README edit: `docs/balance.md` is 66 commits behind and was generated before slot expansion, fleet automation
and onboarding. Do it before any balance-sensitive work below, so #172 starts from real numbers. The old report
showed the first tier-2 upgrade not reached in 3/10 seeds and the fleet never full; recheck that once it is fresh.

## 1. #172 Warp route choice — the only `priority: high`

Warp is currently a slot machine: the next system is rolled for you. Choosing between 2–3 previewed candidates
turns it into a route decision using data that already exists (`src/data/modifiers.ts`, `hazards.ts`, star
classes). It is mostly sim work with a small preview UI, it is deterministic from `(seed, number, route)` and
needs no new save field, and the balance bot can pick routes so the effect is measurable. It is also the
foundation for #173 (faction reputation per route), #176 (trade routes) and #177 (the Horizon Gate endgame).
Wants a spec first.

## 2. Short palate cleansers between pillars

Each is a self-contained change with tight acceptance criteria.

- **#169 music ducking.** The last open child of #154; closing it closes the audio umbrella. One gain stage and
  an envelope helper with a unit test.
- **#166 accessibility.** Resource icons beside colour-only values and automatic `prefers-reduced-motion`.
  Nothing in `src/` reads `prefers-reduced-motion` today.
- **#165 mining feedback.** The beam is the core action and reads weakly; the rock tooltip covers the target.
  `src/ui/rockTooltip.ts` is the place to start.

## 3. The next pillar: #174 or #175

- **#174 fleet command depth** if the goal is depth in what exists: roles, priorities and an "idle because…"
  reason. Builds on #140's per-ship toggles and `src/sim/fleetAuto.ts`.
- **#175 pirates and combat** if the goal is a new pillar. Large: it needs a spec, combat modules in
  `src/data/components.ts`, AI, balance and audio/visual telegraphing. The hazards pillar (#37) is the template.

Do #172 first either way; route choice gives both of these somewhere to live.

## 4. Reach: #194 touch controls

Untracked until now. #160 already scales rendering down for weaker devices, but nothing can be played without
a keyboard: no pinch, no tap-to-act for hotkeys, thrust only from held keys. Pure gesture maths plus a coarse-
pointer action strip. Pair it with the manual mobile check in #123.

## Later / when there is appetite

- **#164 map view** and **#27 corner minimap** — overlap; do #164 first, then decide whether #27 is still wanted.
- **#173 contracts and reputation**, **#176 market and trade**, **#177 Horizon Gate / NG+** — after #172.
- **#50 choice-based perks**, **#38 exploration** — older scope items, still valid.
- **#159 bench stress mode** — find the performance cliff before players do; not urgent at current numbers.
- **#129 headless browser tests**, **#123 AA check on HiDPI/Safari/Firefox** — `help wanted`; manual or infra.
- Not filed: gamepad support and key rebinding UI. File only if wanted.

## Housekeeping done 2026-10-21

- #178, #153 and #154 checklists synced with closed issues; #153 closed (all children done).
- Filed #194 (touch controls) and #195 (stale balance report and README "Ideas for later"); both added to #178.
- #154 is down to #169; #18 to #159; #28 to #164–#166 and #27.
