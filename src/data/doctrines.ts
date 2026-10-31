// Exclusive doctrine pairs. Each pair stores one side (or none); the other side
// is locked out until the next warp's respec window. Ids are stable: a later
// New Game+ can keep a chosen subset of these keys. Numbers live here so the
// sim, the HUD and the log describe the same trade-off.

export const DOCTRINE_PAIR_IDS = ['fleet', 'haul', 'focus'] as const;
export type DoctrinePairId = (typeof DOCTRINE_PAIR_IDS)[number];

export const DOCTRINE_SIDE_IDS = ['swarm', 'ace', 'freighter', 'courier', 'survey', 'brawler'] as const;
export type DoctrineSideId = (typeof DOCTRINE_SIDE_IDS)[number];

/** One side of a pair, or null when the pair is unset. */
export type DoctrineChoice = Record<DoctrinePairId, DoctrineSideId | null>;

export type DoctrineWho = 'all' | 'flagship' | 'drone';
export type DoctrineStat = 'dps' | 'speed' | 'cargo' | 'magnet' | 'fleet';

export interface DoctrineEffect {
  who: DoctrineWho;
  stat: DoctrineStat;
  /** Multiplier on a ship stat. Ignored when `stat` is `fleet`. */
  mul: number;
  /** Added to fleet capacity. Ignored unless `stat` is `fleet`. */
  add: number;
  /** True when this line is the bonus; false when it is the cost. */
  bonus: boolean;
}

export interface DoctrineSide {
  id: DoctrineSideId;
  pair: DoctrinePairId;
  name: string;
  effects: readonly DoctrineEffect[];
}

export interface DoctrinePair {
  id: DoctrinePairId;
  name: string;
  sides: readonly [DoctrineSide, DoctrineSide];
}

const fleet = (add: number, bonus: boolean): DoctrineEffect => ({
  who: 'all',
  stat: 'fleet',
  mul: 1,
  add,
  bonus,
});
const mul = (who: DoctrineWho, stat: DoctrineStat, factor: number, bonus: boolean): DoctrineEffect => ({
  who,
  stat,
  mul: factor,
  add: 0,
  bonus,
});

const swarm: DoctrineSide = {
  id: 'swarm',
  pair: 'fleet',
  name: 'Swarm Doctrine',
  effects: [fleet(1, true), mul('drone', 'dps', 0.9, false)],
};
const ace: DoctrineSide = {
  id: 'ace',
  pair: 'fleet',
  name: 'Ace Pilot',
  effects: [mul('flagship', 'dps', 1.25, true), mul('flagship', 'speed', 0.92, false)],
};
const freighter: DoctrineSide = {
  id: 'freighter',
  pair: 'haul',
  name: 'Bulk Freighter',
  effects: [mul('all', 'cargo', 1.25, true), mul('all', 'speed', 0.9, false)],
};
const courier: DoctrineSide = {
  id: 'courier',
  pair: 'haul',
  name: 'Courier',
  effects: [mul('all', 'speed', 1.12, true), mul('all', 'cargo', 0.85, false)],
};
const survey: DoctrineSide = {
  id: 'survey',
  pair: 'focus',
  name: 'Survey Array',
  effects: [mul('all', 'magnet', 1.25, true), mul('all', 'dps', 0.9, false)],
};
const brawler: DoctrineSide = {
  id: 'brawler',
  pair: 'focus',
  name: 'Brawler',
  effects: [mul('all', 'dps', 1.15, true), mul('all', 'magnet', 0.8, false)],
};

export const DOCTRINE_PAIRS: Record<DoctrinePairId, DoctrinePair> = {
  fleet: { id: 'fleet', name: 'Fleet', sides: [swarm, ace] },
  haul: { id: 'haul', name: 'Hold', sides: [freighter, courier] },
  focus: { id: 'focus', name: 'Beam', sides: [survey, brawler] },
};

export const DOCTRINE_SIDES: Record<DoctrineSideId, DoctrineSide> = {
  swarm,
  ace,
  freighter,
  courier,
  survey,
  brawler,
};

/** A profile with no doctrine chosen. */
export function emptyDoctrines(): DoctrineChoice {
  return { fleet: null, haul: null, focus: null };
}

/** True when `side` is one of `pair`'s two sides. */
export function isDoctrineSide(pair: DoctrinePairId, side: unknown): side is DoctrineSideId {
  return typeof side === 'string' && DOCTRINE_PAIRS[pair].sides.some((s) => s.id === side);
}

const STAT_NAME: Record<DoctrineStat, string> = {
  dps: 'damage',
  speed: 'speed',
  cargo: 'cargo',
  magnet: 'pickup radius',
  fleet: 'fleet capacity',
};

/** One effect as text, including its sign. A speed effect also scales acceleration. */
export function effectText(e: DoctrineEffect): string {
  if (e.stat === 'fleet') {
    const n = Math.abs(e.add);
    return `${e.add >= 0 ? '+' : '\u2212'}${n} fleet capacity`;
  }
  const pct = Math.round(Math.abs(e.mul - 1) * 100);
  const sign = e.mul >= 1 ? '+' : '\u2212';
  const stat = e.stat === 'dps' && e.who === 'all' ? 'laser damage' : STAT_NAME[e.stat];
  const who = e.who === 'all' ? '' : `${e.who} `;
  return `${sign}${pct}% ${who}${stat}`;
}

const joinKind = (side: DoctrineSide, bonus: boolean): string =>
  side.effects
    .filter((e) => e.bonus === bonus)
    .map(effectText)
    .join(', ');

/** The bonus half of a side, without a label. */
export const sideBonus = (side: DoctrineSide): string => joinKind(side, true);

/** The cost half of a side, without a label. */
export const sideCost = (side: DoctrineSide): string => joinKind(side, false);

/** Both halves, labelled, so a trade-off is readable without colour. */
export const sideTrade = (side: DoctrineSide): string => `Bonus: ${sideBonus(side)}. Cost: ${sideCost(side)}.`;
