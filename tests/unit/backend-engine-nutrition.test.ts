import { describe, expect, it } from "vitest";
import {
  buildShoppingList,
  consumedNutrition,
  formatShoppingAmount,
  plannedNutrition,
  scaleIngredients,
} from "../../src/lib/engine";
import type { PantryItem, PlanEntry, Recipe, ShoppingItem } from "../../src/lib/schema";
import { real, TODAY } from "./backend-engine-fixtures";

const scaledFactors = [0.01, 0.5, 1, 1.5, 3.7, 100];
const plan = (recipe: Recipe, servings: number, id = `${recipe.id}-${servings}`): PlanEntry => ({
  id,
  updatedAt: 0,
  recipeId: recipe.id,
  date: TODAY,
  slot: "dinner",
  servings,
});

describe("scaling invariants over the whole catalogue", () => {
  it("doubling the servings doubles every quantity", () => {
    for (const recipe of real) {
      const doubled = scaleIngredients(recipe, recipe.servings * 2);
      recipe.ingredients.forEach((ingredient, index) =>
        expect(doubled[index].quantity, `${recipe.id} ${ingredient.name}`).toBeCloseTo(ingredient.quantity * 2, 9),
      );
    }
  });

  it("scaling ingredients and servings together keeps the per-serving quantity", () => {
    for (const recipe of real)
      for (const factor of [0.5, 2, 3]) {
        const scaled = scaleIngredients(recipe, recipe.servings * factor);
        recipe.ingredients.forEach((ingredient, index) =>
          expect(scaled[index].quantity / (recipe.servings * factor), `${recipe.id}`).toBeCloseTo(
            ingredient.quantity / recipe.servings,
            9,
          ),
        );
      }
  });

  it("returns only finite, positive quantities for every allowed serving count", () => {
    for (const recipe of real)
      for (const servings of scaledFactors) {
        const scaled = scaleIngredients(recipe, servings);
        expect(scaled.length).toBe(recipe.ingredients.length);
        for (const item of scaled) {
          expect(Number.isFinite(item.quantity), recipe.id).toBe(true);
          expect(item.quantity).toBeGreaterThan(0);
        }
      }
  });

  it("rejects servings outside the allowed range, including NaN and infinities", () => {
    const recipe = real[0];
    for (const servings of [0, 0.009, -1, 100.01, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])
      expect(() => scaleIngredients(recipe, servings), String(servings)).toThrow();
  });

  it("never changes the recipe it was given, and never scales temperatures", () => {
    for (const recipe of real.slice(0, 60)) {
      const before = structuredClone(recipe);
      const scaled = scaleIngredients(recipe, recipe.servings * 4);
      expect(recipe).toEqual(before);
      expect(recipe.temperatureC).toBe(before.temperatureC);
      for (const item of scaled) {
        expect(Object.keys(item).sort()).toEqual(Object.keys(recipe.ingredients[0]).sort());
        expect(item).not.toHaveProperty("temperatureC");
      }
    }
  });
});

describe("nutrition totals", () => {
  it("is linear in servings and finite for every recipe", () => {
    for (const recipe of real) {
      const one = plannedNutrition([plan(recipe, 1)], real);
      const three = plannedNutrition([plan(recipe, 3)], real);
      for (const key of ["protein", "calories", "carbs", "fat"] as const) {
        expect(Number.isFinite(one[key]), recipe.id).toBe(true);
        expect(one[key]).toBeGreaterThanOrEqual(0);
        expect(three[key]).toBeCloseTo(one[key] * 3, 9);
      }
    }
  });

  it("per-serving nutrition stays stable when a plan is scaled with its servings", () => {
    for (const recipe of real.slice(0, 80)) {
      const base = plannedNutrition([plan(recipe, 1)], real);
      const doubled = plannedNutrition([plan(recipe, 2)], real);
      expect(doubled.protein / 2).toBeCloseTo(base.protein, 9);
    }
  });

  it("counts a missing recipe rather than throwing", () => {
    expect(plannedNutrition([{ ...plan(real[0], 1), recipeId: "gone" }], real).missingRecipes).toBe(1);
    expect(consumedNutrition([], real)).toEqual({ protein: 0, calories: 0, carbs: 0, fat: 0, missingRecipes: 0 });
  });
});

