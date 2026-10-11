import { describe, expect, it } from "vitest";
import {
  consumedNutrition,
  recommendRecipes,
  type RecommendationMode,
} from "../../src/lib/engine";
import type { Recipe, RecipeState, CookingSession } from "../../src/lib/schema";
import {
  byId,
  emptyData,
  fixedRandom,
  NOW,
  real,
  stateFor,
} from "./backend-engine-fixtures";

const options = { now: NOW, random: fixedRandom(0.5) };
const ids = (items: { recipe: Recipe }[]) => items.map((item) => item.recipe.id);
const session = (recipeId: string, date: string, id = `${recipeId}-${date}`): CookingSession => ({
  id,
  updatedAt: 0,
  recipeId,
  date,
  servingsPrepared: 2,
  servingsConsumed: 1,
  rating: null,
  actualMinutes: null,
  ingredientChanges: "",
  temperatureC: null,
  timeChanges: "",
  notes: "",
  wouldCookAgain: null,
});
const daysBefore = (days: number) =>
  new Date(NOW - days * 86400000).toISOString().slice(0, 10);

// Every reason must be a true statement about this recipe and this user's data.
function assertReasonsTrue(
  recipe: Recipe,
  state: RecipeState | undefined,
  reasons: string[],
  data = emptyData(),
) {
  for (const reason of reasons) {
    if (reason.startsWith("Fits your ")) {
      expect(recipe.totalMinutes, reason).toBeLessThanOrEqual(data.preferences.maxMinutes);
    } else if (reason.endsWith("g protein per serving")) {
      const grams = Number(reason.replace("g protein per serving", ""));
      expect(grams, reason).toBe(Math.round(recipe.nutrition.protein));
    } else if (reason === "Something you have not tried") {
      expect(state?.tried ?? false, reason).toBe(false);
    } else if (reason === "One of your saved favourites") {
      expect(state?.favourite, reason).toBe(true);
    } else if (reason.startsWith("You rated this")) {
      expect(reason, reason).toBe(`You rated this ${state?.rating}/5`);
      expect(state?.rating ?? 0, reason).toBeGreaterThanOrEqual(4);
    } else if (reason === "From a category you have rated highly") {
      expect(state?.tried ?? false, reason).toBe(false);
    } else if (reason.endsWith("ingredients in your pantry")) {
      const [matched, total] = reason.split(" ingredients")[0].split(" of ").map(Number);
      expect(total, reason).toBe(recipe.ingredients.length);
      expect(matched, reason).toBeGreaterThan(0);
    } else {
      expect(
        ["Matches your preferred proteins", "Includes an ingredient you enjoy", "Matches a favourite cuisine"],
        reason,
      ).toContain(reason);
    }
  }
}

describe("a brand-new user", () => {
  it("gets a varied, deterministic first list with honest reasons", () => {
    const data = emptyData();
    const first = recommendRecipes(real, data, "tonight", 6, options);
    expect(first).toHaveLength(6);
    expect(new Set(first.map((r) => r.recipe.category)).size).toBeGreaterThanOrEqual(4);
    expect(ids(recommendRecipes(real, data, "tonight", 6, options))).toEqual(ids(first));
    for (const item of first) {
      expect(item.reasons.length).toBeGreaterThan(0);
      assertReasonsTrue(item.recipe, undefined, item.reasons, data);
    }
  });
});

describe("one favourite", () => {
  it("raises the favourite and explains it, without touching unrelated recipes", () => {
    const favourite = byId("air-fryer-steak");
    const base = recommendRecipes(real, emptyData(), "tonight", 300, options);
    const withFavourite = recommendRecipes(
      real,
      emptyData({ recipeStates: [stateFor(favourite.id, { favourite: true, tried: true })] }),
      "tonight",
      300,
      options,
    );
    const before = new Map(base.map((r) => [r.recipe.id, r.score]));
    const after = new Map(withFavourite.map((r) => [r.recipe.id, r.score]));
    const changed = [...after].filter(([id, score]) => before.get(id) !== score).map(([id]) => id);
    // Only the favourite itself changes: it is tried, so the untried bonus stops applying too.
    expect(changed).toEqual([favourite.id]);
    const item = withFavourite.find((r) => r.recipe.id === favourite.id)!;
    expect(item.reasons).toContain("One of your saved favourites");
  });
});

