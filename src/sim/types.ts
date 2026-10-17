// Game state shapes. GameState is plain JSON-serialisable data (no classes,
// no Maps) so saving is just JSON.stringify. Transient per-frame output for
// the renderer/UI (fx, log) lives in `out` and is not persisted.

import type { Rng } from '../core/rng';
import type { Vec2 } from '../core/vec';
import type { ComponentId, Tier } from '../data/components';
import type { ContractKind } from '../data/contracts';
import type { HullId } from '../data/hulls';
import type { PerkId } from '../data/perks';
import type { Cost, Resource, Wallet } from '../data/resources';

export type RockSize = 0 | 1 | 2; // large, medium, small

export interface Rock {
  id: number;
  kind: Resource;
  size: RockSize;
  pos: Vec2;
  vel: Vec2;
  radius: number;
  hp: number;
  maxHp: number;
  /** Resource units contained; conserved across cracking. */
  units: number;
  belt: number;
}

export interface Pickup {
  id: number;
  kind: Resource;
  amount: number;
  pos: Vec2;
  vel: Vec2;
  age: number;
}

export interface Fitted {
  type: ComponentId;
  tier: Tier;
}

export type Order = { kind: 'move'; to: Vec2 } | { kind: 'mine'; rockId: number } | { kind: 'dock' };

/** Drone behaviour when it has no manual order. */
export type AiMode = 'assist' | 'auto';

export interface Ship {
  id: number;
  name: string;
  hullId: HullId;
  pos: Vec2;
  vel: Vec2;
  angle: number;
  hull: number;
  shield: number;
  slots: (Fitted | null)[];
  cargo: Wallet;
  order: Order | null;
  aiMode: AiMode;
  /** True while a mining beam is hitting its target this tick. */
  beamOn: boolean;
  beamTargetId: number | null;
  /** Rock a drone's AI has chosen to work (separate from manual orders). */
  aiTargetId: number | null;
  thrusting: boolean;
  collisionCd: number;
  /** Flagship only: seconds until respawn at the station; 0 = alive. */
  respawn: number;
}

export interface Moon {
  orbitR: number;
  radius: number;
  angle: number;
  speed: number;
  color: number;
}

export interface Planet {
  name: string;
  orbitR: number;
  radius: number;
  angle: number;
  speed: number;
  color: number;
  ringed: boolean;
  moons: Moon[];
}

export interface Belt {
  inner: number;
  outer: number;
  /** Probability weights per resource kind. */
  mix: Wallet;
  initialCount: number;
}

export type StarClass = 'M' | 'G' | 'B';

export interface StarSystem {
  name: string;
  number: number;
  starClass: StarClass;
  starRadius: number;
  starColor: number;
  heatRadius: number;
  planets: Planet[];
  belts: Belt[];
  station: { pos: Vec2; angle: number };
  richness: number;
}

export interface Contract {
  /** Board-local id (board.nextId), not run.nextId. */
  id: number;
  kind: ContractKind;
  target: number;
  progress: number;
  /** Seconds to complete once accepted. */
  timeLimit: number;
  /** Offer: seconds left on the board. Active: seconds left to complete. */
  timeLeft: number;
  reward: Cost;
  data: number;
}

export interface ContractBoard {
  /** Dedicated stream: contract rolls never touch run.rng. */
  rng: Rng;
  nextId: number;
  offers: Contract[];
  active: Contract | null;
  completed: number;
  failed: number;
  /** walletValue of all resource rewards paid this run (balance metric). */
  rewardValue: number;
}

export interface Run {
  system: StarSystem;
  rng: Rng;
  nextId: number;
  time: number;
  bank: Wallet;
  /** Prestige value deposited this run (drives Horizon Data on warp). */
  runValue: number;
  ships: Ship[];
  rocks: Rock[];
  pickups: Pickup[];
  selectedId: number;
  regrowTimer: number;
}

export interface Profile {
  seed: number;
  warps: number;
  data: number;
  dataEarned: number;
  perks: Record<PerkId, number>;
}

export type Fx =
  | { t: 'crack'; pos: Vec2; kind: Resource; radius: number }
  | { t: 'collect'; pos: Vec2; kind: Resource; amount: number; shipId: number }
  | { t: 'dock'; pos: Vec2; shipId: number; value: number }
  | { t: 'impact'; pos: Vec2 }
  | { t: 'explode'; pos: Vec2 }
  | { t: 'warp' };

export interface LogEntry {
  /** info: routine · warn: rejected command / danger · major: milestones and losses */
  level: 'info' | 'warn' | 'major';
  text: string;
}

export interface Outbox {
  fx: Fx[];
  log: LogEntry[];
}

export interface GameState {
  version: number;
  profile: Profile;
  run: Run;
  out: Outbox;
}