describe("shopping aggregation", () => {
  it("a single plan lists the scaled quantities, rounded to three decimals", () => {
    const recipe = real.find((r) => r.ingredients.some((i) => i.unit === "tsp"))!;
    const rows = buildShoppingList([plan(recipe, recipe.servings * 2)], real);
    for (const ingredient of recipe.ingredients) {
      const expected = ingredient.unit === "tsp" ? ingredient.quantity * 2 * 5 : ingredient.unit === "tbsp" ? ingredient.quantity * 2 * 20 : ingredient.quantity * 2;
      const row = rows.find((r) => r.name === ingredient.name && r.form === ingredient.form);
      expect(row, ingredient.name).toBeDefined();
      expect(Math.abs(row!.quantity - expected)).toBeLessThanOrEqual(0.0005);
    }
  });

  it("two plans of the same recipe sum to the same as one plan with the combined servings", () => {
    for (const recipe of real.slice(0, 60)) {
      const combined = buildShoppingList([plan(recipe, 2)], real);
      const split = buildShoppingList([plan(recipe, 1, "a"), plan(recipe, 1, "b")], real);
      expect(split.length).toBe(combined.length);
      for (const row of combined) {
        const match = split.find((r) => r.id === row.id)!;
        expect(Math.abs(match.quantity - row.quantity), recipe.id).toBeLessThanOrEqual(0.002);
      }
    }
  });

  it("only ever lists g, ml or each, so spoons are converted and no unit mixing occurs", () => {
    const rows = buildShoppingList(real.map((recipe, index) => plan(recipe, 1 + (index % 4), `p${index}`)), real);
    const units = new Set(rows.map((row) => row.unit));
    for (const unit of units) expect(["g", "ml", "each"]).toContain(unit);
    for (const row of rows) expect(row.quantity).toBeGreaterThan(0);
  });

  it("keeps the same ingredient apart when its measure is incompatible", () => {
    const recipe = real[0];
    const egg = { ...recipe.ingredients[0], name: "Egg", form: "raw", unit: "each" as const, quantity: 2 };
    const eggWeight = { ...egg, unit: "g" as const, quantity: 100 };
    const synthetic: Recipe = { ...recipe, id: "synthetic-egg", slug: "synthetic-egg", ingredients: [egg] };
    const other: Recipe = { ...recipe, id: "synthetic-egg-g", slug: "synthetic-egg-g", ingredients: [eggWeight] };
    const rows = buildShoppingList([plan(synthetic, 1, "a"), plan(other, 1, "b")], [synthetic, other]);
    expect(rows.filter((row) => row.name === "Egg").map((row) => row.unit).sort()).toEqual(["each", "g"]);
  });

  it("converts tsp and tbsp to ml when the same ingredient comes from several recipes", () => {
    const recipe = real[0];
    const tsp = { ...recipe.ingredients[0], name: "Soy", form: "raw", unit: "tsp" as const, quantity: 3 };
    const tbsp = { ...tsp, unit: "tbsp" as const, quantity: 1 };
    const a: Recipe = { ...recipe, id: "synthetic-a", slug: "synthetic-a", servings: 1, ingredients: [tsp] };
    const b: Recipe = { ...recipe, id: "synthetic-b", slug: "synthetic-b", servings: 1, ingredients: [tbsp] };
    const rows = buildShoppingList([plan(a, 1, "a"), plan(b, 1, "b")], [a, b]);
    expect(rows).toHaveLength(1);
    expect(rows[0].unit).toBe("ml");
    expect(rows[0].quantity).toBeCloseTo(35, 9);
  });

  it("subtracts pantry stock in the same base unit and never goes negative", () => {
    const recipe = real[0];
    const tbsp = { ...recipe.ingredients[0], name: "Oil", form: "raw", unit: "tbsp" as const, quantity: 2 };
    const synthetic: Recipe = { ...recipe, id: "synthetic-oil", slug: "synthetic-oil", servings: 1, ingredients: [tbsp] };
    const pantry: PantryItem[] = [{ id: "p", updatedAt: 0, name: "Oil", quantity: 1, unit: "tbsp", form: "raw" }];
    expect(buildShoppingList([plan(synthetic, 1)], [synthetic], pantry)[0].quantity).toBe(20);
    const plenty: PantryItem[] = [{ id: "p", updatedAt: 0, name: "Oil", quantity: 100, unit: "tbsp", form: "raw" }];
    expect(buildShoppingList([plan(synthetic, 1)], [synthetic], plenty)).toEqual([]);
  });

  it("does not list a need that rounds to zero", () => {
    const recipe = real[0];
    const dust = { ...recipe.ingredients[0], name: "Dust", form: "raw", unit: "g" as const, quantity: 0.0003 };
    const synthetic: Recipe = { ...recipe, id: "synthetic-dust", slug: "synthetic-dust", servings: 1, ingredients: [dust] };
    expect(buildShoppingList([plan(synthetic, 1)], [synthetic])).toEqual([]);
  });

  it("keeps a manual item and a tick only for an unchanged quantity", () => {
    const recipe = real[0];
    const first = buildShoppingList([plan(recipe, 1)], real);
    const ticked: ShoppingItem[] = first.map((row) => ({ ...row, checked: true }));
    expect(buildShoppingList([plan(recipe, 1)], real, [], ticked).every((row) => row.checked)).toBe(true);
    expect(buildShoppingList([plan(recipe, 2)], real, [], ticked).every((row) => !row.checked)).toBe(true);
    const manual: ShoppingItem = { id: "m", updatedAt: 0, name: "Bread", quantity: 1, unit: "each", form: "raw", aisle: "Bakery", checked: false, manual: true };
    expect(buildShoppingList([], real, [], [manual])).toEqual([manual]);
  });
});

