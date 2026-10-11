import { catalogue } from "../../src/data/catalogue";
import {
  defaultPreferences,
  type KitchenData,
  type Recipe,
  type RecipeState,
} from "../../src/lib/schema";

// Fixed clock so "cooked recently" windows are reproducible: 2026-10-11 12:00 Sydney time.
export const NOW = Date.parse("2026-10-11T02:00:00Z");
export const TODAY = "2026-10-11";

export const real = catalogue;
export const byId = (id: string): Recipe => {
  const recipe = catalogue.find((item) => item.id === id);
  if (!recipe) throw new Error(`Missing catalogue recipe ${id}`);
  return recipe;
};

export function emptyData(overrides: Partial<KitchenData> = {}): KitchenData {
  return {
    recipeStates: [],
    sessions: [],
    plans: [],
    pantry: [],
    shopping: [],
    customRecipes: [],
    overrides: [],
    preferences: structuredClone(defaultPreferences),
    activeCooking: undefined,
    ...overrides,
  };
}

export const stateFor = (
  id: string,
  partial: Partial<RecipeState> = {},
): RecipeState => ({
  id,
  updatedAt: 0,
  favourite: false,
  tried: false,
  triedAt: null,
  rating: null,
  notes: "",
  viewedAt: null,
  ...partial,
});

// Deterministic jitter for surprise mode: the first call returns 0, later calls return 0.5.
export const fixedRandom = (value: number) => () => value;
