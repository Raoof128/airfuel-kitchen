import { describe, expect, it } from "vitest";
import {
  effectiveRecipes,
  filterRecipes,
  recommendRecipes,
  type RecommendationMode,
} from "../../src/lib/engine";
import {
  allergenNames,
  recipeSchema,
  type Recipe,
  type RecipeOverride,
} from "../../src/lib/schema";
import {
  byId,
  emptyData,
  fixedRandom,
  NOW,
  real,
  stateFor,
} from "./backend-engine-fixtures";

const modes: RecommendationMode[] = [
  "tonight",
  "new",
  "favourites",
  "pantry",
  "fast",
  "surprise",
];
const options = { now: NOW, random: fixedRandom(1) };
const everything = 400;

// Recipes that declare an allergen, with the strongest possible ranking signals applied: a
// favourite, rated 5, untried, and matching every preference. If the hard filter fails, these are
// the recipes that would surface first.
function strongestSignals(recipe: Recipe) {
  const data = emptyData();
  data.preferences.preferredProteins = [recipe.title.split(" ")[0]];
  data.preferences.favouriteIngredients = recipe.ingredients.map((i) => i.name);
  data.preferences.minProtein = 1;
  data.preferences.maxMinutes = recipe.totalMinutes;
  data.recipeStates = [
    stateFor(recipe.id, { favourite: true, rating: 5, tried: false }),
  ];
  return data;
}

describe("allergen exclusion is applied before ranking", () => {
  it("never recommends a recipe declaring an excluded allergen, in any mode, under maximum jitter", () => {
    for (const allergen of allergenNames)
      for (const mode of modes) {
        const data = emptyData();
        data.preferences.allergens = [allergen];
        const results = recommendRecipes(real, data, mode, everything, options);
        for (const { recipe } of results)
          expect(recipe.allergens, `${recipe.id} in ${mode} for ${allergen}`).not.toContain(allergen);
      }
  }, 30_000);

  it("keeps a peanut recipe with a perfect score out of every peanut-excluding recommendation", () => {
    const peanutRecipes = real.filter((recipe) => recipe.allergens.includes("peanut"));
    expect(peanutRecipes.length).toBeGreaterThan(0);
    for (const recipe of peanutRecipes) {
      // Non-vacuous: without the exclusion this recipe does appear, so the test can fail.
      const unfiltered = strongestSignals(recipe);
      expect(
        recommendRecipes(real, unfiltered, "favourites", everything, options).map((r) => r.recipe.id),
      ).toContain(recipe.id);
      for (const mode of modes) {
        const data = strongestSignals(recipe);
        data.preferences.allergens = ["peanut"];
        const ids = recommendRecipes(real, data, mode, everything, options).map((r) => r.recipe.id);
        expect(ids, `${recipe.id} in ${mode}`).not.toContain(recipe.id);
      }
      const data = strongestSignals(recipe);
      data.preferences.allergens = ["peanut"];
      expect(
        filterRecipes(real, { excludeAllergens: ["peanut"], query: recipe.title }).map((r) => r.id),
      ).not.toContain(recipe.id);
    }
  }, 30_000);

  it("treats a gluten exclusion as also excluding wheat, and the reverse", () => {
    // Canonical-style ids: custom recipes fail closed on any restriction, which would hide this rule.
    const wheatOnly: Recipe = { ...byId("air-fryer-steak"), id: "synthetic-wheat-only", slug: "synthetic-wheat-only", allergens: ["wheat"], dietary: [] };
    const glutenOnly: Recipe = { ...wheatOnly, id: "synthetic-gluten-only", slug: "synthetic-gluten-only", allergens: ["gluten"] };
    const pool = [wheatOnly, glutenOnly];
    expect(filterRecipes(pool, { excludeAllergens: ["gluten"] })).toEqual([]);
    expect(filterRecipes(pool, { excludeAllergens: ["wheat"] })).toEqual([]);
    expect(filterRecipes(pool, { excludeAllergens: ["egg"] })).toHaveLength(2);
  });

  it("fails closed for custom recipes whose allergens are unknown", () => {
    const custom: Recipe = { ...byId("air-fryer-steak"), id: "custom-unchecked", slug: "custom-unchecked", allergens: [], dietary: [] };
    const data = emptyData({
      customRecipes: [{ id: custom.id, updatedAt: 0, recipe: custom }],
    });
    expect(recommendRecipes([custom], data, "tonight", 5, options).map((r) => r.recipe.id)).toEqual([custom.id]);
    data.preferences.allergens = ["peanut"];
    expect(recommendRecipes([custom], data, "tonight", 5, options)).toEqual([]);
    expect(filterRecipes([custom], { excludeAllergens: ["peanut"] })).toEqual([]);
    data.preferences.allergens = [];
    data.preferences.dietary = ["vegan"];
    expect(recommendRecipes([custom], data, "tonight", 5, options)).toEqual([]);
  });

  it("an override that changes ingredients fails closed for every allergen and diet filter", () => {
    const base = byId("air-fryer-sweet-potato-fries");
    const peanutAdded = recipeSchema.parse({
      ...base,
      ingredients: [...base.ingredients, { ...base.ingredients[0], name: "roasted peanuts" }],
    });
    const chickenAdded = recipeSchema.parse({
      ...base,
      ingredients: [...base.ingredients, { ...base.ingredients[0], name: "chicken thighs" }],
    });
    const data = emptyData({
      overrides: [
        { id: base.id, updatedAt: 0, recipe: peanutAdded },
      ],
    });
    const pool = effectiveRecipes(real, data);
    data.preferences.allergens = ["peanut"];
    expect(recommendRecipes(pool, data, "surprise", 400, options).map((r) => r.recipe.id)).not.toContain(base.id);
    expect(filterRecipes(pool, { excludeAllergens: ["peanut"] }).map((r) => r.id)).not.toContain(base.id);
    data.preferences.allergens = [];
    data.preferences.dietary = ["vegetarian"];
    const poolChicken = effectiveRecipes(real, emptyData({ overrides: [{ id: base.id, updatedAt: 0, recipe: chickenAdded }] }));
    expect(filterRecipes(poolChicken, { dietary: ["vegetarian"] }).map((r) => r.id)).not.toContain(base.id);
    // Unchanged ingredients keep the canonical claims, so the override is still usable.
    const sameIngredients = recipeSchema.parse({ ...base, title: "Renamed fries" });
    const poolSame = effectiveRecipes(real, emptyData({ overrides: [{ id: base.id, updatedAt: 0, recipe: sameIngredients }] }));
    expect(poolSame.find((r) => r.id === base.id)!.title).toBe("Renamed fries");
  });

  it("an override can never remove a canonical allergen or dietary claim", () => {
    const base = byId("air-fryer-steak");
    const parsed = recipeSchema.parse({ ...base, allergens: [], dietary: ["vegan"] });
    const override: RecipeOverride = { id: base.id, updatedAt: 0, recipe: parsed };
    const [merged] = effectiveRecipes([base], emptyData({ overrides: [override] }));
    expect(merged.allergens).toEqual(expect.arrayContaining(base.allergens));
    expect(merged.dietary).not.toContain("vegan");
  });
});

