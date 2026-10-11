import { describe, expect, it } from "vitest";
import { filterRecipes } from "../../src/lib/engine";
import { recipeSchema, type Recipe } from "../../src/lib/schema";
import { readFileSync } from "node:fs";

const base = recipeSchema
  .array()
  .parse(JSON.parse(readFileSync("src/data/recipes-savoury.json", "utf8")))[0];
const named = (id: string, title: string, extra: Partial<Recipe> = {}): Recipe =>
  recipeSchema.parse({
    ...base,
    id,
    slug: id,
    title,
    description: "Fixture for search word matching.",
    tags: [],
    ingredients: [{ ...base.ingredients[0], name: id.includes("potato") ? "potato" : "water" }],
    image: base.image,
    ...extra,
  });

const recipes = [
  named("boiled-potatoes", "Boiled potatoes"),
  named("veggie-burger", "Veggie burger"),
  named("scrambled-eggs", "Scrambled eggs"),
  named("rib-eye", "Rib-eye steak"),
  named("jalapeno-poppers", "Jalapeño poppers"),
  named("garlic-chips", "Garlic oil chips"),
  named("rice-bowl", "Rice bowl"),
  named("price-check", "Price check soup"),
];
const titles = (query: string) =>
  filterRecipes(recipes, { query }).map((recipe) => recipe.title).sort();

describe("search matches whole words, not substrings", () => {
  it("does not match a word that merely contains the query", () => {
    expect(titles("oil")).toEqual(["Garlic oil chips"]);
    expect(titles("egg")).toEqual(["Scrambled eggs"]);
    expect(titles("rice")).toEqual(["Rice bowl"]);
  });

  it("still matches the start of a word, plurals and hyphenated parts", () => {
    expect(titles("eggs")).toEqual(["Scrambled eggs"]);
    expect(titles("potato")).toEqual(["Boiled potatoes"]);
    expect(titles("rib")).toEqual(["Rib-eye steak"]);
    expect(titles("eye")).toEqual(["Rib-eye steak"]);
  });

  it("finds accented words with or without the accent, and keeps the word-start rule", () => {
    expect(titles("jalapeño")).toEqual(["Jalapeño poppers"]);
    expect(titles("jalapeno")).toEqual(["Jalapeño poppers"]);
    expect(titles("JALAPENO poppers")).toEqual(["Jalapeño poppers"]);
    // Folding must not turn word starts into substrings: "oil" still does not match "boiled".
    expect(titles("oil")).toEqual(["Garlic oil chips"]);
    expect(titles("oil")).not.toContain("Boiled potatoes");
  });

  it("ignores punctuation and case in the query", () => {
    expect(titles("Scrambled,")).toEqual(["Scrambled eggs"]);
    expect(titles("  RIB-EYE  ")).toEqual(["Rib-eye steak"]);
  });

  it("keeps the README phrases working on the real catalogue", () => {
    const catalogue = [
      ...recipeSchema.array().parse(JSON.parse(readFileSync("src/data/recipes-savoury.json", "utf8"))),
      ...recipeSchema.array().parse(JSON.parse(readFileSync("src/data/recipes-plant.json", "utf8"))),
    ];
    const count = (query: string) => filterRecipes(catalogue, { query }).length;
    expect(count("chicken breast")).toBeGreaterThan(0);
    expect(count("under 20 minutes")).toBe(
      catalogue.filter((recipe) => recipe.totalMinutes < 20).length,
    );
    expect(count("no oil")).toBe(catalogue.filter((recipe) => recipe.oilFree).length);
    expect(count("more than 40g protein")).toBe(
      catalogue.filter((recipe) => recipe.nutrition.protein > 40).length,
    );
  });
});
