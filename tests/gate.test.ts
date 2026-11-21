import { describe, expect, it } from 'vitest';
import { emptyDoctrines } from '../src/data/doctrines';
import {
  GATE_STAGES,
  NG_PLUS_COST_STEP,
  NG_PLUS_HAZARD_STEP,
  NG_PLUS_RICHNESS_STEP,
  NG_PLUS_RULE,
  freshGate,
  formatGateCost,
  gateStageCost,
} from '../src/data/gate';
import { botCommands } from '../scripts/bot';
import { newGame, newProfile, newRun } from '../src/sim/create';
import { warpCost } from '../src/sim/economy';
import { deliverable, keptDoctrines, keptPerks, nextNgPlusSeed } from '../src/sim/gate';
import { deserialize, serialize } from '../src/sim/save';
import { gateChip, gatePanel, summaryRows } from '../src/ui/gateView';
import { runTicks, send } from './helpers';

const fill = (s: ReturnType<typeof newGame>, patch: Partial<ReturnType<typeof newGame>['run']['bank']> = {}): void => {
  s.profile.data = 50;
  s.run.bank = { ore: 5000, ice: 5000, crystal: 5000, alloy: 5000, fuel: 5000, ...patch };
};

describe('Horizon Gate', () => {
  it('has at least three stages, each costing Horizon Data and resources', () => {
    expect(GATE_STAGES.length).toBeGreaterThanOrEqual(3);
    for (const stage of GATE_STAGES) {
      expect(stage.cost.data).toBeGreaterThan(0);
      const resources = stage.cost.ore + stage.cost.ice + stage.cost.crystal + stage.cost.alloy + stage.cost.fuel;
      expect(resources).toBeGreaterThan(0);
      expect(stage.name.length).toBeGreaterThan(0);
    }
  });

  it('pays part of a stage and keeps that progress across a warp', () => {
    const s = newGame(4);
    s.profile.data = 0;
    s.run.bank.ore = 10;
    s.run.bank.fuel = 1000;
    const before = s.run.rng.s;
    send(s, { t: 'fundGate' });
    expect(s.profile.gate.stage).toBe(0);
    expect(s.profile.gate.paid.ore).toBe(10);
    expect(s.profile.gate.paid.data).toBe(0);
    expect(s.run.bank.ore).toBe(0);
    expect(s.run.rng.s).toBe(before);
    send(s, { t: 'warp', route: 0 });
    expect(s.profile.warps).toBe(1);
    expect(s.profile.gate.paid.ore).toBe(10);
    expect(s.run.system.number).toBe(2);
  });

  it('does not spend the fuel a warp needs', () => {
    const s = newGame(4);
    const reserve = warpCost(s);
    s.run.bank.fuel = reserve;
    expect(deliverable(s, 'fuel', 10)).toBe(0);
    s.run.bank.fuel = reserve + 4;
    expect(deliverable(s, 'fuel', 10)).toBe(4);
    fill(s);
    s.run.bank.fuel = reserve;
    send(s, { t: 'fundGate' });
    expect(s.run.bank.fuel).toBe(reserve);
    send(s, { t: 'warp', route: 0 });
    expect(s.profile.warps).toBe(1);
  });

  it('rejects an empty delivery and an early New Game+', () => {
    const s = newGame(4);
    s.profile.data = 0;
    s.run.bank = { ore: 0, ice: 0, crystal: 0, alloy: 0, fuel: warpCost(s) };
    send(s, { t: 'fundGate' });
    expect(s.out.log.at(-1)?.level).toBe('warn');
    expect(s.profile.gate).toEqual(freshGate());
    send(s, { t: 'newGamePlus' });
    expect(s.out.log.at(-1)?.text).toBe('The Horizon Gate is not open yet.');
    expect(s.profile.warps).toBe(0);
    send(s, { t: 'dismissGate' });
    expect(s.out.log.at(-1)?.text).toBe('No Horizon Gate summary to dismiss.');
  });

  it('opens on the last stage, records the summary and the achievement, and round-trips mid-gate', () => {
    const s = newGame(9);
    s.profile.doctrines = { fleet: 'swarm', haul: null, focus: 'brawler' };
    s.profile.warps = 6;
    s.profile.dataEarned = 40;
    s.profile.stats.time = 1234;
    s.profile.stats.rocksBroken = 80;
    s.profile.stats.unitsMined = 900;
    s.profile.stats.contracts = 3;
    s.profile.stats.refined = 20;
    fill(s);
    send(s, { t: 'fundGate' });
    expect(s.profile.gate.stage).toBe(GATE_STAGES.length);
    expect(s.profile.gate.summary).toMatchObject({
      warps: 6,
      time: 1234,
      rocksBroken: 80,
      unitsMined: 900,
      contracts: 3,
      refined: 20,
      dataEarned: 40,
      doctrines: { fleet: 'swarm', haul: null, focus: 'brawler' },
    });
    expect(s.profile.stats.gates).toBe(1);
    runTicks(s, 1);
    expect(s.profile.achievements).toContain('gateOpen');
    expect(s.out.log.some((l) => l.achievement === 'gateOpen')).toBe(true);

    const mid = newGame(9);
    fill(mid, { ore: 12, ice: 0, crystal: 0, alloy: 0 });
    mid.profile.data = 0;
    send(mid, { t: 'fundGate' });
    expect(mid.profile.gate.stage).toBe(0);
    expect(mid.profile.gate.paid.ore).toBe(12);
    const back = deserialize(serialize(mid));
    expect(back).not.toBeNull();
    expect(serialize(back!)).toBe(serialize(mid));
    expect(back!.profile.gate.paid.ore).toBe(12);
  });

  it('ignoring the gate leaves a warp on the same terms as before', () => {
    const a = newGame(3);
    const b = newGame(3);
    a.run.bank.fuel = 1000;
    b.run.bank.fuel = 1000;
    b.profile.gate.paid.ore = 5;
    send(a, { t: 'warp', route: 1 });
    send(b, { t: 'warp', route: 1 });
    expect(a.profile.warps).toBe(1);
    expect(b.profile.warps).toBe(1);
    expect(a.run.system.name).toBe(b.run.system.name);
    expect(b.profile.gate.paid.ore).toBe(5);
    expect(a.profile.data).toBe(b.profile.data);
  });
});

