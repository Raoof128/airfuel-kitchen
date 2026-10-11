import {
  recipeSchema,
  type CookingSession,
  type Ingredient,
  type KitchenData,
  type PantryItem,
  type PlanEntry,
  type Recipe,
  type RecipeState,
  type ShoppingItem,
} from "./schema";

const normalise = (value: string) =>
  value.toLowerCase().trim().replace(/\s+/g, " ");
const searchable = (recipe: Recipe) =>
  normalise(
    [
      recipe.title,
      recipe.description,
      ...recipe.tags,
      ...recipe.ingredients.map((i) => i.name),
    ].join(" "),
  );
const contains = (haystack: string, needle: string) =>
  haystack.includes(normalise(needle));
// Words, not substrings: "oil" must not match "boiled" and "egg" must not match "veggie".
const words = (text: string) => text.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
export function effectiveRecipes(
  catalogue: readonly Recipe[],
  data: KitchenData,
): Recipe[] {
  const recipes = new Map(catalogue.map((recipe) => [recipe.id, recipe]));
  for (const custom of data.customRecipes)
    recipes.set(custom.id, custom.recipe);
  for (const override of data.overrides)
    if (recipes.has(override.id)) {
      const parsed = recipeSchema.safeParse(override.recipe);
      if (parsed.success) {
        const baseline = recipes.get(override.id)!;
        recipes.set(override.id, {
          ...parsed.data,
          // An untrusted backup override must never weaken the canonical safety constraints.
          allergens: [
            ...new Set([...baseline.allergens, ...parsed.data.allergens]),
          ],
          dietary: parsed.data.dietary.filter((claim) =>
            baseline.dietary.includes(claim),
          ),
          oilFree: baseline.oilFree && parsed.data.oilFree,
          internalTempC:
            baseline.internalTempC === null
              ? parsed.data.internalTempC
              : Math.max(
                  baseline.internalTempC,
                  parsed.data.internalTempC ?? 0,
                ),
          safety: [...new Set([...baseline.safety, ...parsed.data.safety])],
        });
      }
    }
  return [...recipes.values()];
}
export interface RecipeFilters {
  query?: string;
  category?: string;
  minProtein?: number;
  maxCalories?: number;
  maxMinutes?: number;
  dietary?: string[];
  excludeAllergens?: string[];
  difficulty?: string;
  oilFree?: boolean;
  status?: "all" | "tried" | "untried" | "favourites";
  sort?: "relevance" | "time" | "protein" | "rating";
}
export function filterRecipes(
  recipes: readonly Recipe[],
  filters: RecipeFilters = {},
  states: readonly RecipeState[] = [],
): Recipe[] {
  const byId = new Map(states.map((state) => [state.id, state]));
  let query = normalise(filters.query ?? "");
  const time = query.match(/(?:under|less than)\s+(\d+)\s*(?:minutes?|mins?)/);
  const protein = query.match(
    /(?:more than|over|at least)\s+(\d+)\s*g?\s*protein/,
  );
  const oilFree =
    filters.oilFree || /\b(?:no oil|oil free|oil-free)\b/.test(query);
  query = query
    .replace(/(?:under|less than)\s+\d+\s*(?:minutes?|mins?)/g, "")
    .replace(/(?:more than|over|at least)\s+\d+\s*g?\s*protein/g, "")
    .replace(/\b(?:no oil|oil free|oil-free)\b/g, "")
    .trim();
  const tokens = words(query).map((token) =>
    token === "eggs" ? "egg" : token,
  );
  const result = recipes.filter((recipe) => {
    const state = byId.get(recipe.id);
    // Custom declarations have not been independently checked; fail closed for food restrictions.
    return (
      !(
        (filters.excludeAllergens?.length || filters.dietary?.length) &&
        recipe.id.startsWith("custom-")
      ) &&
      (!filters.category || recipe.category === filters.category) &&
      (filters.minProtein === undefined ||
        recipe.nutrition.protein >= filters.minProtein) &&
      (!protein ||
        (protein[0].startsWith("at least")
          ? recipe.nutrition.protein >= Number(protein[1])
          : recipe.nutrition.protein > Number(protein[1]))) &&
      (filters.maxCalories === undefined ||
        recipe.nutrition.calories <= filters.maxCalories) &&
      (filters.maxMinutes === undefined ||
        recipe.totalMinutes <= filters.maxMinutes) &&
      (!time || recipe.totalMinutes < Number(time[1])) &&
      (!oilFree || recipe.oilFree) &&
      (!filters.difficulty || recipe.difficulty === filters.difficulty) &&
      (filters.dietary ?? []).every((value) =>
        recipe.dietary.includes(value as Recipe["dietary"][number]),
      ) &&
      !(filters.excludeAllergens ?? []).some((value) =>
        recipe.allergens.includes(value as Recipe["allergens"][number]),
      ) &&
      (filters.status !== "tried" || state?.tried) &&
      (filters.status !== "untried" || !state?.tried) &&
      (filters.status !== "favourites" || state?.favourite) &&
      tokens.every((token) =>
        words(searchable(recipe)).some((word) => word.startsWith(token)),
      )
    );
  });
  return result.sort((a, b) => {
    if (filters.sort === "time") return a.totalMinutes - b.totalMinutes;
    if (filters.sort === "protein")
      return b.nutrition.protein - a.nutrition.protein;
    if (filters.sort === "rating")
      return (byId.get(b.id)?.rating ?? 0) - (byId.get(a.id)?.rating ?? 0);
    return (
      Number(normalise(b.title).includes(query)) -
      Number(normalise(a.title).includes(query))
    );
  });
}
export type RecommendationMode =
  "tonight" | "new" | "favourites" | "pantry" | "fast" | "surprise";