describe("extensive history", () => {
  const history: CookingSession[] = Array.from({ length: 2000 }, (_, index) => {
    const recipe = real[index % real.length];
    return session(recipe.id, daysBefore(index % 730), `history-${index}`);
  });
  const states = real.map((recipe) => stateFor(recipe.id, { tried: true, triedAt: 0 }));

  it("does not repeat anything cooked in the last week in the top results", () => {
    const data = emptyData({ sessions: history, recipeStates: states });
    const recentlyCooked = new Set(history.filter((s) => s.date >= daysBefore(7)).map((s) => s.recipeId));
    const top = ids(recommendRecipes(real, data, "tonight", 6, options));
    expect(top.filter((id) => recentlyCooked.has(id))).toEqual([]);
  });

  it("does not show a 'cooked recently' reason as a reason to recommend", () => {
    const data = emptyData({ sessions: history, recipeStates: states });
    for (const item of recommendRecipes(real, data, "tonight", 30, options))
      expect(item.reasons.join(" ")).not.toMatch(/cooked recently/i);
  });

  it("is deterministic with thousands of sessions", () => {
    const data = emptyData({ sessions: history, recipeStates: states });
    expect(ids(recommendRecipes(real, data, "tonight", 30, options))).toEqual(
      ids(recommendRecipes(real, data, "tonight", 30, options)),
    );
  });
});

describe("dislikes chicken", () => {
  it("keeps chicken out of the first list for a user with no other history", () => {
    const data = emptyData();
    data.preferences.dislikedIngredients = ["chicken"];
    const top = recommendRecipes(real, data, "tonight", 6, options);
    expect(top.some((item) => /chicken/i.test(item.recipe.title))).toBe(false);
  });

  it("still shows chicken when the user asks for it by name in preferred proteins", () => {
    const data = emptyData();
    data.preferences.preferredProteins = ["chicken"];
    const results = recommendRecipes(real, data, "tonight", 300, options);
    expect(results.some((item) => item.recipe.title.toLowerCase().includes("chicken"))).toBe(true);
  });
});

describe("only 15 minutes", () => {
  it("prefers recipes that fit the time over those that overrun", () => {
    const data = emptyData();
    data.preferences.maxMinutes = 15;
    const top = recommendRecipes(real, data, "tonight", 6, options);
    expect(top.length).toBe(6);
    expect(top.filter((item) => item.recipe.totalMinutes <= 15).length).toBeGreaterThanOrEqual(3);
    for (const item of top) assertReasonsTrue(item.recipe, undefined, item.reasons, data);
  });

  it("the fast mode never returns a recipe over 20 minutes or over the user's cap", () => {
    const data = emptyData();
    data.preferences.maxMinutes = 15;
    for (const item of recommendRecipes(real, data, "fast", 300, options))
      expect(item.recipe.totalMinutes).toBeLessThanOrEqual(15);
  });
});

describe("limited pantry", () => {
  it("only offers recipes that use something in the pantry, and says what matched", () => {
    const target = byId("air-fryer-steak");
    const pantry = target.ingredients.slice(0, 2).map((ingredient) => ({
      id: `pantry-${ingredient.name}`,
      updatedAt: 0,
      name: ingredient.name,
      quantity: 500,
      unit: ingredient.unit,
      form: ingredient.form,
    }));
    const data = emptyData({ pantry });
    const results = recommendRecipes(real, data, "pantry", 10, options);
    expect(results.length).toBeGreaterThan(0);
    for (const item of results) {
      expect(item.recipe.ingredients.some((i) => pantry.some((p) => p.name === i.name && p.form === i.form))).toBe(true);
      assertReasonsTrue(item.recipe, undefined, item.reasons, data);
    }
    expect(results.some((item) => item.recipe.id === target.id)).toBe(true);
    expect(results.find((item) => item.recipe.id === target.id)!.reasons.join(" ")).toMatch(/ingredients in your pantry/);
  });

  it("explains the pantry match in pantry mode, where it is the main signal", () => {
    const target = byId("air-fryer-steak");
    const data = emptyData({
      pantry: [{ id: "p", updatedAt: 0, name: target.ingredients[0].name, quantity: 10, unit: target.ingredients[0].unit, form: target.ingredients[0].form }],
      recipeStates: [stateFor(target.id, { favourite: true, rating: 5, tried: false })],
    });
    data.preferences.preferredProteins = [target.title.split(" ")[0].toLowerCase()];
    data.preferences.cuisines = ["steak"];
    const item = recommendRecipes(real, data, "pantry", 300, options).find((r) => r.recipe.id === target.id)!;
    expect(item.reasons.length).toBeLessThanOrEqual(4);
    expect(item.reasons.join(" | ")).toMatch(/in your pantry/);
  });

  it("returns nothing, not a random substitute, when no recipe matches the pantry", () => {
    const data = emptyData({
      pantry: [{ id: "p", updatedAt: 0, name: "Unobtainium", quantity: 1, unit: "each", form: "raw" }],
    });
    expect(recommendRecipes(real, data, "pantry", 6, options)).toEqual([]);
  });

  it("ignores pantry items with zero quantity", () => {
    const target = byId("air-fryer-steak");
    const data = emptyData({
      pantry: [{ id: "p", updatedAt: 0, name: target.ingredients[0].name, quantity: 0, unit: target.ingredients[0].unit, form: target.ingredients[0].form }],
    });
    expect(recommendRecipes(real, data, "pantry", 6, options)).toEqual([]);
  });
});