describe('New Game+', () => {
  it('keeps 3 perk levels on the highest perks and the first set doctrine pair', () => {
    expect(keptPerks({ yield: 5, optics: 4, thrust: 2, bay: 0, kit: 0, warp: 0, furnace: 0, hopper: 0 })).toEqual({
      yield: 3,
      optics: 0,
      thrust: 0,
      bay: 0,
      kit: 0,
      warp: 0,
      furnace: 0,
      hopper: 0,
    });
    expect(keptPerks({ yield: 1, optics: 1, thrust: 1, bay: 9, kit: 0, warp: 0, furnace: 0, hopper: 0 })).toEqual({
      yield: 0,
      optics: 0,
      thrust: 0,
      bay: 3,
      kit: 0,
      warp: 0,
      furnace: 0,
      hopper: 0,
    });
    expect(keptPerks({ yield: 2, optics: 0, thrust: 0, bay: 2, kit: 0, warp: 0, furnace: 0, hopper: 0 })).toEqual({
      yield: 2,
      optics: 0,
      thrust: 0,
      bay: 1,
      kit: 0,
      warp: 0,
      furnace: 0,
      hopper: 0,
    });
    expect(keptDoctrines({ fleet: null, haul: 'courier', focus: 'brawler' })).toEqual({
      ...emptyDoctrines(),
      haul: 'courier',
    });
    expect(keptDoctrines({ fleet: 'ace', haul: 'freighter', focus: null }).fleet).toBe('ace');
  });

  it('resets the run and the progression, advances the galaxy seed and ngPlus cycle, and copies the kept subset by stable ids', () => {
    const s = newGame(11);
    s.profile.doctrines = { fleet: null, haul: 'freighter', focus: 'survey' };
    s.profile.perks = { yield: 4, optics: 1, thrust: 0, bay: 2, kit: 0, warp: 0, furnace: 0, hopper: 0 };
    s.profile.warps = 8;
    s.profile.data = 12;
    s.profile.dataEarned = 30;
    s.profile.stats.gates = 0;
    s.profile.achievements = ['firstJump'];
    s.profile.goalsDismissed = true;
    const seed = s.profile.seed;
    expect(s.profile.ngPlus).toBe(0);
    fill(s);
    send(s, { t: 'fundGate' });
    expect(s.profile.gate.summary).not.toBeNull();
    const gates = s.profile.stats.gates;
    send(s, { t: 'newGamePlus' });
    expect(s.profile.ngPlus).toBe(1);
    expect(s.profile.seed).toBe(nextNgPlusSeed(seed, 1));
    expect(s.profile.seed).not.toBe(seed);
    expect(s.profile.warps).toBe(0);
    expect(s.profile.data).toBe(0);
    expect(s.profile.dataEarned).toBe(0);
    expect(s.profile.gate).toEqual(freshGate());
    expect(s.profile.perks).toEqual({ yield: 3, optics: 0, thrust: 0, bay: 0, kit: 0, warp: 0, furnace: 0, hopper: 0 });
    expect(s.profile.doctrines).toEqual({ fleet: null, haul: 'freighter', focus: null });
    expect(s.profile.stats.gates).toBe(gates);
    expect(s.profile.achievements).toContain('firstJump');
    expect(s.profile.goalsDismissed).toBe(true);
    expect(s.run.system.number).toBe(1);
    expect(s.out.log.some((l) => l.text.includes('freighter'))).toBe(true);
    expect(s.out.fx.at(-1)).toEqual({ t: 'warp' });
    // A second identical profile takes the same keep, and the new run matches deterministically.
    const again = newGame(11);
    again.profile.doctrines = { fleet: null, haul: 'freighter', focus: 'survey' };
    again.profile.perks = { yield: 4, optics: 1, thrust: 0, bay: 2, kit: 0, warp: 0, furnace: 0, hopper: 0 };
    fill(again);
    send(again, { t: 'fundGate' });
    send(again, { t: 'newGamePlus' });
    expect(again.profile.seed).toBe(s.profile.seed);
    expect(again.profile.ngPlus).toBe(1);
    expect(JSON.stringify(again.run)).toBe(JSON.stringify(s.run));
  });

  it('scales gate stage costs, system richness and hazard timers on NG+ cycles', () => {
    const base0 = gateStageCost(0, 0);
    expect(base0).toBe(GATE_STAGES[0]!.cost);
    const ng1 = gateStageCost(0, 1);
    const ng2 = gateStageCost(0, 2);
    expect(ng1.data).toBe(Math.round(base0.data * (1 + NG_PLUS_COST_STEP)));
    expect(ng1.ore).toBe(Math.round(base0.ore * (1 + NG_PLUS_COST_STEP)));
    expect(ng2.data).toBe(Math.round(base0.data * (1 + 2 * NG_PLUS_COST_STEP)));

    // Same seed on ngPlus 0 vs ngPlus 1: richness increases and hazard timers tighten.
    const p0 = newProfile(42);
    const p1 = { ...newProfile(42), ngPlus: 1 };
    const r0 = newRun(p0, 0);
    const r1 = newRun(p1, 0);
    expect(r1.system.richness).toBeCloseTo(r0.system.richness * (1 + NG_PLUS_RICHNESS_STEP), 9);
    expect(r1.hazards.cometTimer).toBeCloseTo(r0.hazards.cometTimer / (1 + NG_PLUS_HAZARD_STEP), 9);
    expect(r1.hazards.flareTimer).toBeCloseTo(r0.hazards.flareTimer / (1 + NG_PLUS_HAZARD_STEP), 9);

    // Paying the base cost on NG+1 only partially pays the scaled stage.
    const s = newGame(7);
    s.profile.ngPlus = 1;
    s.profile.data = base0.data;
    s.run.bank = { ore: base0.ore, ice: base0.ice, crystal: base0.crystal, alloy: base0.alloy, fuel: 1000 };
    send(s, { t: 'fundGate' });
    expect(s.profile.gate.stage).toBe(0);
    expect(s.profile.gate.paid.data).toBe(base0.data);
    // Round-tripping mid-stage on NG+1 passes validation even when paid exceeds base cost.
    s.profile.data = ng1.data - base0.data;
    s.run.bank.ore = ng1.ore - base0.ore;
    // Leave ice short so the stage stays open while ore exceeds base0.ore.
    send(s, { t: 'fundGate' });
    expect(s.profile.gate.stage).toBe(0);
    expect(s.profile.gate.paid.ore).toBe(ng1.ore);
    expect(s.profile.gate.paid.ore).toBeGreaterThan(base0.ore);
    const loaded = deserialize(serialize(s));
    expect(loaded).not.toBeNull();
    expect(loaded!.profile.ngPlus).toBe(1);
    expect(loaded!.profile.gate.paid.ore).toBe(ng1.ore);

    // Copy reflects the NG+ cycle and scaled cost.
    expect(gateChip(s).text).toContain('NG+1');
    expect(gatePanel(s).status).toContain('NG+1');
  });
});

