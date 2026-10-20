# Balance coverage: hazards and the late game — findings

Investigation only; no tuning changed. The balance report had two blind spots: it played with hazards `off`
while the game defaults to `normal`, and it stopped at 10 warps while maxing every perk costs 253 HD. All runs
below are 10 seeds (1000–1009) at commit `753f763`, via `npm run balance -- [--hazards normal] [--warps 25]`.

## Results

### Hazards (`normal` vs `off`, 10 warps)

| | off | normal |
| --- | --- | --- |
| Total time for 10 systems (median, min–max) | 96.5 min (87.5–105.0) | 100.9 min (97.5–110.7) |
| Mid-game active-play share (pooled) | 60% | 61% |
| Walls | 0 | 0 |

Hazards add about 5% to the time. Most of that lands in systems 2–6, where each system takes 5–20% longer. The
active-play share hardly moves, because the flagship still docks to shelter from flares and so still unloads.
At 25 warps hazards make the wall come sooner for some seeds: seed 1000 walls at system 15 and seed 1003 at
system 16, where with hazards off they wall at 19 and 18.

### Late game (25 warps)

- **No system takes 2× as long as the previous one.** Measured by the median, time in system grows a steady
  1.0–1.4× per system. A system takes about twice as long as system 1 by system 6, about 5× by system 12 and
  about 10× by system 17. A few seeds go over 2× in a given system, typically on an ice-poor or modifier roll,
  and they catch up in the next system.
- **There is a hard wall at systems 17–19.** Every seed hits the 60-minute cap at least once. With hazards off
  the first capped system is 17 (1 seed), 18 (5 seeds) or 19 (4 seeds). Reaching the wall takes 6–7.3 hours of
  sim time.
- **The wall comes from ice income, not the refinery.** I instrumented seed 1000 at its wall in system 19. The
  warp cost 3374 fuel (16,870 ice) with Warp Theory 5. The refinery queue sat empty for the whole hour, the bank
  held 0–5 ice, and the bank fuel rose by only about 280 every 10 minutes (about 140 ice/min). At that rate the
  warp takes about 2 hours. The cause is the gap between growth rates: warp fuel grows 1.3× per warp (86× by
  warp 17), while value per minute only rises from about 175 to about 1100 (6×) across the same systems. Belt
  regrowth tops up each belt by one rock every 4 s and only while it is below 75% of its starting density, so
  the bot cannot mine ice any faster.
- **Total HD reaches the full perk cost (253) at system 17, after about 5.5 hours**, in 9 of 10 seeds. Seed
  1001 walls at 17 with 221 HD. Maxing perks and hitting the wall happen within one or two systems of each
  other. After the wall, warping has nothing left to buy, which makes the wall less painful than it looks.
  Still, a player who is short of the last few perks runs into a 1–2 hour grind for each one.

## Recommendations

1. **The CI report now plays hazards `normal` (done in this change).** That is how the game is actually played,
   it costs CI about 4 s and the conclusions stay the same. `scripts/balance.ts` now defaults to `normal`,
   `--hazards off` still gives calm play, the report header names the hazard level, and `docs/balance.md` has
   been regenerated.
2. **The CI default stays at 10 warps.** A 25-warp run takes about 2 minutes, 4–5× the 10-warp run, and the
   committed report would then always contain walls, which makes the freshness diff noisy. Instead, run
   `npm run balance -- --warps 20 --out /tmp/late.md` by hand whenever you change `warpBaseFuel`,
   `warpCostGrowth`, perk costs, `dataDivisor`, belt regrowth or the fuel recipe. Twenty warps is enough to
   show the wall. A cheaper follow-up: add a "cumulative HD vs perk cost" line to the report, so the 10-warp
   report shows how far into the perk tree play gets (about 100 HD by system 10).
3. **Tuning the data points to (decide in a follow-up, then measure with `--warps 20`):**
   - Flatten the fuel curve, for example `warpCostGrowth` 1.3 → 1.25. At warp 18 with Warp Theory 5 that
     costs about 1665 fuel instead of 3374, between today's warp-15 and warp-16 costs. It barely changes the first 10
     systems: warp 9 costs about 0.70× as much. Or keep 1.3 until warp ~12 and grow linearly after that.
   - Alternatively, make the late game's ice supply grow with it. Options: a perk or refinery upgrade that
     lowers the ice in the fuel recipe below 5:1, or faster belt regrowth as warps rise. That keeps the early
     curve exactly as it is.
   - Decide what should happen once every perk is maxed. If the wall is the intended end of the content, add a
     clear end state or an HD sink. If not, the curve above should keep systems 17+ under the 60-minute cap.
