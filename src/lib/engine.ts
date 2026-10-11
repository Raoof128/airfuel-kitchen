import {
  allergenNames,
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
// Common Cyrillic and Greek letters that look like Latin ones. Matching only, never display.
const confusables: Record<string, string> = {
  а: "a", е: "e", о: "o", р: "p", с: "c", у: "y", х: "x", і: "i", ј: "j", к: "k", м: "m",
  н: "h", т: "t", в: "b", α: "a", ε: "e", ο: "o", ι: "i", κ: "k", ν: "v", ρ: "p", τ: "t",
  χ: "x", υ: "u",
};
const confusable = new RegExp(`[${Object.keys(confusables).join("")}]`, "gu");
// Folds spelling variants for matching: "jalapeño" becomes "jalapeno", zero-width and other
// format characters disappear, and look-alike letters map to Latin. Search text and the avoid
// list fold the same way, so both sides meet.
const fold = (value: string) =>
  normalise(
    value
      .normalize("NFKD")
      .replace(/\p{M}+/gu, "")
      .replace(/\p{Cf}+/gu, "")
      .replace(confusable, (letter) => confusables[letter] ?? letter),
  );
const recipeText = (recipe: Recipe) =>
    [
      recipe.title,
      recipe.description,
      ...recipe.tags,
      ...recipe.ingredients.map((i) => i.name),
    ].join(" ");
const searchable = (recipe: Recipe) => fold(recipeText(recipe));
// Words, not substrings: "oil" must not match "boiled" and "egg" must not match "veggie".
const words = (text: string) => text.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
// Recipes are treated as immutable once loaded, so their folded word lists are computed once.
// Recipe objects are never changed: display keeps the original accented text.
const wordCache = new WeakMap<Recipe, string[]>();
const recipeWords = (recipe: Recipe) => {
  let cached = wordCache.get(recipe);
  if (!cached) {
    cached = words(searchable(recipe));
    wordCache.set(recipe, cached);
  }
  return cached;
};
// Free-text ingredient preferences match the head noun of a word, so "egg" matches "eggs" and
// "peanut butter" but not "eggplant", and "pea" does not match "peanut". Each word of a
// multi-word entry must match a consecutive word in the recipe. An empty entry matches nothing.
const endings = (part: string) => [
  part,
  `${part}s`,
  `${part}es`,
  part.endsWith("y") ? `${part.slice(0, -1)}ies` : part,
];
const wordMatches = (word: string, part: string) =>
  endings(part).some((ending) => word.endsWith(ending));
const mentions = (haystackWords: readonly string[], entry: string) => {
  const needle = words(fold(entry));
  if (!needle.length) return false;
  for (let start = 0; start + needle.length <= haystackWords.length; start++)
    if (needle.every((part, offset) => wordMatches(haystackWords[start + offset], part)))
      return true;
  return false;
};
// A recipe that contains wheat contains gluten, so excluding either excludes both.
const allergenClosure = (allergens: readonly string[]) => {
  const closed = new Set(allergens);
  if (closed.has("gluten")) closed.add("wheat");
  if (closed.has("wheat")) closed.add("gluten");
  return closed;
};
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
        // Changed ingredients void the canonical allergen and diet declarations. Such a recipe
        // fails closed: it is excluded by every allergen filter and every diet filter.
        const ingredientsChanged =
          JSON.stringify(parsed.data.ingredients) !==
          JSON.stringify(baseline.ingredients);
        recipes.set(override.id, {
          ...parsed.data,
          // An untrusted backup override must never weaken the canonical safety constraints.
          allergens: ingredientsChanged
            ? [...allergenNames]
            : [...new Set([...baseline.allergens, ...parsed.data.allergens])],
          dietary: ingredientsChanged
            ? []
            : parsed.data.dietary.filter((claim) =>
                baseline.dietary.includes(claim),
              ),
          oilFree:
            !ingredientsChanged && baseline.oilFree && parsed.data.oilFree,
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
  avoidIngredients?: string[];
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
  let query = fold(filters.query ?? "");
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
  // Duplicate tokens add no information, so a repeated query is checked once per recipe.
  const tokens = [
    ...new Set(
      words(query).map((token) => (token === "eggs" ? "egg" : token)),
    ),
  ];
  const excluded = allergenClosure(filters.excludeAllergens ?? []);
  const avoid = filters.avoidIngredients ?? [];
  const result = recipes.filter((recipe) => {
    const state = byId.get(recipe.id);
    const haystack = recipeWords(recipe);
    // Custom declarations have not been independently checked; fail closed for food restrictions.
    return (
      !(
        (filters.excludeAllergens?.length || filters.dietary?.length) &&
        recipe.id.startsWith("custom-")
      ) &&
      !avoid.some((entry) => mentions(haystack, entry)) &&
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
      !recipe.allergens.some((value) => excluded.has(value)) &&
      (filters.status !== "tried" || state?.tried) &&
      (filters.status !== "untried" || !state?.tried) &&
      (filters.status !== "favourites" || state?.favourite) &&
      tokens.every((token) =>
        haystack.some((word) => word.startsWith(token)),
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
      Number(fold(b.title).includes(query)) -
      Number(fold(a.title).includes(query))
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
export interface RecommendOptions {
  /** Epoch milliseconds for the "cooked recently" window. Defaults to the current time. */
  now?: number;
  /** Source of the surprise-mode jitter, each value in [0, 1). Defaults to Math.random. */
  random?: () => number;
}
// A category earns the "rated highly" bonus only after two recipes in it are rated 4 or more,
// so a single rating cannot lift every untried recipe in that category.
const minimumLikedCategory = 2;
// Recipes cooked recently are pushed down, not removed: a strong penalty within a week, a
// smaller one within four weeks, and a further cost for each cooking in the last ninety days.
const recentWindowMs = 7 * 86400000;
const monthWindowMs = 28 * 86400000;
const quarterWindowMs = 90 * 86400000;
const repeatCost = 10;
const maxRepeatCost = 40;
export function recommendRecipes(
  recipes: readonly Recipe[],
  data: KitchenData,
  mode: RecommendationMode = "tonight",
  limit = 6,
  options: RecommendOptions = {},
): Recommendation[] {
  const prefs = data.preferences;
  const now = options.now ?? Date.now();
  const random = options.random ?? Math.random;
  const states = new Map(data.recipeStates.map((state) => [state.id, state]));
  const pantryKeys = new Set(
    data.pantry
      .filter((item) => item.quantity > 0)
      .map((item) => ingredientKey(item)),
  );
  const inPantry = (ingredient: Ingredient) =>
    pantryKeys.has(ingredientKey(ingredient));
  // Hard constraints first: allergens, diets, avoided ingredients and the time cap are
  // applied before any score is computed, so no bonus can rescue a recipe.
  const candidates = filterRecipes(
    recipes,
    {
      excludeAllergens: prefs.allergens,
      avoidIngredients: prefs.avoidIngredients,
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
  ).filter(
    (recipe) =>
      mode !== "fast" || recipe.totalMinutes <= Math.min(20, prefs.maxMinutes),
  );
  const cookedAgo = new Map<string, number[]>();
  for (const session of data.sessions) {
    const at = new Date(`${session.date}T12:00:00Z`).valueOf();
    if (now - at > quarterWindowMs) continue;
    cookedAgo.set(session.recipeId, [...(cookedAgo.get(session.recipeId) ?? []), now - at]);
  }
  const highlyRatedByCategory = new Map<Recipe["category"], number>();
  for (const recipe of recipes)
    if ((states.get(recipe.id)?.rating ?? 0) >= 4)
      highlyRatedByCategory.set(
        recipe.category,
        (highlyRatedByCategory.get(recipe.category) ?? 0) + 1,
      );
  const likedCategories = new Set(
    [...highlyRatedByCategory]
      .filter(([, count]) => count >= minimumLikedCategory)
      .map(([category]) => category),
  );
  const scored = candidates
    .map((recipe) => {
      const state = states.get(recipe.id);
      const haystack = recipeWords(recipe);
      // Each reason carries the points it added, so the explanation shows the strongest signals.
      const reasons: { text: string; points: number }[] = [];
      let score = 0;
      const reward = (points: number, text: string) => {
        score += points;
        reasons.push({ text, points });
      };
      if (recipe.totalMinutes <= prefs.maxMinutes)
        reward(
          20 + 8 * (1 - recipe.totalMinutes / prefs.maxMinutes),
          `Fits your ${prefs.maxMinutes}-minute cooking preference`,
        );
      else score -= recipe.totalMinutes - prefs.maxMinutes;
      if (recipe.nutrition.protein >= prefs.minProtein)
        reward(
          20,
          `${Math.round(recipe.nutrition.protein)}g protein per serving`,
        );
      // Reward meeting the user's target, with no extra reward for inflated portions beyond it.
      if (prefs.minProtein > 0)
        score += 6 * Math.min(1, recipe.nutrition.protein / prefs.minProtein);
      if (!state?.tried) reward(12, "Something you have not tried");
      if (state?.favourite) reward(16, "One of your saved favourites");
      if (state?.rating) {
        const points = (state.rating - 3) * 8;
        score += points;
        if (state.rating >= 4)
          reasons.push({ text: `You rated this ${state.rating}/5`, points });
      }
      if (likedCategories.has(recipe.category) && !state?.tried)
        reward(10, "From a category you have rated highly");
      if (prefs.preferredProteins.some((value) => mentions(haystack, value)))
        reward(10, "Matches your preferred proteins");
      if (prefs.favouriteIngredients.some((value) => mentions(haystack, value)))
        reward(8, "Includes an ingredient you enjoy");
      if (prefs.cuisines.some((value) => mentions(haystack, value)))
        reward(6, "Matches a favourite cuisine");
      score -=
        prefs.dislikedIngredients.filter((value) => mentions(haystack, value))
          .length * 25;
      // Recency lowers the score; it is not a reason to recommend, so it is not listed.
      const ages = cookedAgo.get(recipe.id) ?? [];
      if (ages.some((age) => age <= recentWindowMs)) score -= 25;
      else if (ages.some((age) => age <= monthWindowMs)) score -= 10;
      score -= Math.min(maxRepeatCost, repeatCost * ages.length);
      const pantryMatches = recipe.ingredients.filter(inPantry).length;
      if (pantryMatches)
        reward(
          (pantryMatches / recipe.ingredients.length) *
            (mode === "pantry" ? 90 : 20),
          `${pantryMatches} of ${recipe.ingredients.length} ingredients in your pantry`,
        );
      if (mode === "surprise") score += random() * 50;
      return {
        recipe,
        score,
        reasons: reasons
          .filter((reason) => reason.points > 0)
          .sort((a, b) => b.points - a.points)
          .slice(0, 4)
          .map((reason) => reason.text),
      };
    })
    .filter(
      (item) =>
        mode !== "pantry" || item.recipe.ingredients.some(inPantry),
    )
    .sort(
      (a, b) => b.score - a.score || a.recipe.id.localeCompare(b.recipe.id),
    );
  // Pick one at a time by diversity-adjusted score: each category already on the list costs 10
  // points. A single linear pass per pick replaces re-sorting the whole pool on every pick.
  const chosen: Recommendation[] = [];
  const categoryCounts = new Map<Recipe["category"], number>();
  const varietyScore = (item: Recommendation) =>
    item.score - 10 * (categoryCounts.get(item.recipe.category) ?? 0);
  const limitTo = Math.max(0, limit);
  while (scored.length && chosen.length < limitTo) {
    let best = 0;
    for (let index = 1; index < scored.length; index++) {
      const challenger = varietyScore(scored[index]);
      const incumbent = varietyScore(scored[best]);
      if (
        challenger > incumbent ||
        (challenger === incumbent &&
          scored[index].recipe.id.localeCompare(scored[best].recipe.id) < 0)
      )
        best = index;
    }
    // The diversity penalty decides order only. The returned score stays the recipe's own
    // score, so it does not change with the other results in the same list.
    const [next] = scored.splice(best, 1);
    chosen.push(next);
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
  // Drop only after rounding, so a need that rounds to zero is not listed as "0 g".
  const generated = [...rows.values()]
    .map((row) => ({ row, quantity: Math.round(row.quantity * 1000) / 1000 }))
    .filter(({ quantity }) => quantity > 0)
    .map(({ row, quantity }) => {
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
// A positive need never reads as zero: anything under a quarter teaspoon shows as one quarter.
function nearestSpoonsForNeed(value: number): number {
  return value > 0 ? Math.max(nearestSpoons(value), spoonSteps[1][0]) : 0;
}
// The shopping formatter shows one decimal, so a tiny positive amount would read as "0".
function atLeastTenth(value: number): number {
  return value > 0 && value < 0.05 ? 0.1 : value;
}
const largeFromTenths = 999.95;
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
    return spoonText(nearestSpoonsForNeed(quantity), unit);
  // The unit switches just below 1000, where one decimal would otherwise print "1,000 g" or "1,000 ml".
  if (unit === "g" && quantity >= largeFromTenths)
    return `${decimalFormat.format(quantity / 1000)} kg`;
  if (unit !== "ml")
    return `${numberFormat.format(atLeastTenth(quantity))} ${unit}`;
  if (quantity >= largeFromTenths)
    return `${decimalFormat.format(quantity / 1000)} L`;
  if (quantity >= 60) return `${numberFormat.format(quantity)} ml`;
  if (quantity >= 15) {
    // Round up to the next half tablespoon: 22.5 ml reads 1½ tbsp, 31.67 ml reads 2 tbsp.
    const halves = Math.ceil((quantity / 20) * 2 - 1e-9) / 2;
    return spoonText(halves, "tbsp");
  }
  return spoonText(nearestSpoonsForNeed(quantity / 5), "tsp");
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