describe('gate copy', () => {
  it('names the next cost in words on the chip and in the panel', () => {
    const s = newGame(1);
    const chip = gateChip(s);
    expect(chip.text).toContain('Gate 0/3');
    expect(chip.text).toContain(formatGateCost(GATE_STAGES[0]!.cost));
    expect(chip.label).toContain('Anchor');
    expect(chip.label).toContain('Horizon Data');
    const panel = gatePanel(s);
    expect(panel.status).toContain('Stage 1 of 3');
    expect(panel.next).toContain('ore');
    expect(panel.summary).toBeNull();
    expect(panel.rule).toBe(NG_PLUS_RULE);
    // Starting wallet cannot cover Anchor, so Deliver stays off until the full stage fits.
    expect(s.run.bank.ore).toBe(40);
    expect(s.run.bank.ice).toBe(10);
    expect(panel.deliverBlocked).not.toBeNull();
    const anchor = GATE_STAGES[0]!.cost;
    s.profile.data = anchor.data;
    s.run.bank = { ore: anchor.ore, ice: anchor.ice, crystal: anchor.crystal, alloy: anchor.alloy, fuel: 0 };
    expect(gatePanel(s).deliverBlocked).toBeNull();
    s.run.bank.ice = Math.max(0, anchor.ice - 1);
    expect(gatePanel(s).deliverBlocked).not.toBeNull();
  });

  it('lists the frozen summary with doctrine side ids', () => {
    const s = newGame(1);
    fill(s);
    s.profile.doctrines.fleet = 'swarm';
    s.profile.warps = 2;
    send(s, { t: 'fundGate' });
    const rows = summaryRows(s.profile.gate.summary!);
    expect(rows.map((r) => r.label)).toEqual([
      'Warps',
      'Career time',
      'Career asteroids broken',
      'Career units mined',
      'Career contracts',
      'Career units refined',
      'Horizon Data earned',
      'Doctrines',
    ]);
    expect(rows.find((r) => r.label === 'Warps')?.value).toBe('2');
    expect(rows.find((r) => r.label === 'Doctrines')?.value).toContain('swarm');
    expect(gateChip(s).text).toBe('Gate open');
    expect(gatePanel(s).summary?.length).toBe(rows.length);
  });
});

