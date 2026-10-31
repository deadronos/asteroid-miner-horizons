// Game state shapes. GameState is plain JSON-serialisable data (no classes,
// no Maps) so saving is just JSON.stringify. Transient per-frame output for
// the renderer/UI (fx, log) lives in `out` and is not persisted.

import type { Rng } from '../core/rng';
import type { Vec2 } from '../core/vec';
import type { AchievementId, LifetimeStats } from '../data/achievements';
import type { ComponentId, Tier, VariantId } from '../data/components';
import type { ContractKind } from '../data/contracts';
import type { HullId } from '../data/hulls';
import type { ModifierId } from '../data/modifiers';
import type { DoctrineChoice } from '../data/doctrines';
import type { GateProject } from '../data/gate';
import type { PerkId } from '../data/perks';
import type { RecipeId } from '../data/refining';
import type { Cost, RawResource, Wallet } from '../data/resources';
import type { RockTrait } from '../data/traits';
import type { ShipStatus } from './status';

export type RockSize = 0 | 1 | 2; // large, medium, small

export interface Rock {
  id: number;
  kind: RawResource;
  size: RockSize;
  pos: Vec2;
  vel: Vec2;
  radius: number;
  hp: number;
  maxHp: number;
  /** Resource units contained; conserved across cracking. */
  units: number;
  belt: number;
  /** One seeded behaviour trait; absent on plain rocks, fragments and comets. */
  trait?: RockTrait;
  /** Set on a live comet, which flies straight instead of settling into orbit. Absent on every other rock. */
  comet?: true;
}

export interface Pickup {
  id: number;
  kind: RawResource;
  amount: number;
  pos: Vec2;
  vel: Vec2;
  age: number;
}

export interface Fitted {
  type: ComponentId;
  variant: VariantId;
  tier: Tier;
}

export type Order =
  | { kind: 'move'; to: Vec2 }
  | { kind: 'mine'; rockId: number }
  | { kind: 'dock' }
  | { kind: 'build'; rockId: number };

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
  /** Drones and haulers: fly home to repair below the player's hull threshold (#140). */
  autoRepair: boolean;
  /** Drones and haulers: spend spare bank on slots and tiers while docked (#140). */
  autoUpgrade: boolean;
  /** A construction drone picks its own rocks to build outposts on (true for new ones, false for every other ship). */
  autoBuild: boolean;
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
  mix: Record<RawResource, number>;
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
  /** Seeded per system; empty in systems 1–2 and in systems loaded from a pre-v5 save. */
  modifiers: ModifierId[];
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

export interface RefineJob {
  /** Stable per-run id, so a cancel names the job rather than its queue position. */
  id: number;
  recipe: RecipeId;
  /** Batches still to finish, including the one in progress. */
  count: number;
  /** Original batch count, for the log and the UI's done/total label. */
  total: number;
  /** Seconds into the current batch. */
  progress: number;
}

export interface Refinery {
  queue: RefineJob[];
  /** Id for the next queued job. */
  nextId: number;
  /** Units produced this run per recipe (balance metric). */
  produced: Record<RecipeId, number>;
}

/** A mining outpost on a large belt rock: it taps a deep reserve slowly and holds the output for a hauler. */
export interface Outpost {
  /** Host rock; one outpost per rock. The rock itself is never drained, and drones leave it alone. */
  rockId: number;
  kind: RawResource;
  /** Host rock position, refreshed every tick. */
  pos: Vec2;
  /** Units waiting for pickup. */
  stored: Wallet;
  /** Reserve units left to extract; the outpost is dismantled once this and `stored` are empty. */
  reserve: number;
}

export interface Automation {
  outposts: Outpost[];
  /** Units outposts extracted this run (balance metric). */
  extracted: number;
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
  contracts: ContractBoard;
  refinery: Refinery;
  hazards: Hazards;
  automation: Automation;
}

export interface CometWarning {
  /** Where the comet will appear (on the `cometEdge` circle). */
  from: Vec2;
  /** Velocity it will have; the renderer draws the predicted path from `from` along this. */
  vel: Vec2;
  /** Belt index it is aimed through. */
  belt: number;
  /** Seconds until it appears. */
  timeLeft: number;
}

export interface Flare {
  phase: 'warning' | 'active';
  /** Seconds left in the current phase. */
  timeLeft: number;
}

export interface Hazards {
  /** Dedicated stream: hazard rolls never touch run.rng. */
  rng: Rng;
  /** Seconds until the next comet warning. */
  cometTimer: number;
  comet: CometWarning | null;
  /** Seconds until the next flare warning; unused in G systems. */
  flareTimer: number;
  flare: Flare | null;
  /** Comets and flares this run (balance metrics, HUD). */
  comets: number;
  flares: number;
}

export interface Profile {
  seed: number;
  warps: number;
  data: number;
  dataEarned: number;
  perks: Record<PerkId, number>;
  /**
   * The chosen side of each doctrine pair, or null. Survives warps. One slot per pair:
   * the other side is excluded until the next warp's respec window.
   */
  doctrines: DoctrineChoice;
  /** Lifetime counters for this save; they survive warps. */
  stats: LifetimeStats;
  /** Unlocked achievements, in unlock order. */
  achievements: AchievementId[];
  /** The player closed the first-steps checklist (#171); it stays hidden for this save. */
  goalsDismissed: boolean;
  /** Horizon Gate progress. Survives warps; New Game+ clears it. */
  gate: GateProject;
}

export type Fx =
  | { t: 'crack'; pos: Vec2; kind: RawResource; radius: number }
  | { t: 'collect'; pos: Vec2; kind: RawResource; amount: number; shipId: number }
  | { t: 'dock'; pos: Vec2; shipId: number; value: number }
  | { t: 'impact'; pos: Vec2 }
  | { t: 'explode'; pos: Vec2 }
  | { t: 'warp' }
  | { t: 'hazard'; kind: 'comet' | 'flare'; phase: 'warn' | 'start'; pos?: Vec2 };

/** Explicit event identities the audio layer keys on (details stay in `text`). */
export type LogEvent = 'research' | 'contractDone' | 'contractFail' | 'outpost' | 'shipLoss';

export interface LogEntry {
  /** info: routine · warn: rejected command / danger · major: milestones and losses */
  level: 'info' | 'warn' | 'major';
  text: string;
  /** Set on an achievement unlock, which the HUD also shows as a toast. */
  achievement?: AchievementId;
  /** Explicit event the audio layer cues (see src/audio/sfx.ts). */
  event?: LogEvent;
  /** Any other line the HUD also shows as a toast (the offline-progress summary). */
  toast?: { kicker: string; title: string; detail: string };
}

export interface Outbox {
  fx: Fx[];
  log: LogEntry[];
  /** What each AI ship is doing, written by its brain (see `sim/status`). Transient and never drained per tick. */
  status: Map<number, ShipStatus>;
}

export interface GameState {
  version: number;
  profile: Profile;
  run: Run;
  out: Outbox;
}