describe("something new", () => {
  it("only offers recipes that have not been tried", () => {
    const tried = real.slice(0, 150).map((recipe) => stateFor(recipe.id, { tried: true }));
    const data = emptyData({ recipeStates: tried });
    const results = recommendRecipes(real, data, "new", 300, options);
    expect(results.length).toBe(150);
    for (const item of results) expect(item.reasons).toContain("Something you have not tried");
  });
});

describe("repeat a favourite", () => {
  it("is pushed down while fresh, and returns once the cooking is more than a quarter old", () => {
    const favourite = byId("air-fryer-steak");
    const state = stateFor(favourite.id, { favourite: true, rating: 5, tried: true });
    const scoreAfter = (days: number | null) =>
      recommendRecipes(
        real,
        emptyData({ recipeStates: [state], sessions: days === null ? [] : [session(favourite.id, daysBefore(days))] }),
        "tonight",
        300,
        options,
      ).find((r) => r.recipe.id === favourite.id)!.score;
    const fresh = scoreAfter(null);
    // Within a week: -25 recency and -10 for the one cooking. Within four weeks: -10 and -10.
    expect(fresh - scoreAfter(1)).toBeCloseTo(35, 5);
    expect(fresh - scoreAfter(10)).toBeCloseTo(20, 5);
    expect(fresh - scoreAfter(100)).toBeCloseTo(0, 5);
  });
});

describe("contradictory preferences", () => {
  it("avoid wins over preferred, favourite and dietary signals for the same food", () => {
    const data = emptyData();
    data.preferences.avoidIngredients = ["chicken"];
    data.preferences.preferredProteins = ["chicken"];
    data.preferences.favouriteIngredients = ["chicken"];
    const results = recommendRecipes(real, data, "tonight", 300, options);
    expect(results.some((item) => /chicken/i.test(item.recipe.title))).toBe(false);
    for (const item of results)
      expect(item.reasons.join(" ")).not.toMatch(/preferred proteins|ingredient you enjoy/);
  });

  it("dietary and allergen rules still hold when a favourite or preference points at an excluded food", () => {
    const data = emptyData();
    data.preferences.dietary = ["vegetarian"];
    data.preferences.preferredProteins = ["beef"];
    for (const item of recommendRecipes(real, data, "tonight", 300, options)) {
      expect(item.recipe.dietary).toContain("vegetarian");
    }
  });
});

describe("no matching recipes", () => {
  it("returns an honest empty list instead of breaking a constraint", () => {
    // Vegan recipes with no declared allergens exist, so this uses a constraint nothing satisfies.
    const data = emptyData();
    data.preferences.maxMinutes = 1;
    expect(recommendRecipes(real, data, "fast", 6, options)).toEqual([]);
    const favourites = emptyData();
    expect(recommendRecipes(real, favourites, "favourites", 6, options)).toEqual([]);
    const pantry = emptyData();
    expect(recommendRecipes(real, pantry, "pantry", 6, options)).toEqual([]);
  });
});

describe("reset history", () => {
  it("behaves like a brand-new user once states and sessions are cleared", () => {
    const recipeStates = real.slice(0, 100).map((recipe) => stateFor(recipe.id, { favourite: true, rating: 5, tried: true }));
    const sessions = real.slice(0, 100).map((recipe, index) => session(recipe.id, daysBefore(index % 30)));
    const populated = emptyData({ recipeStates, sessions });
    const cleared = { ...populated, recipeStates: [], sessions: [] };
    const top = (data: typeof populated) => ids(recommendRecipes(real, data, "tonight", 6, options));
    expect(top(populated)).not.toEqual(top(emptyData()));
    expect(top(cleared)).toEqual(top(emptyData()));
  });
});

describe("one rating is not overweighted", () => {
  it("a single 5-star rating does not lift the category of the rated recipe", () => {
    const rated = byId("air-fryer-steak");
    const base = recommendRecipes(real, emptyData(), "tonight", 300, options);
    const one = recommendRecipes(real, emptyData({ recipeStates: [stateFor(rated.id, { rating: 5, tried: true })] }), "tonight", 300, options);
    const sameCategory = real.filter((recipe) => recipe.category === rated.category && recipe.id !== rated.id);
    for (const recipe of sameCategory) {
      const before = base.find((r) => r.recipe.id === recipe.id)!.score;
      const after = one.find((r) => r.recipe.id === recipe.id)!.score;
      expect(after, recipe.id).toBeCloseTo(before, 9);
      expect(one.find((r) => r.recipe.id === recipe.id)!.reasons.join(" ")).not.toMatch(/rated highly/);
    }
  });

  it("two highly rated recipes in a category do lift it", () => {
    const first = byId("air-fryer-steak");
    const second = real.find((r) => r.category === first.category && r.id !== first.id)!;
    const data = emptyData({
      recipeStates: [stateFor(first.id, { rating: 5, tried: true }), stateFor(second.id, { rating: 4, tried: true })],
    });
    const sibling = real.find((r) => r.category === first.category && r.id !== first.id && r.id !== second.id)!;
    const item = recommendRecipes(real, data, "tonight", 300, options).find((r) => r.recipe.id === sibling.id)!;
    expect(item.reasons).toContain("From a category you have rated highly");
  });
});

