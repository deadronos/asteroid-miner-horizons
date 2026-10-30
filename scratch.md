# Suggested next issues

Rewritten 2026-10-31 at v0.12.0 (unreleased work on `main` since then), after the 2026-10-30 wave landed: #159,
#164, #174, #206–#212, #216, #217, #219, #220 (PRs #225–#238). Ordered by leverage, not size. The index of open
work is #178; the category umbrellas are #42 (scope), #51 (balance), #28 (visuals) and #18 (performance). This file
is the maintainer's notebook; agents do not edit it (see AGENTS.md).

## 0. Housekeeping

- **Cut a release.** `main` carries save v14, construction drones, gamepad, colour-vision palette, tab lock and the
  balance pass, all since v0.12.0. Bump to 0.13.0 and tag.
- **Close #18** (performance umbrella): every child is done. #28 is down to #27; #51 to #50, #173 and #176.
- **Delete merged remote branches.** 13 `claude/*` branches from PRs #225–#237 (and `fix/frozen-save-v13-215`
  from the closed #224) are still on origin.

## 1. #239: small follow-ups from #174 (S)

Filed as #239; each is a few lines plus a test.

- A build order that is waiting (unsafe rock, outpost limit, reserve) has no status of its own; it reads as
  hauling. Add a `buildWaiting` reason.
- A hand-flown (WASD) drone keeps its last AI status in the fleet list.
- The README doesn't mention scarcity-aware mining or autopilot rock braking.
- `tests/alloc.test.ts`: its construction drone never builds (no alloy), so the build path's allocation is unmeasured.

## 2. Balance watch (S, file if it bites)

The opening target sits at exactly 24/30 (80%) in the Docker report and reads 23/30 natively. Any tuning that
nudges the early game can flip it. Worth a short look at why 6 seeds miss the first drone + tier-2 laser before
the first warp, before more pillar work moves the numbers again.

## 3. The next pillar: #175 pirates and combat

Now well-founded: #208's report shows shields and armor absorb 0% of damage, and #174's rock braking cut
collision damage from 165 to 42 per system, so defensive components have even less to do. Combat gives them a
job. Large; spec first (brainstorm → design → plan, as #174 did). The hazards pillar (#37) and the construction
drone (#174) are the templates for a new hull, a brain and a balance row. Keep hostile spawns out of system 1 and
behind the hazard setting.

## 4. Then the economy and the ending

- **#173 contracts and reputation**: survey, refined-goods, bounty and escort kinds; reputation per contractor.
  Escort contracts want #175 first.
- **#176 station market and trade routes**: per-system prices from the seed; warp routes (#172) are the hook.
- **#177 Horizon Gate / New Game+**: the ending. Needs a target the bot can reach; best after #176 gives Horizon
  Data and goods somewhere to go.

## 5. Small scope items with thin specs

- **#50 choice-based perks** and **#38 exploration**: still two-line specs from the first review. Rewrite each in
  Why / Proposal / Acceptance before picking them up.
- **#27 corner minimap**: #164 made the map view readable. Decide whether a minimap is still wanted; close it if
  not.

## Later / help wanted

- **#129 headless browser test tier** and **#123 AA check on HiDPI / Safari / Firefox**: infra or manual.
  #129 would also cover the renderer numbers #159's stress bench couldn't measure.
