import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import {
  createActions,
  exportBackup,
  importBackup,
  KitchenDB,
  previewImport,
  readKitchen,
} from "../../src/lib/db";
import { type Recipe } from "../../src/lib/schema";
const databases: KitchenDB[] = [];
afterEach(async () => {
  for (const database of databases) await database.delete();
  databases.length = 0;
});
const makeDB = () => {
  const database = new KitchenDB(`full-${crypto.randomUUID()}`);
  databases.push(database);
  return database;
};
const custom: Recipe = {
  id: "custom-toast",
  slug: "custom-toast",
  title: "Custom toast",
  description: "Personal toast recipe",
  category: "breakfast",
  tags: [],
  sources: [
    {
      title: "Personal recipe source",
      url: "https://example.org/toast",
      verifiedAt: "2026-10-11",
    },
  ],
  prepMinutes: 1,
  cookMinutes: 5,
  totalMinutes: 6,
  temperatureC: 180,
  servings: 1,
  portion: "One slice",
  ingredients: [
    {
      name: "Bread",
      quantity: 1,
      unit: "each",
      form: "fresh",
      preparation: "",
      aisle: "Bakery",
    },
  ],
  steps: ["Toast and check for doneness."],
  preheat: false,
  preheatMinutes: 0,
  turn: "Turn halfway",
  safety: ["Keep clear of heating element"],
  internalTempC: null,
  nutrition: {
    protein: 3,
    calories: 100,
    carbs: 20,
    fat: 1,
    fibre: 1,
    method: "Package estimate",
    confidence: "estimated",
    reference: "Bread label",
  },
  allergens: ["wheat", "gluten"],
  dietary: [],
  substitutions: [],
  oilFree: true,
  storage: "Eat freshly toasted",
  equipment: ["Air fryer"],
  difficulty: "Easy",
  image: {
    src: "/images/breakfast.webp",
    alt: "Toast illustration",
    credit: "AirFuel Kitchen",
    licence: "AI-generated illustration; not a photograph of the tested recipe",
  },
};
describe("all personal data", () => {
  it("exports and restores every user-owned table and active timer", async () => {
    const original = makeDB();
    const restored = makeDB();
    const actions = createActions(original);
    await actions.patchRecipeState(custom.id, {
      tried: true,
      rating: 4,
      notes: "Less time next time",
      favourite: true,
    });
    await actions.saveSession({
      recipeId: custom.id,
      date: "2026-10-11",
      servingsPrepared: 2,
      servingsConsumed: 1,
      rating: 4,
      actualMinutes: 7,
      ingredientChanges: "Wholemeal bread",
      temperatureC: 170,
      timeChanges: "One extra minute",
      notes: "Good",
      wouldCookAgain: true,
    });
    await actions.savePlan({
      recipeId: custom.id,
      date: "2026-10-12",
      slot: "breakfast",
      servings: 2,
    });
    await actions.savePantry({
      name: "Bread",
      quantity: 10,
      unit: "each",
      form: "fresh",
    });
    await actions.saveShopping({
      name: "Eggs",
      quantity: 12,
      unit: "each",
      form: "raw",
      aisle: "Dairy and eggs",
      checked: true,
      manual: true,
    });
    await actions.savePreferences({
      name: "Test cook",
      allergens: ["peanut"],
      theme: "dark",
    });
    await actions.saveCustomRecipe(custom);
    await actions.saveOverride(
      custom.id,
      { title: "My favourite toast" },
      custom,
    );
    await actions.saveActiveCooking({
      recipeId: custom.id,
      servings: 2,
      checkedIngredients: [0],
      checkedSteps: [],
      timerEndsAt: Date.now() + 60000,
      timerRemainingSeconds: 60,
    });
    const text = await exportBackup(original);
    const preview = await previewImport(text, restored);
    expect(preview.added).toBe(9);
    await importBackup(preview, "replace", restored);
    expect(await readKitchen(restored)).toEqual(await readKitchen(original));
    await actions.clearUserData();
    const empty = await readKitchen(original);
    expect(empty.sessions).toEqual([]);
    expect(empty.customRecipes).toEqual([]);
    expect(empty.activeCooking).toBeUndefined();
    expect((await readKitchen(restored)).sessions).toHaveLength(1);
  });
  it("does not permit canonical IDs for custom recipes", async () => {
    const database = makeDB();
    await expect(
      createActions(database).saveCustomRecipe({
        ...custom,
        id: "catalogue-toast",
        slug: "catalogue-toast",
      }),
    ).rejects.toThrow();
    expect(await database.customRecipes.count()).toBe(0);
  });
});
