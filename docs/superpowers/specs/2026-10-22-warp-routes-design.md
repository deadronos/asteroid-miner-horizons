# Warp routes: choose the next system (#172)

## Goal

Warping currently rolls the next system for you. After a few warps the run is a slot machine rather than a route
decision. Instead, a warp offers a few candidate systems, previews what matters about each (star class, modifiers,
hazard level, belts and richness), and the player picks one.

## Rules

- **Candidates are a pure function of `(seed, number, route)`.** `route` is an integer in `[0, TUNING.warpRoutes)`
  (3). `generateSystem(seed, number, route = 0)` derives a per-route seed and uses it for both the system stream
  and `rollModifiers`. **Route 0 uses the seed unchanged**, so it is exactly today's system: system 1, every
  existing generator snapshot and every saved system stay as they are.
- **Only the system varies by route.** `run.rng`, the contract board, the hazard schedule and rock traits keep
  their `(seed, number)` streams. The rock layout still differs between routes because the belts differ.
- **`warp` carries the route:** `{ t: 'warp'; route: number }`. The handler rejects a route that is not an integer
  in range with a `warn` line before anything is paid, then builds the run with `newRun(profile, route)`.
- **No save change.** The chosen system is saved in `run.system` as before; candidates are recomputed from the
  profile (`profile.warps + 2` is the next system number), so they never need persisting and a save/load shows the
  same choices.

## Preview

`src/sim/routes.ts` holds the pure helpers the HUD and the bot share:

- `warpRoutes(profile)` — the candidate `StarSystem`s, index = route.
- `hazardRating(starClass)` — `low` / `moderate` / `high` with a sentence built from the `FLARES` table (G: comets
  only; M: flares; B: strong flares), so the text cannot drift from the numbers.
- `routeRocks(system)` — rocks across all belts at the start (already scaled by the modifiers), and
  `routeValue(system)` = rocks × richness, the bot's yardstick.

The top bar's WARP button opens a **route picker** modal (it stays disabled, as today, until the bank holds the
fuel). Each candidate is a card: name and system number, star class, hazard level (noting when hazards are off in
the settings), belts / rocks / richness, and the modifier chips with their effect text. Each card has its own warp
button. The picker counts as a menu for _pause in menus_ and closes on Esc, like Research.

## Bot

`botCommands` warps to `chooseRoute(state)`: the highest `routeValue`, ties broken by the lower hazard level, then
the lower route. `BotOptions.route: 'best' | 'first'` keeps the old behaviour available (`first` = route 0). The
balance report plays `best` and says so.

## Trade-offs

- Three independent rolls can produce similar candidates. Forcing variety (e.g. distinct star classes) was
  rejected for now: it couples the routes and makes route 0 differ from the legacy system.
- The picker only opens once the warp is affordable; previewing earlier would be nice but changes the top bar's
  disabled-button contract and is left for later.
- Balance numbers after system 1 move because the bot now picks the richest route; the report is regenerated.
