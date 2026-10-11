import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { createActions, KitchenDB, readKitchen } from "../../src/lib/db";
import {
  buildShoppingList,
  effectiveRecipes,
  filterRecipes,
  recommendRecipes,
  scaleIngredients,
} from "../../src/lib/engine";
import { recipeSchema, type Recipe } from "../../src/lib/schema";
import { readFileSync } from "node:fs";
const fixture = recipeSchema.parse(
  JSON.parse(
    readFileSync(
      new URL("../../src/data/recipes-savoury.json", import.meta.url),
      "utf8",
    ),
  )[0],
);
const databases: KitchenDB[] = [];
afterEach(async () => {
  for (const database of databases) await database.delete();
  databases.length = 0;
});
const makeDB = () => {
  const database = new KitchenDB(`hardening-${crypto.randomUUID()}`);
  databases.push(database);
  return database;
};
describe("integration defect regressions", () => {
  it("rejects tiny serving denominators that would produce infinite scaled quantities", () => {
    const malformed = { ...fixture, servings: Number.MIN_VALUE };
    expect(recipeSchema.safeParse(malformed).success).toBe(false);
    expect(() => scaleIngredients(malformed, 2)).toThrow(
      "invalid serving count",
    );
    expect(
      scaleIngredients({ ...fixture, servings: 0.01 }, 100).every((item) =>
        Number.isFinite(item.quantity),
      ),
    ).toBe(true);
  });
  it("does not promote unsupported dietary or oil-free claims through overrides or custom imports", async () => {
    const data = await readKitchen(makeDB());
    const original: Recipe = { ...fixture, dietary: [], oilFree: false };
    data.overrides = [
      {
        id: original.id,
        updatedAt: 1,
        recipe: {
          ...original,
          dietary: ["vegan", "dairy-free"],
          oilFree: true,
        },
      },
    ];
    const applied = effectiveRecipes([original], data)[0];
    expect(applied.dietary).toEqual([]);
    expect(applied.oilFree).toBe(false);
    const custom: Recipe = {
      ...fixture,
      id: "custom-unverified-vegan",
      slug: "custom-unverified-vegan",
      dietary: ["vegan"],
    };
    data.preferences.dietary = ["vegan"];
    expect(recommendRecipes([applied, custom], data)).toEqual([]);
  });
  it("prevents an imported override from weakening original allergen or temperature safety", async () => {
    const data = await readKitchen(makeDB());
    const original: Recipe = {
      ...fixture,
      allergens: ["milk"],
      internalTempC: 74,
      safety: ["Original important warning"],
    };
    data.overrides = [
      {
        id: original.id,
        updatedAt: 1,
        recipe: {
          ...original,
          allergens: [],
          internalTempC: null,
          safety: [],
          cookMinutes: 1,
          temperatureC: 100,
        },
      },
    ];
    const applied = effectiveRecipes([original], data)[0];
    expect(applied.allergens).toEqual(["milk"]);
    expect(applied.internalTempC).toBe(74);
    expect(applied.safety).toContain("Original important warning");
    data.preferences.allergens = ["milk"];
    expect(recommendRecipes([applied], data)).toEqual([]);
  });
  it("does not recommend undeclared allergens in an unverified custom recipe", async () => {
    const database = makeDB();
    const data = await readKitchen(database);
    data.preferences.allergens = ["peanut"];
    const custom: Recipe = {
      ...fixture,
      id: "custom-peanut",
      slug: "custom-peanut",
      title: "Peanut bites",
      allergens: [],
      ingredients: [{ ...fixture.ingredients[0], name: "Peanut butter" }],
    };
    for (const mode of [
      "tonight",
      "new",
      "favourites",
      "pantry",
      "fast",
      "surprise",
    ] as const)
      expect(recommendRecipes([custom], data, mode)).toEqual([]);
    expect(filterRecipes([custom], { excludeAllergens: ["peanut"] })).toEqual(
      [],
    );
    expect(filterRecipes([custom], {})).toHaveLength(1);
  });
  it("resets purchase ticks when generated quantity changes, then allows one-click rechecking", async () => {
    const database = makeDB();
    const recipe = {
      ...fixture,
      servings: 1,
      ingredients: [
        { ...fixture.ingredients[0], quantity: 200, unit: "g" as const },
      ],
    };
    const plan = {
      id: "plan",
      updatedAt: 0,
      recipeId: recipe.id,
      date: "2026-10-11",
      slot: "dinner" as const,
      servings: 1,
    };
    const first = buildShoppingList([plan], [recipe]);
    const checked = { ...first[0], checked: true };
    await createActions(database).saveShopping(checked);
    expect(buildShoppingList([plan], [recipe], [], [checked])[0].checked).toBe(
      true,
    );
    const changed = buildShoppingList(
      [{ ...plan, servings: 2 }],
      [recipe],
      [],
      [checked],
    )[0];
    expect(changed.quantity).toBe(400);
    expect(changed.checked).toBe(false);
    await createActions(database).saveShopping({ ...changed, checked: true });
    expect((await database.shopping.get(changed.id))?.checked).toBe(true);
  });
  it("rolls back session save if the accompanying tried state write fails", async () => {
    const database = makeDB();
    const actions = createActions(database);
    const input = {
      recipeId: fixture.id,
      date: "2026-10-11",
      servingsPrepared: 2,
      servingsConsumed: 1,
      rating: 5,
      actualMinutes: null,
      ingredientChanges: "",
      temperatureC: null,
      timeChanges: "",
      notes: "Keep exactly once",
      wouldCookAgain: true,
    };
    const fail = () => {
      throw new Error("Simulated state write failure");
    };
    database.recipeStates.hook("creating", fail);
    await expect(actions.saveCookingSession(input)).rejects.toThrow(
      "Simulated",
    );
    expect(await database.sessions.count()).toBe(0);
    expect(await database.recipeStates.count()).toBe(0);
    database.recipeStates.hook("creating").unsubscribe(fail);
    await actions.saveCookingSession(input);
    expect(await database.sessions.count()).toBe(1);
    expect(await database.recipeStates.get(fixture.id)).toMatchObject({
      tried: true,
      rating: 5,
    });
  });
  it("only an explicit completed cook clears matching active activity; journal edits and other recipes survive", async () => {
    const database = makeDB();
    const actions = createActions(database);
    const input = {
      id: "session",
      recipeId: fixture.id,
      date: "2026-10-11",
      servingsPrepared: 2,
      servingsConsumed: 1,
      rating: null,
      actualMinutes: null,
      ingredientChanges: "",
      temperatureC: null,
      timeChanges: "",
      notes: "",
      wouldCookAgain: null,
    };
    await actions.patchActiveCooking(fixture.id, {
      timerEndsAt: Date.now() + 60000,
    });
    await actions.saveCookingSession(input);
    expect((await database.activeCooking.get("active"))?.recipeId).toBe(
      fixture.id,
    );
    await actions.saveCookingSession(input, true);
    expect(await database.activeCooking.get("active")).toBeUndefined();
    await actions.patchActiveCooking("another-recipe", {
      timerEndsAt: Date.now() + 60000,
    });
    await actions.saveCookingSession(input, true);
    expect((await database.activeCooking.get("active"))?.recipeId).toBe(
      "another-recipe",
    );
    expect(await database.sessions.count()).toBe(1);
  });
  it("merges simultaneous checkbox and timer edits across database instances", async () => {
    const database = makeDB();
    const other = new KitchenDB(database.name);
    const a = createActions(database);
    const b = createActions(other);
    // These ticks belong to an active cook, so the cook starts first.
    await a.startCooking(fixture.id, 3, null);
    await Promise.all([
      a.setCookingCheck(fixture.id, "ingredient", 0, true, 3),
      b.setCookingCheck(fixture.id, "ingredient", 1, true, 3),
      a.setCookingCheck(fixture.id, "step", 0, true, 3),
      b.patchActiveCooking(fixture.id, { timerEndsAt: 2000000000000 }, 3),
    ]);
    expect(await database.activeCooking.get("active")).toMatchObject({
      checkedIngredients: [0, 1],
      checkedSteps: [0],
      timerEndsAt: 2000000000000,
      servings: 3,
    });
    await a.setCookingCheck(fixture.id, "ingredient", 0, false);
    expect(
      (await database.activeCooking.get("active"))?.checkedIngredients,
    ).toEqual([1]);
    other.close();
  });
  it("offers stable category variety and no protein bonus past the target", async () => {
    const data = await readKitchen(makeDB());
    const base = {
      ...fixture,
      totalMinutes: 20,
      prepMinutes: 5,
      cookMinutes: 15,
      nutrition: { ...fixture.nutrition, protein: 30 },
    };
    const recipes = [
      { ...base, id: "a", slug: "a", category: "chicken-turkey" as const },
      { ...base, id: "b", slug: "b", category: "chicken-turkey" as const },
      { ...base, id: "c", slug: "c", category: "vegetarian" as const },
    ];
    expect(
      recommendRecipes(recipes, data).map((item) => item.recipe.id),
    ).toEqual(["a", "c", "b"]);
    const huge = {
      ...base,
      id: "huge",
      slug: "huge",
      nutrition: { ...base.nutrition, protein: 150 },
    };
    expect(recommendRecipes([base], data)[0].score).toBe(
      recommendRecipes([huge], data)[0].score,
    );
    const quick = { ...base, id: "quick", slug: "quick", totalMinutes: 16 };
    expect(recommendRecipes([base, quick], data)[0].recipe.id).toBe("quick");
  });
});
