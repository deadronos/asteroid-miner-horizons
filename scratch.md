# Suggested next issues

I'd suggest this order, based on the 47 open issues and the ⭐ picks in each umbrella issue. #9 (lint + CI) is already done through PR #52, so you could tick it off in #11.

## Next up: clean up before adding features

1. **#2 Split `ui/Hud.ts`** (502 lines) and **#3 Split `ui/Menu.ts`** (634 lines). Almost every feature below adds UI: contracts, refining, floating text and audio settings. Splitting these files first keeps each feature PR small and avoids merge conflicts. I'd do them as two separate PRs.
2. **#10 Fix the `pilot.ts` ↔ `update.ts` circular import.** It's small and quick, and now that oxlint is in CI, a good time to clear it.

## Then: build the measuring tools (they share a base)

3. **#12 Headless tick benchmark in CI** and **#43 Headless balance bot + report.** Both run the sim without the browser, so building one makes the other cheap. With them in place, the performance work (#13–#17) and balance tuning (#44–#46) are based on numbers rather than guesses.

## Then: quick game-feel wins

4. **#22 Floating pickup text**, **#21 Mining feedback**, **#19 Bloom.** These are cheap, visible improvements, and #22 would be the first test of the new HUD layout.
5. **#29 Audio engine + #30 Core SFX.** These hook into the existing `out.fx` event stream, so the sim stays untouched. Sound is the biggest feel gap right now.

## Then: mid-game content

6. **#35 Contracts → #36 Refining.** These follow the order already set in #42. By this point the UI is modular and the balance bot can check the new income they add.

**If you only want one thing:** start with #2, since the most other work builds on it. **If you'd rather work on something fun first:** #29 + #30 (audio) barely touch the parts being refactored, so they can go in parallel without conflicts.