describe("avoided ingredients match words, not substrings", () => {
  const title = (id: string) => byId(id).title.toLowerCase();

  it("avoiding egg keeps eggplant recipes and removes egg recipes", () => {
    const eggplant = real.filter((recipe) => /eggplant|aubergine/.test(recipe.ingredients.map((i) => i.name).join(" ").toLowerCase()) && !recipe.ingredients.some((i) => /\beggs?\b/.test(i.name.toLowerCase())));
    expect(eggplant.length).toBeGreaterThan(0);
    const avoidEgg = filterRecipes(real, { avoidIngredients: ["egg"] });
    for (const recipe of eggplant) expect(avoidEgg.map((r) => r.id)).toContain(recipe.id);
    for (const recipe of avoidEgg)
      expect(recipe.ingredients.some((i) => /\beggs?\b/i.test(i.name)) || /\beggs?\b/i.test(recipe.title)).toBe(false);
  });

  it("avoiding pea does not remove peanut recipes, but does remove a word ending in pea", () => {
    const peanut = real.filter((recipe) => recipe.allergens.includes("peanut"));
    const peanutWithoutPea = peanut.filter((recipe) => !recipe.ingredients.some((i) => /\w*pea(s)?\b/i.test(i.name)));
    expect(peanutWithoutPea.length).toBeGreaterThan(0);
    const kept = filterRecipes(real, { avoidIngredients: ["pea"] }).map((r) => r.id);
    for (const recipe of peanutWithoutPea) expect(kept, recipe.id).toContain(recipe.id);
    // Conservative: "chickpea" ends in "pea", so a pea avoider also drops chickpea recipes.
    expect(byId("masala-peanuts").ingredients.some((i) => /chickpea/.test(i.name))).toBe(true);
    expect(kept).not.toContain("masala-peanuts");
  });

  it("matches plurals, multi-word entries and compound head nouns", () => {
    const recipe = byId("air-fryer-steak");
    const pool = [{ ...recipe, id: "custom-a", slug: "custom-a", title: "Prawn tacos", ingredients: [{ ...recipe.ingredients[0], name: "Prawns" }] }];
    expect(filterRecipes(pool, { avoidIngredients: ["prawn"] })).toEqual([]);
    expect(filterRecipes(pool, { avoidIngredients: ["Prawns"] })).toEqual([]);
    expect(filterRecipes(pool, { avoidIngredients: ["  PRAWN  "] })).toEqual([]);
    expect(filterRecipes(pool, { avoidIngredients: ["prawn tacos"] })).toEqual([]);
    expect(filterRecipes(pool, { avoidIngredients: ["tacos prawn"] })).toHaveLength(1);
    expect(filterRecipes(pool, { avoidIngredients: ["sushi"] })).toHaveLength(1);
    expect(title("air-fryer-steak")).toContain("steak");
  });

  it("an empty or whitespace entry excludes nothing", () => {
    expect(filterRecipes(real, { avoidIngredients: ["", "   "] })).toHaveLength(real.length);
    const data = emptyData();
    data.preferences.avoidIngredients = ["", "  "];
    expect(recommendRecipes(real, data, "tonight", 6, options)).toHaveLength(6);
  });

  it("avoid lists are hard in search and recommendations alike", () => {
    const data = emptyData();
    data.preferences.avoidIngredients = ["chicken"];
    for (const mode of modes)
      for (const { recipe } of recommendRecipes(real, data, mode, everything, options))
        expect(
          [recipe.title, ...recipe.ingredients.map((i) => i.name)].join(" ").toLowerCase(),
          `${recipe.id} in ${mode}`,
        ).not.toMatch(/\bchicken/);
    expect(filterRecipes(real, { avoidIngredients: ["chicken"] }).every((r) => !/\bchicken/i.test(r.title))).toBe(true);
  });
});

