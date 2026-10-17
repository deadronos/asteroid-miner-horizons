// Resource kinds and wallet helpers. Ore and ice exist from the start;
// crystal only appears in systems reached by warping and gates tier-3 parts.

export type Resource = 'ore' | 'ice' | 'crystal';
export const RESOURCES: readonly Resource[] = ['ore', 'ice', 'crystal'];

export type Wallet = Record<Resource, number>;
export type Cost = Partial<Wallet>;

export const RESOURCE_INFO: Record<
  Resource,
  { name: string; icon: string; color: number; css: string; value: number }
> = {
  ore: { name: 'Ore', icon: '⬢', color: 0xffa040, css: '#ffa040', value: 1 },
  ice: { name: 'Ice', icon: '❄', color: 0x6fe6ff, css: '#6fe6ff', value: 1.5 },
  crystal: { name: 'Crystal', icon: '◆', color: 0xd27bff, css: '#d27bff', value: 8 },
};

export const emptyWallet = (): Wallet => ({ ore: 0, ice: 0, crystal: 0 });

export const walletTotal = (w: Wallet): number => w.ore + w.ice + w.crystal;

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

export function formatCost(cost: Cost): string {
  const parts = RESOURCES.filter((r) => (cost[r] ?? 0) > 0).map(
    (r) => `${Math.ceil(cost[r]!)}${RESOURCE_INFO[r].icon}`,
  );
  return parts.length ? parts.join(' ') : 'free';
}