describe("untried is not disliked; tried is not eaten", () => {
  it("an untried recipe gets the untried bonus and no dislike penalty", () => {
    const target = byId("air-fryer-steak");
    const untried = recommendRecipes(real, emptyData(), "tonight", 300, options).find((r) => r.recipe.id === target.id)!;
    expect(untried.reasons).toContain("Something you have not tried");
  });

  it("marking a recipe tried does not create consumed nutrition", () => {
    const target = byId("air-fryer-steak");
    const totals = consumedNutrition([], real);
    expect(totals.protein).toBe(0);
    expect(emptyData({ recipeStates: [stateFor(target.id, { tried: true })] }).sessions).toEqual([]);
  });
});

describe("explanations match the signal that produced the rank", () => {
  it("every reason is true across every mode and a mixed history", () => {
    const data = emptyData({
      sessions: real.slice(0, 40).map((recipe, index) => session(recipe.id, daysBefore(index % 20))),
      recipeStates: real.slice(0, 120).map((recipe, index) =>
        stateFor(recipe.id, { tried: index % 3 !== 0, favourite: index % 11 === 0, rating: index % 4 === 0 ? 5 : index % 7 === 0 ? 2 : null }),
      ),
      pantry: real[10].ingredients.slice(0, 3).map((i, index) => ({ id: `p${index}`, updatedAt: 0, name: i.name, quantity: 100, unit: i.unit, form: i.form })),
    });
    data.preferences.preferredProteins = ["beef"];
    data.preferences.cuisines = ["thai"];
    const modes: RecommendationMode[] = ["tonight", "new", "favourites", "pantry", "fast", "surprise"];
    for (const mode of modes)
      for (const item of recommendRecipes(real, data, mode, 30, options)) {
        const state = data.recipeStates.find((s) => s.id === item.recipe.id);
        assertReasonsTrue(item.recipe, state, item.reasons, data);
        expect(item.reasons.length).toBeLessThanOrEqual(4);
      }
  });
});

describe("diversity over a month of cooking", () => {
  it("does not feed the same recipe every day", () => {
    const data = emptyData();
    const counts = new Map<string, number>();
    for (let day = 0; day < 30; day++) {
      const today = new Date(NOW + day * 86400000).toISOString().slice(0, 10);
      const dayNow = NOW + day * 86400000;
      const [pick] = recommendRecipes(real, data, "tonight", 1, { now: dayNow, random: fixedRandom(0.5) });
      counts.set(pick.recipe.id, (counts.get(pick.recipe.id) ?? 0) + 1);
      data.sessions.push(session(pick.recipe.id, today, `day-${day}`));
      if (!data.recipeStates.some((s) => s.id === pick.recipe.id))
        data.recipeStates.push(stateFor(pick.recipe.id, { tried: true }));
    }
    expect(Math.max(...counts.values())).toBeLessThanOrEqual(3);
    expect(counts.size).toBeGreaterThanOrEqual(10);
  });
});

describe("surprise mode is seedable", () => {
  it("is reproducible for a fixed random source and varies across sources", () => {
    const data = emptyData();
    const a = ids(recommendRecipes(real, data, "surprise", 6, { now: NOW, random: fixedRandom(0.2) }));
    const b = ids(recommendRecipes(real, data, "surprise", 6, { now: NOW, random: fixedRandom(0.2) }));
    expect(a).toEqual(b);
    let sequence = 0;
    const cycling = () => (sequence = (sequence + 0.37) % 1);
    const different = ids(recommendRecipes(real, data, "surprise", 6, { now: NOW, random: cycling }));
    expect(different).not.toEqual(a);
  });

  it("never lets jitter bypass a hard constraint", () => {
    const data = emptyData();
    data.preferences.allergens = ["peanut"];
    data.preferences.dietary = ["vegan"];
    for (let seed = 0; seed < 20; seed++) {
      let step = seed / 20;
      const random = () => (step = (step + 0.31) % 1);
      for (const item of recommendRecipes(real, data, "surprise", 300, { now: NOW, random })) {
        expect(item.recipe.allergens).not.toContain("peanut");
        expect(item.recipe.dietary).toContain("vegan");
      }
    }
  });
});

