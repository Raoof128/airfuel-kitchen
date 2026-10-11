import { describe, expect, it } from "vitest";
import {
  buildShoppingList,
  consumedNutrition,
  filterRecipes,
  localDate,
  plannedNutrition,
  recommendRecipes,
  scaleIngredients,
  weekDates,
} from "../../src/lib/engine";
import {
  defaultPreferences,
  recipeSchema,
  type KitchenData,
  type Recipe,
} from "../../src/lib/schema";
export const recipe: Recipe = {
  id: "test-chicken",
  slug: "test-chicken",
  title: "Chicken breast with eggs",
  description: "Original test fixture, not a published recipe.",
  category: "chicken-turkey",
  tags: ["quick"],
  sources: [
    {
      title: "Fixture",
      url: "https://example.org/recipe",
      verifiedAt: "2026-10-11",
    },
  ],
  prepMinutes: 5,
  cookMinutes: 10,
  totalMinutes: 18,
  temperatureC: 180,
  servings: 2,
  portion: "One half",
  ingredients: [
    {
      name: "Chicken breast",
      quantity: 400,
      unit: "g",
      form: "raw",
      preparation: "Cut evenly",
      aisle: "Meat",
    },
    {
      name: "Oregano",
      quantity: 1,
      unit: "tbsp",
      form: "dried",
      preparation: "",
      aisle: "Pantry",
    },
  ],
  steps: ["Cook until safe."],
  preheat: true,
  preheatMinutes: 3,
  turn: "Flip halfway",
  safety: ["Use a thermometer"],
  internalTempC: 75,
  nutrition: {
    protein: 45,
    calories: 300,
    carbs: 10,
    fat: 8,
    fibre: null,
    method: "Fixture",
    confidence: "estimated",
    reference: "Test",
  },
  allergens: ["egg"],
  dietary: [],
  substitutions: [],
  oilFree: true,
  storage: "Fixture",
  equipment: ["Air fryer"],
  difficulty: "Easy",
  image: {
    src: "/images/chicken-turkey.webp",
    alt: "Chicken",
    credit: "AirFuel Kitchen",
    licence: "AI-generated illustration; not a photograph of the tested recipe",
  },
};
const data = (): KitchenData => ({
  recipeStates: [],
  sessions: [],
  plans: [],
  pantry: [],
  shopping: [],
  customRecipes: [],
  overrides: [],
  preferences: structuredClone(defaultPreferences),
  activeCooking: undefined,
});
const plan = {
  id: "p1",
  updatedAt: 0,
  recipeId: recipe.id,
  date: "2026-10-11",
  slot: "dinner" as const,
  servings: 1,
};
const session = {
  id: "s1",
  updatedAt: 0,
  recipeId: recipe.id,
  date: "2026-10-11",
  servingsPrepared: 2,
  servingsConsumed: 0.5,
  rating: 5,
  actualMinutes: null,
  ingredientChanges: "",
  temperatureC: null,
  timeChanges: "",
  notes: "",
  wouldCookAgain: true,
};
describe("strict recipes", () => {
  it("validates fixtures and rejects unknown keys and unsafe sources", () => {
    expect(recipeSchema.safeParse(recipe).success).toBe(true);
    expect(
      recipeSchema.safeParse({ ...recipe, unexpected: true }).success,
    ).toBe(false);
    expect(
      recipeSchema.safeParse({
        ...recipe,
        sources: [
          {
            title: "bad",
            url: "javascript:alert(1)",
            verifiedAt: "2026-02-30",
          },
        ],
      }).success,
    ).toBe(false);
    expect(recipeSchema.safeParse({ ...recipe, totalMinutes: 1 }).success).toBe(
      false,
    );
  });
});
describe("search and recommendations", () => {
  it("handles every specified natural-language search and combined constraints", () => {
    for (const query of [
      "chicken breast",
      "eggs",
      "no oil",
      "under 20 minutes",
      "more than 40g protein",
      "chicken breast under 20 minutes",
    ])
      expect(filterRecipes([recipe], { query })).toHaveLength(1);
    expect(
      filterRecipes([recipe], { query: "more than 45g protein" }),
    ).toHaveLength(0);
    expect(filterRecipes([recipe], { query: "under 18 minutes" })).toHaveLength(
      0,
    );
    expect(filterRecipes([recipe], { minProtein: 50 })).toHaveLength(0);
    expect(filterRecipes([recipe], { status: "untried" })).toHaveLength(1);
  });
  it("keeps allergens, explicit avoid ingredients and diets hard in every mode", () => {
    for (const mode of [
      "tonight",
      "new",
      "favourites",
      "pantry",
      "fast",
      "surprise",
    ] as const) {
      const current = data();
      current.preferences.allergens = ["egg"];
      current.recipeStates = [
        {
          id: recipe.id,
          updatedAt: 0,
          favourite: true,
          tried: false,
          triedAt: null,
          rating: 5,
          notes: "",
          viewedAt: null,
        },
      ];
      expect(recommendRecipes([recipe], current, mode)).toEqual([]);
    }
    const current = data();
    current.preferences.avoidIngredients = ["chicken"];
    expect(recommendRecipes([recipe], current)).toEqual([]);
    current.preferences.avoidIngredients = [];
    current.preferences.dietary = ["vegan"];
    expect(recommendRecipes([recipe], current)).toEqual([]);
  });
  it("gives accurate reasons and ranks preference matches higher", () => {
    const current = data();
    current.preferences.preferredProteins = ["chicken"];
    const alternate = {
      ...recipe,
      id: "alternate",
      slug: "alternate",
      title: "Tofu",
      description: "Tofu",
      ingredients: [{ ...recipe.ingredients[0], name: "Tofu" }],
      tags: [],
    };
    const result = recommendRecipes([alternate, recipe], current);
    expect(result[0].recipe.id).toBe(recipe.id);
    expect(result[0].reasons.some((reason) => reason.includes("45g"))).toBe(
      true,
    );
  });
});
describe("quantities and consumption", () => {
  it("scales every ingredient while preserving source", () => {
    expect(scaleIngredients(recipe, 1).map((i) => i.quantity)).toEqual([
      200, 0.5,
    ]);
    expect(recipe.ingredients[0].quantity).toBe(400);
    expect(() => scaleIngredients(recipe, NaN)).toThrow();
  });
  it("uses consumed portions only; preparation and tried flags never imply intake", () => {
    expect(plannedNutrition([plan], [recipe]).protein).toBe(45);
    expect(consumedNutrition([session], [recipe]).protein).toBe(22.5);
    expect(
      consumedNutrition([{ ...session, servingsConsumed: 0 }], [recipe])
        .protein,
    ).toBe(0);
    expect(consumedNutrition([session], []).missingRecipes).toBe(1);
  });
  it("aggregates AU volumes, respects ingredient form and pantry quantity", () => {
    const second = {
      ...recipe,
      id: "second",
      slug: "second",
      ingredients: [
        { ...recipe.ingredients[1], quantity: 2, unit: "tsp" as const },
        {
          ...recipe.ingredients[1],
          quantity: 20,
          unit: "g" as const,
          form: "fresh",
        },
        { ...recipe.ingredients[0], quantity: 100, form: "cooked" },
      ],
    };
    const list = buildShoppingList(
      [
        { ...plan, servings: 2 },
        { ...plan, id: "p2", recipeId: "second", servings: 2 },
      ],
      [recipe, second],
      [
        {
          id: "pantry",
          updatedAt: 0,
          name: "Chicken breast",
          quantity: 150,
          unit: "g",
          form: "raw",
        },
      ],
    );
    expect(
      list.find((i) => i.name === "Chicken breast" && i.form === "raw")
        ?.quantity,
    ).toBe(250);
    expect(
      list.find((i) => i.name === "Chicken breast" && i.form === "cooked")
        ?.quantity,
    ).toBe(100);
    expect(
      list.find((i) => i.name === "Oregano" && i.form === "dried")?.quantity,
    ).toBe(30);
    expect(
      list.find((i) => i.name === "Oregano" && i.form === "fresh")?.quantity,
    ).toBe(20);
    const checked = { ...list[0], checked: true };
    expect(
      buildShoppingList([plan], [recipe], [], [checked]).find(
        (i) => i.id === checked.id,
      )?.checked,
    ).toBe(false);
  });
  it("uses Sydney calendar dates and calendar weeks around daylight saving", () => {
    expect(localDate(new Date("2026-10-10T14:00:00Z"))).toBe("2026-10-11");
    expect(weekDates("2026-10-11")).toEqual([
      "2026-10-05",
      "2026-10-06",
      "2026-10-07",
      "2026-10-08",
      "2026-10-09",
      "2026-10-10",
      "2026-10-11",
    ]);
  });
});
