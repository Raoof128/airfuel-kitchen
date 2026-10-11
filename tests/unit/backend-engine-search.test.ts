import { describe, expect, it } from "vitest";
import { filterRecipes, type RecipeFilters } from "../../src/lib/engine";
import type { Recipe } from "../../src/lib/schema";
import { byId, real } from "./backend-engine-fixtures";

const wordsOf = (recipe: Recipe) =>
  [recipe.title, recipe.description, ...recipe.tags, ...recipe.ingredients.map((i) => i.name)]
    .join(" ")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);

describe("README queries on the real catalogue", () => {
  it("chicken breast returns only recipes with both words at the start of a word", () => {
    const results = filterRecipes(real, { query: "chicken breast" });
    expect(results.length).toBeGreaterThan(0);
    for (const recipe of results) {
      const words = wordsOf(recipe);
      expect(words.some((w) => w.startsWith("chicken")), recipe.id).toBe(true);
      expect(words.some((w) => w.startsWith("breast")), recipe.id).toBe(true);
    }
  });

  it("under 20 minutes is strict, so a 20-minute recipe is excluded", () => {
    const results = filterRecipes(real, { query: "under 20 minutes" });
    expect(results.length).toBeGreaterThan(0);
    for (const recipe of results) expect(recipe.totalMinutes, recipe.id).toBeLessThan(20);
    const strictlyOver = real.filter((r) => r.totalMinutes >= 20).map((r) => r.id);
    for (const id of strictlyOver) expect(results.map((r) => r.id)).not.toContain(id);
  });

  it("no oil returns only oil-free recipes", () => {
    const results = filterRecipes(real, { query: "no oil" });
    expect(results.length).toBeGreaterThan(0);
    for (const recipe of results) expect(recipe.oilFree, recipe.id).toBe(true);
    expect(filterRecipes(real, { query: "oil free" }).map((r) => r.id)).toEqual(results.map((r) => r.id));
    expect(filterRecipes(real, { query: "oil-free" }).map((r) => r.id)).toEqual(results.map((r) => r.id));
  });

  it("more than 40g protein is strict, so exactly 40g is excluded", () => {
    const results = filterRecipes(real, { query: "more than 40g protein" });
    expect(results.length).toBeGreaterThan(0);
    for (const recipe of results) expect(recipe.nutrition.protein, recipe.id).toBeGreaterThan(40);
    const exactly = real.filter((r) => r.nutrition.protein === 40);
    for (const recipe of exactly) expect(results.map((r) => r.id)).not.toContain(recipe.id);
  });

  it("at least 40g protein includes exactly 40g", () => {
    const atLeast = filterRecipes(real, { query: "at least 40g protein" }).map((r) => r.id);
    const more = filterRecipes(real, { query: "more than 40g protein" }).map((r) => r.id);
    expect(atLeast.length).toBeGreaterThanOrEqual(more.length);
    for (const recipe of real.filter((r) => r.nutrition.protein >= 40)) expect(atLeast, recipe.id).toContain(recipe.id);
  });

  it("combined phrases intersect with the structured filters", () => {
    const filters: RecipeFilters = { query: "chicken under 25 minutes no oil more than 30g protein", dietary: ["gluten-free"] };
    const results = filterRecipes(real, filters);
    for (const recipe of results) {
      expect(recipe.totalMinutes).toBeLessThan(25);
      expect(recipe.oilFree).toBe(true);
      expect(recipe.nutrition.protein).toBeGreaterThan(30);
      expect(recipe.dietary).toContain("gluten-free");
      expect(wordsOf(recipe).some((w) => w.startsWith("chicken"))).toBe(true);
    }
  });
});

describe("filter combinations never leak", () => {
  // A small deterministic generator, so the combinations are reproducible.
  let seed = 20261011;
  const next = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const pick = <T,>(values: readonly T[]) => values[Math.floor(next() * values.length)];
  const categories = [...new Set(real.map((r) => r.category))];
  const allergens = ["milk", "egg", "wheat", "peanut", "fish", "tree-nut"] as const;
  const dietary = ["vegetarian", "vegan", "gluten-free", "dairy-free"] as const;

  it("every result satisfies every filter that was set, over 150 seeded random combinations", () => {
    // Violations are collected and asserted once, so a failure lists every broken combination.
    const violations: string[] = [];
    for (let round = 0; round < 150; round++) {
      const filters: RecipeFilters = {
        category: next() < 0.4 ? pick(categories) : undefined,
        minProtein: next() < 0.4 ? Math.floor(next() * 60) : undefined,
        maxCalories: next() < 0.3 ? 200 + Math.floor(next() * 800) : undefined,
        maxMinutes: next() < 0.4 ? 10 + Math.floor(next() * 50) : undefined,
        dietary: next() < 0.4 ? [pick(dietary)] : undefined,
        excludeAllergens: next() < 0.5 ? [pick(allergens)] : undefined,
        avoidIngredients: next() < 0.3 ? [pick(["chicken", "rice", "egg", "prawn"])] : undefined,
        oilFree: next() < 0.3,
        difficulty: next() < 0.3 ? pick(["Easy", "Moderate"]) : undefined,
        status: next() < 0.3 ? pick(["tried", "untried", "favourites", "all"] as const) : undefined,
      };
      for (const recipe of filterRecipes(real, filters)) {
        const broken = [
          filters.category && recipe.category !== filters.category && "category",
          filters.minProtein !== undefined && recipe.nutrition.protein < filters.minProtein && "minProtein",
          filters.maxCalories !== undefined && recipe.nutrition.calories > filters.maxCalories && "maxCalories",
          filters.maxMinutes !== undefined && recipe.totalMinutes > filters.maxMinutes && "maxMinutes",
          (filters.dietary ?? []).some((claim) => !recipe.dietary.includes(claim)) && "dietary",
          (filters.excludeAllergens ?? []).some((a) => recipe.allergens.includes(a as never)) && "allergen",
          filters.oilFree && !recipe.oilFree && "oilFree",
          filters.difficulty && recipe.difficulty !== filters.difficulty && "difficulty",
          // Whole-word check: a subset of what the engine excludes, so it cannot flag a valid result.
          filters.avoidIngredients?.some((entry) => recipe.ingredients.some((i) => new RegExp(`\\b${entry}(s|es)?\\b`, "i").test(i.name))) && "avoid",
        ].filter(Boolean);
        if (broken.length) violations.push(`${round} ${recipe.id}: ${broken.join(",")}`);
      }
    }
    expect(violations).toEqual([]);
  });
});

