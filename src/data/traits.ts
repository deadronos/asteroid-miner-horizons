// Rock behaviour traits. A belt rock may roll one trait at spawn; the trait
// gates or sweetens mining it. Leaf module: it imports nothing.

export type RockTrait = 'volatile' | 'dense' | 'magnetic';

export interface TraitDef {
  id: RockTrait;
  name: string;
  icon: string;
  blurb: string;
  color: number;
}

export const TRAITS: Record<RockTrait, TraitDef> = {
  volatile: { id: 'volatile', name: 'Volatile', icon: '☢', blurb: 'explodes when cut', color: 0xff6a3a },
  dense: { id: 'dense', name: 'Dense', icon: '⛏', blurb: 'needs a T2 laser', color: 0x8fa6b8 },
  magnetic: { id: 'magnetic', name: 'Magnetic', icon: '⌖', blurb: 'drifts toward ships', color: 0x5ad1ff },
};

export const TRAIT_IDS: readonly RockTrait[] = Object.keys(TRAITS) as RockTrait[];