describe("dietary requirements are hard in every mode", () => {
  it("only returns recipes that carry every requested claim", () => {
    for (const claim of ["vegetarian", "vegan", "gluten-free", "dairy-free"] as const)
      for (const mode of modes) {
        const data = emptyData();
        data.preferences.dietary = [claim];
        for (const { recipe } of recommendRecipes(real, data, mode, everything, options))
          expect(recipe.dietary, `${recipe.id} ${mode} ${claim}`).toContain(claim);
      }
  });
});

describe("catalogue safety declarations cover their ingredients", () => {
  // A conservative keyword scan of ingredient names. Recipes whose declared allergens miss a
  // keyword would be shown to people who exclude that allergen, so this guards data drift.
  const keywords: Record<string, RegExp> = {
    peanut: /\bpeanuts?\b/,
    egg: /\beggs?\b/,
    milk: /\b(milk|butter|cream|cheese|yoghurt|yogurt|parmesan|feta|mozzarella|ghee|paneer|whey)\b/,
    fish: /\b(salmon|tuna|cod|barramundi|fish|anchov|snapper|trout|mackerel|sardine|hoki)/,
    crustacean: /\b(prawn|shrimp|crab|lobster)/,
    mollusc: /\b(mussel|clam|oyster|squid|calamari|octopus|scallop)/,
    "tree-nut": /\b(almond|walnut|cashew|pecan|hazelnut|pistachio|pine nut)/,
    sesame: /\b(sesame|tahini)/,
    soy: /\b(soy|tofu|tamari|edamame)/,
    wheat: /\b(flour|wheat|pasta|noodle|bread|couscous|bulgur|panko)/,
  };
  // Ingredients whose name contains a keyword without the allergen: coconut milk, nut butters and
  // "cream-style" mustard are not dairy or nut-free-breaking on their own, so they are stripped first.
  const notAllergen = /(coconut (milk|cream)|almond butter|peanut butter|cashew butter|cream-style|pastry cream)/g;

  it("declares every allergen whose keyword appears in an ingredient", () => {
    const misses: string[] = [];
    for (const recipe of real) {
      const names = recipe.ingredients.map((i) => i.name.toLowerCase().replace(notAllergen, "")).join(" ; ");
      for (const [allergen, pattern] of Object.entries(keywords))
        if (pattern.test(names) && !recipe.allergens.includes(allergen as never))
          misses.push(`${recipe.id}: ${allergen}`);
    }
    expect(misses).toEqual([]);
  });

  it("does not claim a vegan or vegetarian diet alongside an animal ingredient", () => {
    const animal = /\b(chicken|beef|lamb|pork|bacon|turkey|prawn|salmon|fish|tuna|sausage|ham)\b/;
    for (const recipe of real) {
      if (recipe.dietary.includes("vegetarian") || recipe.dietary.includes("vegan"))
        expect(recipe.ingredients.map((i) => i.name).join(" ").toLowerCase(), recipe.id).not.toMatch(animal);
    }
  });

  it("has no recipe that declares gluten-free while declaring wheat or gluten", () => {
    for (const recipe of real)
      if (recipe.dietary.includes("gluten-free"))
        expect(recipe.allergens.some((a) => a === "wheat" || a === "gluten"), recipe.id).toBe(false);
  });
});

describe("recommendation pool is never widened by a stale state", () => {
  it("does not return recipes that are not in the supplied pool", () => {
    const pool = real.slice(0, 20);
    const ids = new Set(pool.map((r) => r.id));
    const data = emptyData({ recipeStates: real.map((r) => stateFor(r.id, { favourite: true, rating: 5 })) });
    for (const mode of modes)
      for (const { recipe } of recommendRecipes(pool, data, mode, everything, options))
        expect(ids.has(recipe.id)).toBe(true);
  });
});