export interface Recommendation {
  recipe: Recipe;
  score: number;
  reasons: string[];
}
export function recommendRecipes(
  recipes: readonly Recipe[],
  data: KitchenData,
  mode: RecommendationMode = "tonight",
  limit = 6,
): Recommendation[] {
  const prefs = data.preferences;
  const states = new Map(data.recipeStates.map((state) => [state.id, state]));
  const candidates = filterRecipes(
    recipes,
    {
      excludeAllergens: prefs.allergens,
      dietary: prefs.dietary,
      oilFree: prefs.oilFree,
      status:
        mode === "new"
          ? "untried"
          : mode === "favourites"
            ? "favourites"
            : "all",
    },
    data.recipeStates,
  )
    .filter(
      (recipe) =>
        !prefs.avoidIngredients.some((ingredient) =>
          contains(searchable(recipe), ingredient),
        ),
    )
    .filter(
      (recipe) =>
        mode !== "fast" ||
        recipe.totalMinutes <= Math.min(20, prefs.maxMinutes),
    );
  const recentThreshold = Date.now() - 7 * 86400000;
  const recent = new Set(
    data.sessions
      .filter(
        (session) =>
          new Date(`${session.date}T12:00:00Z`).valueOf() >= recentThreshold,
      )
      .map((session) => session.recipeId),
  );
  const likedCategories = new Set(
    recipes
      .filter((recipe) => (states.get(recipe.id)?.rating ?? 0) >= 4)
      .map((recipe) => recipe.category),
  );
  const scored = candidates
    .map((recipe) => {
      const state = states.get(recipe.id);
      const haystack = searchable(recipe);
      const reasons: string[] = [];
      let score = 0;
      if (recipe.totalMinutes <= prefs.maxMinutes) {
        score += 20 + 8 * (1 - recipe.totalMinutes / prefs.maxMinutes);
        reasons.push(`Fits your ${prefs.maxMinutes}-minute cooking preference`);
      } else score -= recipe.totalMinutes - prefs.maxMinutes;
      if (recipe.nutrition.protein >= prefs.minProtein) {
        score += 20;
        reasons.push(
          `${Math.round(recipe.nutrition.protein)}g protein per serving`,
        );
      }
      // Reward meeting the user's target, with no extra reward for inflated portions beyond it.
      if (prefs.minProtein > 0)
        score += 6 * Math.min(1, recipe.nutrition.protein / prefs.minProtein);
      if (!state?.tried) {
        score += 12;
        reasons.push("Something you have not tried");
      }
      if (state?.favourite) {
        score += 16;
        reasons.push("One of your saved favourites");
      }
      if (state?.rating) {
        score += (state.rating - 3) * 8;
        if (state.rating >= 4) reasons.push(`You rated this ${state.rating}/5`);
      }
      if (likedCategories.has(recipe.category) && !state?.tried) {
        score += 10;
        reasons.push("From a category you have rated highly");
      }
      if (prefs.preferredProteins.some((value) => contains(haystack, value))) {
        score += 10;
        reasons.push("Matches your preferred proteins");
      }
      if (
        prefs.favouriteIngredients.some((value) => contains(haystack, value))
      ) {
        score += 8;
        reasons.push("Includes an ingredient you enjoy");
      }
      if (prefs.cuisines.some((value) => contains(haystack, value))) {
        score += 6;
        reasons.push("Matches a favourite cuisine");
      }
      score -=
        prefs.dislikedIngredients.filter((value) => contains(haystack, value))
          .length * 25;
      if (recent.has(recipe.id)) {
        score -= 25;
        reasons.push("Cooked recently");
      }
      const pantryMatches = recipe.ingredients.filter((ingredient) =>
        data.pantry.some(
          (item) =>
            item.quantity > 0 &&
            ingredientKey(ingredient) === ingredientKey(item),
        ),
      ).length;
      if (pantryMatches) {
        score +=
          (pantryMatches / recipe.ingredients.length) *
          (mode === "pantry" ? 90 : 20);
        reasons.push(
          `${pantryMatches} of ${recipe.ingredients.length} ingredients in your pantry`,
        );
      }
      if (mode === "surprise") score += Math.random() * 50;
      return { recipe, score, reasons: reasons.slice(0, 4) };
    })
    .filter(
      (item) =>
        mode !== "pantry" ||
        item.recipe.ingredients.some((ingredient) =>
          data.pantry.some(
            (p) =>
              p.quantity > 0 && ingredientKey(ingredient) === ingredientKey(p),
          ),
        ),
    )
    .sort(
      (a, b) => b.score - a.score || a.recipe.id.localeCompare(b.recipe.id),
    );
  const chosen: Recommendation[] = [];
  const categoryCounts = new Map<Recipe["category"], number>();
  while (scored.length && chosen.length < Math.max(0, limit)) {
    const varietyScore = (item: Recommendation) =>
      item.score - 10 * (categoryCounts.get(item.recipe.category) ?? 0);
    scored.sort(
      (a, b) =>
        varietyScore(b) - varietyScore(a) ||
        a.recipe.id.localeCompare(b.recipe.id),
    );
    const next = scored.shift()!;
    chosen.push({ ...next, score: varietyScore(next) });
    categoryCounts.set(
      next.recipe.category,
      (categoryCounts.get(next.recipe.category) ?? 0) + 1,
    );
  }
  return chosen;
}
export function scaleIngredients(
  recipe: Recipe,
  servings: number,
): Ingredient[] {
  if (!Number.isFinite(servings) || servings < 0.01 || servings > 100)
    throw new Error("Servings must be between 0.01 and 100.");
  if (
    !Number.isFinite(recipe.servings) ||
    recipe.servings < 0.01 ||
    recipe.servings > 100
  )
    throw new Error("The recipe has an invalid serving count.");
  return recipe.ingredients.map((ingredient) => ({
    ...ingredient,
    quantity: (ingredient.quantity * servings) / recipe.servings,
  }));
}
export interface NutritionTotals {
  protein: number;
  calories: number;
  carbs: number;
  fat: number;
  missingRecipes: number;
}
function sumNutrition(
  entries: { recipeId: string; servings: number }[],
  recipes: readonly Recipe[],
): NutritionTotals {
  const byId = new Map(recipes.map((recipe) => [recipe.id, recipe]));
  return entries.reduce(
    (total, entry) => {
      const recipe = byId.get(entry.recipeId);
      if (!recipe) {
        total.missingRecipes++;
        return total;
      }
      for (const key of ["protein", "calories", "carbs", "fat"] as const)
        total[key] += recipe.nutrition[key] * entry.servings;
      return total;
    },
    { protein: 0, calories: 0, carbs: 0, fat: 0, missingRecipes: 0 },
  );
}
export function plannedNutrition(
  plans: readonly PlanEntry[],
  recipes: readonly Recipe[],
) {
  return sumNutrition(
    plans.map((plan) => ({ recipeId: plan.recipeId, servings: plan.servings })),
    recipes,
  );
}
export function consumedNutrition(
  sessions: readonly CookingSession[],
  recipes: readonly Recipe[],
) {
  return sumNutrition(
    sessions
      .filter((session) => session.servingsConsumed > 0)
      .map((session) => ({
        recipeId: session.recipeId,
        servings: session.servingsConsumed,
      })),
    recipes,
  );
}
type Measured = Pick<Ingredient, "name" | "unit" | "form" | "quantity">;
function baseUnit(item: Measured): {
  unit: Ingredient["unit"];
  quantity: number;
} {
  return item.unit === "tsp"
    ? { unit: "ml", quantity: item.quantity * 5 }
    : item.unit === "tbsp"
      ? { unit: "ml", quantity: item.quantity * 20 }
      : { unit: item.unit, quantity: item.quantity };
}
export function ingredientKey(item: Measured) {
  return JSON.stringify([
    normalise(item.name),
    normalise(item.form),
    baseUnit(item).unit,
  ]);
}
export function buildShoppingList(
  plans: readonly PlanEntry[],
  recipes: readonly Recipe[],
  pantry: readonly PantryItem[] = [],
  saved: readonly ShoppingItem[] = [],
): ShoppingItem[] {
  const byId = new Map(recipes.map((recipe) => [recipe.id, recipe]));
  const rows = new Map<string, ShoppingItem>();
  for (const plan of plans) {
    const recipe = byId.get(plan.recipeId);
    if (!recipe) continue;
    for (const ingredient of scaleIngredients(recipe, plan.servings)) {
      const key = ingredientKey(ingredient);
      const base = baseUnit(ingredient);
      const existing = rows.get(key);
      if (existing) existing.quantity += base.quantity;
      else
        rows.set(key, {
          id: `generated:${key}`,
          updatedAt: 0,
          name: ingredient.name,
          quantity: base.quantity,
          unit: base.unit,
          form: ingredient.form,
          aisle: ingredient.aisle,
          checked: false,
          manual: false,
        });
    }
  }
  for (const item of pantry) {
    const row = rows.get(ingredientKey(item));
    if (row) row.quantity = Math.max(0, row.quantity - baseUnit(item).quantity);
  }
  const savedById = new Map(saved.map((item) => [item.id, item]));
  const generated = [...rows.values()]
    .filter((row) => row.quantity > 1e-8)
    .map((row) => {
      const quantity = Math.round(row.quantity * 1000) / 1000;
      const savedRow = savedById.get(row.id);
      // A purchase tick applies to its measured quantity, not every future plan with the same ingredient.
      const sameQuantity =
        savedRow && Math.abs(savedRow.quantity - quantity) < 0.0005;
      return {
        ...row,
        quantity,
        checked: sameQuantity ? savedRow.checked : false,
      };
    });
  return [...generated, ...saved.filter((item) => item.manual)].sort(
    (a, b) => a.aisle.localeCompare(b.aisle) || a.name.localeCompare(b.name),
  );
}
// Aggregation keeps everything in ml, so the origin unit is not recoverable here. These
// rules only change display: under 15 ml reads as teaspoons, 15 to 60 ml as tablespoons
// rounded up to the next half, 60 ml and up as ml (litres from 1000 ml). Mass from 1000 g
// reads as kg. Rounding up means a shopping amount is never shown below what it needs.
const spoonSteps: [number, string][] = [
  [0, ""],
  [1 / 4, "¼"],
  [1 / 3, "⅓"],
  [1 / 2, "½"],
  [2 / 3, "⅔"],
  [3 / 4, "¾"],
  [1, ""],
];
const numberFormat = new Intl.NumberFormat("en-AU", {
  maximumFractionDigits: 1,
});
const decimalFormat = new Intl.NumberFormat("en-AU", {
  maximumFractionDigits: 2,
});
function nearestSpoons(value: number): number {
  const whole = Math.floor(value);
  const remainder = value - whole;
  const [step] = spoonSteps.reduce((best, candidate) =>
    Math.abs(candidate[0] - remainder) < Math.abs(best[0] - remainder)
      ? candidate
      : best,
  );
  return whole + step;
}
function spoonText(spoons: number, unit: "tsp" | "tbsp"): string {
  const whole = Math.floor(spoons);
  const glyph = spoonSteps.find(([step]) => Math.abs(spoons - whole - step) < 1e-9)![1];
  return `${whole || glyph ? `${whole || ""}${glyph}` : "0"} ${unit}`;
}
export function formatShoppingAmount(
  quantity: number,
  unit: ShoppingItem["unit"],
): string {
  if (unit === "tsp" || unit === "tbsp")
    return spoonText(nearestSpoons(quantity), unit);
  if (unit === "g" && quantity >= 1000)
    return `${decimalFormat.format(quantity / 1000)} kg`;
  if (unit !== "ml") return `${numberFormat.format(quantity)} ${unit}`;
  if (quantity >= 1000) return `${decimalFormat.format(quantity / 1000)} L`;
  if (quantity >= 60) return `${numberFormat.format(quantity)} ml`;
  if (quantity >= 15) {
    // Round up to the next half tablespoon: 22.5 ml reads 1½ tbsp, 31.67 ml reads 2 tbsp.
    const halves = Math.ceil((quantity / 20) * 2 - 1e-9) / 2;
    return spoonText(halves, "tbsp");
  }
  return spoonText(nearestSpoons(quantity / 5), "tsp");
}
export function localDate(
  date = new Date(),
  timezone = "Australia/Sydney",
): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}
export function weekDates(date = localDate()): string[] {
  const start = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(start.valueOf())) throw new Error("Invalid date");
  start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
  return Array.from({ length: 7 }, (_, index) => {
    const day = new Date(start);
    day.setUTCDate(day.getUTCDate() + index);
    return day.toISOString().slice(0, 10);
  });
}
