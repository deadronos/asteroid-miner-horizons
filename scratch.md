# Suggested next issues

Curated by an opencode session after the audio, visual and balance work landed. Ordered by leverage, not size.
The reasoning behind each pick matters more than the order — the state of play is in #42, #51, #18, #28.

## 1. #37 Hazards — the next pillar

#42's own order is contracts → refining → **hazards** → exploration → automation, and the first two are done.
The stronger argument is that shields, armor and engines currently have almost nothing to do: damage comes only
from collisions above a speed threshold and star heat. Hazards turn an already-shipped component economy into a
real decision, so most of the payoff reuses `src/data/components.ts` and `src/data/hulls.ts` rather than adding
content beside them. The continuous-audio rules (#31) and screen shake already supply the telegraphing
vocabulary.

Expect a pillar, not a task: a deterministic seeded entity, a warning window, a difficulty toggle and a balance
pass. Wants a spec, then one child issue per hazard.

## 2. #48, #49, #50 — variety

#51's remaining children, and the cheapest meaningful variety: #43's bot makes all three measurable. #51's
framing was "build the bot first, then tune and add variety" — the bot is built.

- **#48 rock traits.** Varies the loop the player is in ~80% of the time. Smaller than it reads: the rock hover
  tooltip already exists (`Hud.showTooltip` receives the `Rock` and prints size/kind/units/hp), so showing the
  trait is one more clause in an existing string, not new UI.
- **#49 component variants.** Sidegrades break the strict tier ladder that currently converges every build on
  the same fit.
- **#50 choice-based perks.** Wants respec-on-warp, so it reaches into `profile.perks` validation and the run
  reset path.

## 3. #40 Stats & achievements

Directly answers #42's complaint ("no long-term feedback across runs"). `Profile` is only
`{ seed, warps, data, dataEarned, perks }`, so this is a `SAVE_VERSION` bump, a migration, `fromData` validation
and a ⚙ menu tab — conventional and low risk, and it exercises the save conventions end to end. Good candidate
if a small, complete change is wanted rather than a pillar.

## 4. #17 Cheaper autosave and smaller exports

Last child of #18, with measurable acceptance criteria (exports ≥ 50% smaller, no frame > 16 ms). One thing to
decide before starting: `writeSlot` (local saves) and `exportText` (import/export) are the same code path today,
so "round exports only, keep local saves exact" needs those two split apart first.

## Housekeeping

- **#34 closed** — all five children merged: #29/#30 → PR #55, #31 → PR #66, #32/#33 → PR #73.
- **#42 checklist refreshed** — #35 → PR #61, #36 → PR #62. #51 was already up to date.
- #18 is down to #17 alone; #28 still has #23–#27 open.
