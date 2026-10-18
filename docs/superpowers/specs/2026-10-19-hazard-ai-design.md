# Hazard-aware AI — design

- **Issue:** #37 (follow-up to the hazards feature, PR #76)
- **Builds on:** [`2026-10-19-hazards-design.md`](2026-10-19-hazards-design.md)

## Goal

Hazards shipped with an AI that ignores them: drones and the balance bot mine straight through a flare and sit in
a comet's path. Teach both to react the way a careful player would, so drones are worth having in hazard systems
and the balance numbers measure a player who shelters rather than one who never does.

## Rules

Two shared, pure predicates in `src/sim/hazards.ts`, used by the drone AI (`sim/pilot.ts`) and the balance bot
(`scripts/bot.ts`) alike:

- **Flare zone** — `inFlareZone(run, pos)`: a flare is pending or burning (`hazards.flare` set, either phase),
  the star class has a flare profile, and `pos` lies within `reach + TUNING.flareShelterPad` of the star. The pad
  gives hysteresis: a ship that fled stops _outside_ the pad, so it does not re-trigger at the boundary.
- **Comet path** — `cometPathEscape(run, comets, pos, pad, out)`: `pos` lies within `radius + pad` either side of
  the straight path ahead of the pending comet (`hazards.comet`: `from` along `vel`, at the largest comet radius)
  or of a live comet rock (`rock.comet`, its `pos` along its `vel`). "Ahead" includes the comet's own body
  (anything up to `radius + pad` behind its centre). On a hit it writes the unit vector straight out of the path,
  on the side the point already lies, and returns true.
- **Shelter** — `flareShelter(run, pos, preferDock, out)`: inside the flare zone, choose between docking at the
  station (docked ships take no flare damage) and moving radially outward to `reach + pad + 40`. Dock when the
  station is no farther than the way out, or when `preferDock` (a full hold that is heading home anyway). Writes the
  flee point into `out`.

### Drone AI (`droneThink`)

Before anything else, hazard reflexes: in a comet path → steer straight out of it at full throttle; else in the
flare zone → dock (holding there once docked) or flee as `flareShelter` says. Then the existing brain runs with a
safety filter: pickups, the current target, the flagship's target and new rock targets are skipped when they lie
in the flare zone or a comet path, and when the anchor's home slot is unsafe the drone holds position instead of
flying into danger.

Live comets themselves are skipped as targets by that filter (their body counts as their path). Drones (90–105 u/s)
cannot keep pace with a comet (130+ u/s) anyway.

### Balance bot (`flagshipOrder`)

The same reflexes, as Commands: in a comet path → `move` 150 units straight out of it; in the flare zone → `dock`
(or nothing once docked, so it stays) or `move` to the flee point. A `mine` order whose rock has become unsafe is
replaced; `pickRock` and the debris chase skip unsafe targets; with nothing safe to do the bot issues `stop`.

## Determinism and hazards off

Everything is a pure function of the state; no RNG is drawn. With hazards off there is never a flare or comet
(`updateHazards` clears both, and none spawn), so every predicate is false and every filter passes: behaviour and
`docs/balance.md` stay byte-identical.

## Trade-offs

- **Whole-ray comet paths.** The path is treated as dangerous along its full length for the whole warning and
  flight, not just near the comet. It is simple, matches the line the renderer draws, and the corridor is narrow
  (~200 units) compared with a belt.
- **No comet mining by the AI.** Comets are a rich target, but chasing one is what gets ships hit. A player can
  still mine them by hand.
- **Manual orders are not overridden.** A drone with a player order follows it; only the autonomous brain shelters.
