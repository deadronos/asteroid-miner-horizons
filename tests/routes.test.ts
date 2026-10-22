import { describe, expect, it } from 'vitest';
import { MODIFIERS } from '../src/data/modifiers';
import { TUNING } from '../src/data/tuning';
import { newGame, newProfile } from '../src/sim/create';
import { generateSystem } from '../src/sim/generate';
import { hazardRating, isRoute, routeRocks, routeValue, warpRoutes } from '../src/sim/routes';
import { routeCard, warpPanelKey } from '../src/ui/panels/WarpPanel';
import { send } from './helpers';

describe('warp routes', () => {
  it('the same seed, number and route always generate the same system', () => {
    for (let route = 0; route < TUNING.warpRoutes; route++) {
      expect(generateSystem(77, 4, route)).toEqual(generateSystem(77, 4, route));
    }
  });

  it('route 0 is the system the default call generates', () => {
    for (let n = 1; n <= 6; n++) expect(generateSystem(9, n, 0)).toEqual(generateSystem(9, n));
  });

  it('offers TUNING.warpRoutes candidates for the next system number', () => {
    const p = newProfile(3);
    p.warps = 4;
    const routes = warpRoutes(p);
    expect(routes).toHaveLength(TUNING.warpRoutes);
    for (const sys of routes) expect(sys.number).toBe(6);
  });

  it('routes are different systems', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const p = newProfile(seed);
      p.warps = 3;
      expect(new Set(warpRoutes(p).map((s) => s.name)).size).toBeGreaterThan(1);
    }
  });

  it('routes roll their own star classes and modifiers across seeds', () => {
    const classes = new Set<string>();
    let modsDiffer = false;
    for (let seed = 1; seed <= 40; seed++) {
      const p = newProfile(seed);
      p.warps = 3;
      const routes = warpRoutes(p);
      for (const s of routes) classes.add(s.starClass);
      if (new Set(routes.map((s) => s.modifiers.join(','))).size > 1) modsDiffer = true;
    }
    expect(classes).toEqual(new Set(['M', 'G', 'B']));
    expect(modsDiffer).toBe(true);
  });

  it('the route changes only the system: contract and hazard streams are shared', () => {
    const [a, b] = [0, 1].map((route) => {
      const s = newGame(12);
      s.profile.warps = 2;
      s.run.bank.fuel = 1000;
      send(s, { t: 'warp', route });
      return s;
    });
    expect(a!.run.system.name).not.toBe(b!.run.system.name);
    expect(a!.run.hazards.rng).toEqual(b!.run.hazards.rng);
    expect(a!.run.contracts.rng).toEqual(b!.run.contracts.rng);
  });

  it('isRoute accepts only integers in range', () => {
    expect(isRoute(0)).toBe(true);
    expect(isRoute(TUNING.warpRoutes - 1)).toBe(true);
    for (const bad of [-1, TUNING.warpRoutes, 1.5, Number.NaN, '1', undefined]) expect(isRoute(bad)).toBe(false);
  });

  it('rates hazards by star class', () => {
    expect(hazardRating('G')).toEqual({ level: 'low', text: 'Comets only' });
    expect(hazardRating('M').level).toBe('moderate');
    expect(hazardRating('B').level).toBe('high');
    expect(hazardRating('B').text).toContain('22 dps');
  });

  it('values a route by its opening rocks and richness', () => {
    const sys = generateSystem(5, 4, 1);
    expect(routeRocks(sys)).toBe(sys.belts.reduce((n, b) => n + b.initialCount, 0));
    expect(routeValue(sys)).toBeCloseTo(routeRocks(sys) * sys.richness);
  });
});

describe('route card', () => {
  it('shows the star, hazard, belts and modifiers at a glance', () => {
    let sys = generateSystem(1, 4, 0);
    for (let seed = 1; sys.modifiers.length === 0; seed++) sys = generateSystem(seed, 4, 1);
    const c = routeCard(sys, 'normal');
    expect(c.title).toBe(`${sys.name} · SYS 4`);
    expect(c.star).toMatch(new RegExp(`^${sys.starClass}-class `));
    expect(c.hazard).toBe(hazardRating(sys.starClass).level);
    expect(c.belts).toBe(
      `${sys.belts.length} belts · ${routeRocks(sys)} rocks · richness ${Math.round(sys.richness * 100)}%`,
    );
    expect(c.modifiers.map((m) => m.name)).toEqual(sys.modifiers.map((id) => MODIFIERS[id].name));
  });

  it('notes when hazards are off or harsh in the settings', () => {
    const sys = generateSystem(1, 4, 0);
    expect(routeCard(sys, 'off').hazardText).toMatch(/\(hazards are off\)$/);
    expect(routeCard(sys, 'harsh').hazardText).toMatch(/, harsh$/);
    expect(routeCard(sys, 'normal').hazardText).toBe(hazardRating(sys.starClass).text);
  });

  it('the picker rebuilds when the warp count, seed or hazard setting changes', () => {
    const p = newProfile(1);
    const k = warpPanelKey(p, 'normal');
    expect(warpPanelKey({ ...p, warps: 1 }, 'normal')).not.toBe(k);
    expect(warpPanelKey({ ...p, seed: 2 }, 'normal')).not.toBe(k);
    expect(warpPanelKey(p, 'off')).not.toBe(k);
  });
});
