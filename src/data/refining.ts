// Refinery recipes. Pure data: each recipe converts bank resources into one
// refined resource at a fixed rate; value in equals value out.

import type { Cost, RefinedResource } from './resources';

export type RecipeId = RefinedResource;

export interface RecipeDef {
  id: RecipeId;
  /** Player-facing label, e.g. `Smelt alloy`. */
  name: string;
  /** Bank resources consumed per batch. */
  input: Cost;
  /** Units of `id` produced per batch. */
  output: number;
  /** Seconds per batch. */
  time: number;
}

export const RECIPES: Record<RecipeId, RecipeDef> = {
  alloy: { id: 'alloy', name: 'Smelt alloy', input: { ore: 4 }, output: 1, time: 2 },
  fuel: { id: 'fuel', name: 'Crack fuel', input: { ice: 5 }, output: 1, time: 1 },
};

export const RECIPE_IDS: readonly RecipeId[] = ['alloy', 'fuel'];