describe('gate saves', () => {
  it('rejects a missing gate, a bad stage, and a summary on an unfinished gate', () => {
    const raw = JSON.parse(serialize(newGame(2))) as { profile: { gate?: unknown } };
    delete raw.profile.gate;
    expect(deserialize(JSON.stringify(raw))).toBeNull();

    const stage = JSON.parse(serialize(newGame(2))) as { profile: { gate: { stage: number } } };
    stage.profile.gate.stage = 9;
    expect(deserialize(JSON.stringify(stage))).toBeNull();

    const summary = JSON.parse(serialize(newGame(2))) as { profile: { gate: { summary: object } } };
    summary.profile.gate.summary = { warps: 1 };
    expect(deserialize(JSON.stringify(summary))).toBeNull();
  });

  it('still warps when the bot also delivers', () => {
    const s = newGame(6);
    s.run.bank.fuel = warpCost(s);
    const fuel = s.run.bank.fuel;
    const cmds = botCommands(s);
    expect(cmds[0]).toEqual({ t: 'fundGate', data: false });
    expect(cmds[1]?.t).toBe('warp');
    send(s, cmds[0]!);
    expect(s.run.bank.fuel).toBe(fuel);
    send(s, cmds[1]!);
    expect(s.profile.warps).toBe(1);
  });
});
