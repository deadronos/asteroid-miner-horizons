// Resource kinds and wallet helpers. Ore and ice exist from the start;
// crystal only appears in systems reached by warping and gates tier-3 parts.
// Alloy and fuel are refined goods: station-side only, never mined or carried.

export type RawResource = 'ore' | 'ice' | 'crystal';
export type RefinedResource = 'alloy' | 'fuel';
export type Resource = RawResource | RefinedResource;

export const RAW_RESOURCES: readonly RawResource[] = ['ore', 'ice', 'crystal'];
export const REFINED_RESOURCES: readonly RefinedResource[] = ['alloy', 'fuel'];
export const RESOURCES: readonly Resource[] = [...RAW_RESOURCES, ...REFINED_RESOURCES];

export type Wallet = Record<Resource, number>;
export type Cost = Partial<Wallet>;

export const RESOURCE_INFO: Record<
  Resource,
  { name: string; icon: string; color: number; css: string; value: number }
> = {
  ore: { name: 'Ore', icon: '⬢', color: 0xffa040, css: '#ffa040', value: 1 },
  ice: { name: 'Ice', icon: '❄', color: 0x6fe6ff, css: '#6fe6ff', value: 1.5 },
  crystal: { name: 'Crystal', icon: '◆', color: 0xd27bff, css: '#d27bff', value: 8 },
  alloy: { name: 'Alloy', icon: '▣', color: 0xc9d3e0, css: '#c9d3e0', value: 4 },
  fuel: { name: 'Fuel', icon: '◉', color: 0xff7a4d, css: '#ff7a4d', value: 7.5 },
};

export const emptyWallet = (): Wallet => ({ ore: 0, ice: 0, crystal: 0, alloy: 0, fuel: 0 });

export const walletTotal = (w: Wallet): number => RESOURCES.reduce((s, r) => s + w[r], 0);

/** Prestige-relevant value of a bundle of resources. */
export const walletValue = (w: Cost): number => RESOURCES.reduce((s, r) => s + (w[r] ?? 0) * RESOURCE_INFO[r].value, 0);

export function canAfford(w: Wallet, cost: Cost): boolean {
  return RESOURCES.every((r) => w[r] + 1e-9 >= (cost[r] ?? 0));
}

export function pay(w: Wallet, cost: Cost): boolean {
  if (!canAfford(w, cost)) return false;
  for (const r of RESOURCES) w[r] -= cost[r] ?? 0;
  return true;
}

/** Adds every entry of `cost` to `wallet` in `RESOURCES` order. The counterpart of `pay`. */
export function credit(w: Wallet, cost: Cost): void {
  for (const r of RESOURCES) w[r] += cost[r] ?? 0;
}

export function formatCost(cost: Cost): string {
  const parts = RESOURCES.filter((r) => (cost[r] ?? 0) > 0).map(
    (r) => `${Math.ceil(cost[r]!)}${RESOURCE_INFO[r].icon}`,
  );
  return parts.length ? parts.join(' ') : 'free';
}

export interface WalletFormat {
  /** Minimum amount to include (>= min), then rounded down. Default 0.5. */
  min?: number;
  /** Separator between entries. Default ' '. */
  sep?: string;
  /** Put the icon before the amount (`⬢ 3`) instead of after (`3⬢`). */
  iconFirst?: boolean;
  /** Text when nothing meets `min`. Default ''. */
  empty?: string;
}

/** Icon summary of `w`, each amount rounded down, in RESOURCES order. */
export function formatWallet(w: Cost, opts: WalletFormat = {}): string {
  const { min = 0.5, sep = ' ', iconFirst = false, empty = '' } = opts;
  const parts = RESOURCES.filter((r) => (w[r] ?? 0) >= min).map((r) => {
    const n = Math.floor(w[r] ?? 0);
    return iconFirst ? `${RESOURCE_INFO[r].icon} ${n}` : `${n}${RESOURCE_INFO[r].icon}`;
  });
  return parts.length ? parts.join(sep) : empty;
}