describe("word-start matching", () => {
  const fixture = (title: string, ingredient: string): Recipe => ({
    ...byId("air-fryer-steak"),
    id: `synthetic-${title.replace(/\W+/g, "-").toLowerCase()}`,
    slug: `synthetic-${title.replace(/\W+/g, "-").toLowerCase()}`,
    title,
    description: title,
    tags: [],
    ingredients: [{ ...byId("air-fryer-steak").ingredients[0], name: ingredient }],
  });
  const pool = [fixture("Boiled eggs", "eggs"), fixture("Oiled greens", "spinach"), fixture("Veggie stir fry", "tofu")];

  it("oil matches oiled but not boiled", () => {
    expect(filterRecipes(pool, { query: "oil" }).map((r) => r.title)).toEqual(["Oiled greens"]);
  });

  it("egg matches eggs but not veggie", () => {
    expect(filterRecipes(pool, { query: "egg" }).map((r) => r.title)).toEqual(["Boiled eggs"]);
    expect(filterRecipes(pool, { query: "egg" }).map((r) => r.title)).not.toContain("Veggie stir fry");
  });

  it("matches the start of a hyphenated word and ignores case and punctuation", () => {
    expect(filterRecipes(pool, { query: "STIR-fry!!" }).map((r) => r.title)).toEqual(["Veggie stir fry"]);
  });
});

describe("pathological search input", () => {
  const every = (query: string) => filterRecipes(real, { query });

  it("never throws and never returns a non-array for odd input", () => {
    const inputs = [
      "",
      "   ",
      "\t\n",
      "(.*)+$",
      "[unclosed",
      "\\",
      "a|b",
      "?",
      "*",
      "^$",
      "$1 $& \\1",
      "🍗🍗🍗",
      "Crème brûlée",
      "مرغ",
      "\u0000null\u0000",
      "​​chicken",
      "undefined",
      "under",
      "under 20",
      "more than protein",
      "more than 40",
      "CHICKEN   breast",
    ];
    for (const input of inputs) {
      const results = every(input);
      expect(Array.isArray(results), JSON.stringify(input)).toBe(true);
    }
  });

  it("blank and punctuation-only queries behave like no query", () => {
    const all = real.map((r) => r.id);
    expect(every("").map((r) => r.id)).toEqual(all);
    expect(every("   ").map((r) => r.id)).toEqual(all);
    expect(every("!!!").map((r) => r.id)).toEqual(all);
  });

  it("treats regular-expression syntax as plain punctuation", () => {
    // Punctuation separates words and is never compiled into a pattern.
    const set = (query: string) => new Set(every(query).map((r) => r.id));
    expect(set("(.*)+$")).toEqual(set(""));
    expect(set("[chicken")).toEqual(set("chicken"));
    expect(set("chicken|steak")).toEqual(set("chicken steak"));
  });

  it("returns nothing for a Persian or emoji query that matches no catalogue word", () => {
    expect(every("مرغ")).toEqual([]);
  });

  it("treats a very long query as fast and deterministic", () => {
    const repeated = "chicken ".repeat(1500);
    const first = every(repeated).map((r) => r.id);
    expect(every(repeated).map((r) => r.id)).toEqual(first);
    // Same matches as the single word; relevance order can differ because it compares the whole phrase.
    expect(new Set(first)).toEqual(new Set(every("chicken").map((r) => r.id)));
    const started = performance.now();
    every(repeated);
    expect(performance.now() - started).toBeLessThan(250);
  });

  it("handles a 10,000-character string of unique words without a long stall", () => {
    const unique = Array.from({ length: 1200 }, (_, index) => `word${index}`).join(" ");
    const started = performance.now();
    expect(every(unique)).toEqual([]);
    expect(performance.now() - started).toBeLessThan(1000);
  });
});