describe("formatShoppingAmount", () => {
  it("never prints a positive amount as zero, and never prints NaN or Infinity", () => {
    for (let ml = 0.01; ml < 2000; ml += 0.37) {
      const text = formatShoppingAmount(ml, "ml");
      expect(text, String(ml)).not.toMatch(/NaN|Infinity|^0 /);
    }
    for (let grams = 0.01; grams < 3000; grams += 0.73) {
      const text = formatShoppingAmount(grams, "g");
      expect(text, String(grams)).not.toMatch(/NaN|Infinity|^0 /);
    }
  });

  it("tablespoons are rounded up, so the shown volume is never below the need", () => {
    const glyph: Record<string, number> = { "": 0, "¼": 0.25, "⅓": 1 / 3, "½": 0.5, "⅔": 2 / 3, "¾": 0.75 };
    const parse = (text: string) => {
      const [, whole = "", fraction = ""] = text.match(/^(\d*)([¼⅓½⅔¾]?) tbsp$/) ?? [];
      return (Number(whole || 0) + glyph[fraction]) * 20;
    };
    for (let ml = 15; ml < 60; ml += 0.37) {
      const shown = parse(formatShoppingAmount(ml, "ml"));
      expect(shown, String(ml)).toBeGreaterThanOrEqual(ml - 1e-6);
    }
  });

  it("teaspoons are the nearest quarter or third, within half a step", () => {
    for (let ml = 0.5; ml < 15; ml += 0.37) {
      expect(formatShoppingAmount(ml, "ml"), String(ml)).toMatch(/tsp$/);
    }
    expect(formatShoppingAmount(14.99, "ml")).toBe("3 tsp");
    expect(formatShoppingAmount(15, "ml")).toBe("1 tbsp");
  });

  it("switches to ml, L, g and kg at the right points", () => {
    expect(formatShoppingAmount(59.99, "ml")).toBe("3 tbsp");
    expect(formatShoppingAmount(60, "ml")).toBe("60 ml");
    expect(formatShoppingAmount(999.9, "ml")).toBe("999.9 ml");
    expect(formatShoppingAmount(999.96, "ml")).toBe("1 L");
    expect(formatShoppingAmount(1000, "ml")).toBe("1 L");
    expect(formatShoppingAmount(999.96, "g")).toBe("1 kg");
    expect(formatShoppingAmount(1500, "g")).toBe("1.5 kg");
    expect(formatShoppingAmount(999, "g")).toBe("999 g");
  });

  it("shows a tiny positive need as a small amount, not zero", () => {
    expect(formatShoppingAmount(0.4, "ml")).toBe("¼ tsp");
    expect(formatShoppingAmount(0.04, "g")).toBe("0.1 g");
    expect(formatShoppingAmount(0.02, "each")).toBe("0.1 each");
  });

  it("leaves units it does not convert alone and never reads a typed spoon as ml", () => {
    expect(formatShoppingAmount(0.5, "tsp")).toBe("½ tsp");
    expect(formatShoppingAmount(1.9, "tbsp")).toBe("2 tbsp");
    expect(formatShoppingAmount(6, "each")).toBe("6 each");
    expect(formatShoppingAmount(0.125, "tsp")).toBe("¼ tsp");
  });
});
