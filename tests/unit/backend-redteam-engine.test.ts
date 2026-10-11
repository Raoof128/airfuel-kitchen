// Red-team checks on the avoid list and the allergen exclusion surfaces. The avoid list is a hard
// constraint in search and recommendations, so a spelling variant that slips past it is a defect.
// Tests named RT-B<n> are it.fails and encode a confirmed defect.
import { describe, expect, it } from "vitest";
import { catalogue } from "../../src/data/catalogue";
import { filterRecipes, recommendRecipes } from "../../src/lib/engine";
import type { Recipe } from "../../src/lib/schema";
import { emptyData, NOW } from "./backend-engine-fixtures";

// A minimal custom recipe whose only ingredient is `ingredientName`. The title, description and
// tags are neutral, so an avoid match can only come from the ingredient itself.
const template = structuredClone(catalogue[0]) as Recipe;
function customWithIngredient(ingredientName: string): Recipe {
  return {
    ...template,
    id: `custom-rt-${ingredientName.length}`,
    slug: `custom-rt-${ingredientName.length}`,
    title: "Neutral test dish",
    description: "Neutral test dish",
    tags: [],
    allergens: [],
    dietary: [],
    ingredients: [{ ...template.ingredients[0], name: ingredientName }],
  };
}
const excludedBy = (avoid: string, ingredientName: string) =>
  filterRecipes([customWithIngredient(ingredientName)], {
    avoidIngredients: [avoid],
  }).length === 0;

describe("avoid list: controls that must keep working", () => {
  it("excludes a plain ingredient and its plural", () => {
    expect(excludedBy("egg", "egg")).toBe(true);
    expect(excludedBy("egg", "eggs")).toBe(true);
  });

  it("keeps a word that merely contains the avoided letters", () => {
    expect(excludedBy("egg", "eggplant")).toBe(false);
  });
});

describe("avoid list: spelling variants", () => {
  it(
    "RT-B3 avoiding an unaccented word also excludes its accented spelling",
    () => {
      // Users type "jalapeno" or "creme fraiche"; recipes carry "jalapeño" and "crème fraîche".
      expect(excludedBy("jalapeno", "Jalapeño")).toBe(true);
      expect(excludedBy("creme fraiche", "crème fraîche")).toBe(true);
    },
  );

  it(
    "RT-B4 a zero-width character inside an avoided word does not hide the ingredient",
    () => {
      // U+200B is not a letter, so the matcher splits "e\u200Bgg" into "e" and "gg".
      expect(excludedBy("egg", "e\u200Bgg")).toBe(true);
    },
  );

  it(
    "RT-B5 a Cyrillic look-alike letter inside an avoided word does not hide the ingredient",
    () => {
      // "е" (U+0435) looks like Latin "e" but is a different letter.
      expect(excludedBy("egg", "еgg")).toBe(true);
    },
  );
});

describe("allergen exclusion on every surface", () => {
  const peanutRecipe = {
    ...structuredClone(catalogue[0]),
    id: "rt-peanut",
    slug: "rt-peanut",
    title: "Peanut noodle test",
    allergens: ["peanut"],
  } as Recipe;

  it("surprise mode never returns an excluded recipe, even with the full catalogue as the pool", () => {
    const data = emptyData();
    data.preferences.allergens = ["peanut"];
    const pool = [...catalogue, peanutRecipe];
    for (let round = 0; round < 25; round++) {
      const picks = recommendRecipes(pool, data, "surprise", 300, {
        now: NOW,
        random: () => 0.999,
      });
      expect(picks.some((item) => item.recipe.id === "rt-peanut")).toBe(false);
    }
  });

  it("the planner choice list drops a peanut recipe when peanut is excluded", () => {
    const choices = filterRecipes([peanutRecipe], {
      excludeAllergens: ["peanut"],
    });
    expect(choices).toHaveLength(0);
  });

  it("a custom recipe is excluded by every allergen filter, not only by declared ones", () => {
    const custom = customWithIngredient("rice");
    expect(
      filterRecipes([custom], { excludeAllergens: ["milk"] }),
    ).toHaveLength(0);
  });
});
