import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  consumedNutrition,
  effectiveRecipes,
  buildShoppingList,
  plannedNutrition,
} from "../../src/lib/engine";
import { createActions, KitchenDB, readKitchen } from "../../src/lib/db";
import { catalogue } from "../../src/data/catalogue";
import {
  defaultPreferences,
  type KitchenData,
  type Recipe,
} from "../../src/lib/schema";

const databases: KitchenDB[] = [];
const extraConnections: KitchenDB[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const connection of extraConnections.splice(0)) connection.close();
  for (const database of databases.splice(0)) {
    database.close();
    await Dexie.delete(database.name);
  }
});
// Two KitchenDB instances on one name behave like two browser tabs sharing IndexedDB.
function openTabs(count = 1) {
  const name = `invariants-${crypto.randomUUID()}`;
  const first = new KitchenDB(name);
  databases.push(first);
  const tabs = [first];
  for (let index = 1; index < count; index++) {
    const tab = new KitchenDB(name);
    extraConnections.push(tab);
    tabs.push(tab);
  }
  return tabs;
}

const custom = (id = "custom-toast"): Recipe => ({
  id,
  slug: id,
  title: "Custom toast",
  description: "Personal toast",
  category: "breakfast",
  tags: [],
  sources: [
    { title: "Source", url: "https://example.com/t", verifiedAt: "2026-10-01" },
  ],
  prepMinutes: 1,
  cookMinutes: 4,
  totalMinutes: 5,
  temperatureC: 180,
  servings: 1,
  portion: "1 slice",
  ingredients: [
    {
      name: "Bread",
      quantity: 1,
      unit: "each",
      preparation: "",
      form: "sliced",
      aisle: "Bakery",
    },
  ],
  steps: ["Toast."],
  preheat: false,
  preheatMinutes: 0,
  turn: "",
  safety: [],
  internalTempC: null,
  nutrition: {
    protein: 4,
    calories: 90,
    carbs: 16,
    fat: 1,
    fibre: 2,
    method: "Label",
    confidence: "estimated",
    reference: "Label",
  },
  allergens: ["wheat", "gluten"],
  dietary: [],
  substitutions: [],
  oilFree: true,
  storage: "",
  equipment: [],
  difficulty: "Easy",
  image: {
    src: "/images/toast.webp",
    alt: "Toast",
    credit: "Own photo",
    licence: "Own work",
  },
});

const sessionInput = (overrides: Record<string, unknown> = {}) => ({
  recipeId: "toast",
  date: "2026-10-01",
  servingsPrepared: 2,
  servingsConsumed: 0,
  rating: null,
  actualMinutes: null,
  ingredientChanges: "",
  temperatureC: null,
  timeChanges: "",
  notes: "",
  wouldCookAgain: null,
  ...overrides,
});

describe("smart-memory invariants", () => {
  it("opening a recipe does not mark it tried", async () => {
    const [db] = openTabs();
    const actions = createActions(db);
    await actions.patchRecipeState("toast", { viewedAt: Date.now() });
    await actions.patchRecipeState("toast", { viewedAt: Date.now() + 1 });
    const state = await db.recipeStates.get("toast");
    expect(state).toMatchObject({ tried: false, triedAt: null });
    expect(state?.viewedAt).not.toBeNull();
  });

  it("tried persists across reopen, and undo clears it and its timestamp", async () => {
    const [db] = openTabs();
    const actions = createActions(db);
    await actions.patchRecipeState("toast", { tried: true });
    const triedAt = (await db.recipeStates.get("toast"))!.triedAt;
    expect(triedAt).not.toBeNull();
    db.close();
    const reopened = new KitchenDB(db.name);
    extraConnections.push(reopened);
    expect(await reopened.recipeStates.get("toast")).toMatchObject({
      tried: true,
      triedAt,
    });
    const again = createActions(reopened);
    await again.patchRecipeState("toast", { tried: false });
    expect(await reopened.recipeStates.get("toast")).toMatchObject({
      tried: false,
      triedAt: null,
    });
    await again.patchRecipeState("toast", { tried: true });
    expect((await reopened.recipeStates.get("toast"))!.triedAt).toBeGreaterThan(
      triedAt!,
    );
  });

  it("cooking the same recipe twice creates two distinct sessions and keeps both", async () => {
    const [db] = openTabs();
    const actions = createActions(db);
    const first = await actions.saveCookingSession(
      sessionInput({ servingsConsumed: 1, notes: "first" }),
    );
    const second = await actions.saveCookingSession(
      sessionInput({ servingsConsumed: 2, notes: "second" }),
    );
    expect(first).not.toBe(second);
    const rows = await db.sessions.where("recipeId").equals("toast").toArray();
    expect(rows.map((row) => row.notes).sort()).toEqual(["first", "second"]);
  });

  it("a session rating sets the recipe rating, and clearing the session keeps it", async () => {
    const [db] = openTabs();
    const actions = createActions(db);
    const id = await actions.saveSession(sessionInput({ rating: 4 }));
    expect((await db.recipeStates.get("toast"))?.rating).toBeUndefined();
    await actions.saveCookingSession(sessionInput({ id, rating: 4 }));
    expect((await db.recipeStates.get("toast"))?.rating).toBe(4);
    await actions.saveCookingSession(sessionInput({ id, rating: null }));
    expect((await db.recipeStates.get("toast"))?.rating).toBe(4);
    await actions.patchRecipeState("toast", { rating: null });
    expect((await db.recipeStates.get("toast"))?.rating).toBeNull();
  });

  it("editing a note does not overwrite tried, favourite or rating", async () => {
    const [db] = openTabs();
    const actions = createActions(db);
    await actions.patchRecipeState("toast", {
      tried: true,
      favourite: true,
      rating: 5,
    });
    const before = await db.recipeStates.get("toast");
    await actions.saveRecipeNotes("toast", "New note", "");
    const after = await db.recipeStates.get("toast");
    expect(after).toMatchObject({
      tried: true,
      favourite: true,
      rating: 5,
      notes: "New note",
      triedAt: before!.triedAt,
    });
  });

  it("deleting one session keeps the recipe state and every other session", async () => {
    const [db] = openTabs();
    const actions = createActions(db);
    await actions.patchRecipeState("toast", { tried: true, rating: 3 });
    const keep = await actions.saveSession(sessionInput({ notes: "keep" }));
    const drop = await actions.saveSession(sessionInput({ notes: "drop" }));
    await actions.deleteSession(drop);
    expect(await db.sessions.get(keep)).toMatchObject({ notes: "keep" });
    expect(await db.sessions.get(drop)).toBeUndefined();
    expect(await db.recipeStates.get("toast")).toMatchObject({
      tried: true,
      rating: 3,
    });
  });

  it("tried is not consumed: a cook with no eaten servings adds no protein", async () => {
    const [db] = openTabs();
    const actions = createActions(db);
    const recipe = catalogue[0]!;
    await actions.saveCookingSession(
      sessionInput({ recipeId: recipe.id, servingsConsumed: 0 }),
    );
    const data = await readKitchen(db);
    expect(data.recipeStates.find((row) => row.id === recipe.id)?.tried).toBe(
      true,
    );
    expect(consumedNutrition(data.sessions, [recipe]).protein).toBe(0);
    await actions.saveCookingSession(
      sessionInput({ recipeId: recipe.id, servingsConsumed: 1 }),
    );
    const withEaten = consumedNutrition((await readKitchen(db)).sessions, [
      recipe,
    ]);
    expect(withEaten.protein).toBeCloseTo(recipe.nutrition.protein, 5);
  });

  it("rapid toggles from two tabs converge to the parity of the number of presses", async () => {
    const [a, b] = openTabs(2);
    const left = createActions(a);
    const right = createActions(b);
    await Promise.all(
      Array.from({ length: 31 }, (_, index) =>
        (index % 2 ? right : left).toggleRecipeState("toast", "favourite"),
      ),
    );
    expect((await a.recipeStates.get("toast"))?.favourite).toBe(true);
    // 31 presses then 29 more is 60 in total: an even count must end back at false.
    await Promise.all(
      Array.from({ length: 29 }, (_, index) =>
        (index % 2 ? right : left).toggleRecipeState("toast", "favourite"),
      ),
    );
    expect((await b.recipeStates.get("toast"))?.favourite).toBe(false);
  });

  it("two stale tabs saving notes: exactly one write wins, the other is refused and nothing is merged", async () => {
    const [a, b] = openTabs(2);
    const seen = "";
    const results = await Promise.allSettled([
      createActions(a).saveRecipeNotes("toast", "from tab A", seen),
      createActions(b).saveRecipeNotes("toast", "from tab B", seen),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([
      "fulfilled",
      "rejected",
    ]);
    const rejected = results.find(
      (result) => result.status === "rejected",
    ) as PromiseRejectedResult;
    expect(String(rejected.reason.message)).toMatch(/saved in another tab/);
    const stored = (await a.recipeStates.get("toast"))?.notes;
    expect(["from tab A", "from tab B"]).toContain(stored);
  });

  it("an update that restarts the clock still produces a strictly newer updatedAt", async () => {
    const [db] = openTabs();
    const actions = createActions(db);
    await actions.patchRecipeState("toast", { favourite: true });
    const first = (await db.recipeStates.get("toast"))!.updatedAt;
    const clock = vi.spyOn(Date, "now").mockReturnValue(first - 5_000);
    await actions.patchRecipeState("toast", { favourite: false });
    clock.mockRestore();
    expect((await db.recipeStates.get("toast"))!.updatedAt).toBeGreaterThan(
      first,
    );
  });
});

describe("write failures are never reported as success", () => {
  it("a quota error on a memory write rejects with a readable message and writes nothing", async () => {
    const [db] = openTabs();
    const actions = createActions(db);
    const quota = Object.assign(new Error("The quota has been exceeded."), {
      name: "QuotaExceededError",
    });
    vi.spyOn(db.recipeStates, "put").mockRejectedValueOnce(quota);
    await expect(
      actions.patchRecipeState("toast", { favourite: true }),
    ).rejects.toThrow("This browser has no free storage left");
    expect(await db.recipeStates.get("toast")).toBeUndefined();
  });

  it("a quota error while cooking-session save rolls back the session AND the tried flag", async () => {
    const [db] = openTabs();
    const actions = createActions(db);
    vi.spyOn(db.recipeStates, "put").mockRejectedValueOnce(
      Object.assign(new Error("quota"), { name: "QuotaExceededError" }),
    );
    await expect(
      actions.saveCookingSession(sessionInput({ servingsConsumed: 1 })),
    ).rejects.toThrow("This browser has no free storage left");
    expect(await db.sessions.count()).toBe(0);
    expect(await db.recipeStates.get("toast")).toBeUndefined();
  });

  it("a validation error is rejected once with a readable sentence and never reaches storage", async () => {
    const [db] = openTabs();
    const actions = createActions(db);
    const put = vi.spyOn(db.recipeStates, "put");
    const error = await actions
      .patchRecipeState("toast", { rating: 9 as unknown as number })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(
      "Some details are not valid. Check the highlighted fields and try again.",
    );
    expect(put).not.toHaveBeenCalled();
  });
});

describe("catalogue changes and referential integrity", () => {
  it("personal records for a recipe that disappears from the catalogue survive untouched", async () => {
    const [db] = openTabs();
    const actions = createActions(db);
    await actions.patchRecipeState("gone-recipe", {
      tried: true,
      rating: 4,
      notes: "keep",
    });
    await actions.saveSession(
      sessionInput({ recipeId: "gone-recipe", servingsConsumed: 2 }),
    );
    await actions.savePlan({
      recipeId: "gone-recipe",
      date: "2026-10-02",
      slot: "dinner",
      servings: 2,
    });
    const before = await readKitchen(db);
    // A catalogue update that drops the recipe changes nothing in the store.
    const recipes = effectiveRecipes(catalogue, before);
    expect(recipes.some((recipe) => recipe.id === "gone-recipe")).toBe(false);
    const after = await readKitchen(db);
    expect(after.recipeStates).toEqual(before.recipeStates);
    expect(after.sessions).toEqual(before.sessions);
    expect(after.plans).toEqual(before.plans);
  });

  it("nutrition counts a session for a missing recipe as missing, not as zero protein", () => {
    const data: KitchenData = {
      recipeStates: [],
      sessions: [
        {
          id: "s",
          updatedAt: 1,
          recipeId: "gone-recipe",
          date: "2026-10-01",
          servingsPrepared: 2,
          servingsConsumed: 2,
          rating: null,
          actualMinutes: null,
          ingredientChanges: "",
          temperatureC: null,
          timeChanges: "",
          notes: "",
          wouldCookAgain: null,
        },
      ],
      plans: [],
      pantry: [],
      shopping: [],
      customRecipes: [],
      overrides: [],
      preferences: defaultPreferences,
      activeCooking: undefined,
    };
    const totals = consumedNutrition(data.sessions, catalogue);
    expect(totals.missingRecipes).toBe(1);
    expect(totals.protein).toBe(0);
  });

  it("a plan that points at a missing recipe is skipped by the shopping list without throwing", () => {
    const list = buildShoppingList(
      [
        {
          id: "p",
          updatedAt: 1,
          recipeId: "gone-recipe",
          date: "2026-10-02",
          slot: "dinner",
          servings: 2,
        },
      ],
      catalogue,
    );
    expect(list).toEqual([]);
  });

  it("deleting a custom recipe keeps its cooking history but leaves its memory and plans behind", async () => {
    const [db] = openTabs();
    const actions = createActions(db);
    await actions.saveCustomRecipe(custom("custom-toast"));
    await actions.patchRecipeState("custom-toast", { tried: true });
    await actions.saveCookingSession(
      sessionInput({ recipeId: "custom-toast", servingsConsumed: 1 }),
    );
    await actions.savePlan({
      recipeId: "custom-toast",
      date: "2026-10-02",
      slot: "breakfast",
      servings: 2,
    });
    await actions.deleteCustomRecipe("custom-toast");
    expect(await db.customRecipes.get("custom-toast")).toBeUndefined();
    // Documented decision: history is kept; orphaned rows are not cascaded, so no
    // personal activity disappears on a catalogue or custom-recipe delete.
    expect(await db.sessions.count()).toBe(1);
    expect(await db.recipeStates.get("custom-toast")).toMatchObject({
      tried: true,
    });
    expect(await db.plans.count()).toBe(1);
  });

  it("an override freezes a full copy of the recipe, so a later catalogue correction does not reach it", async () => {
    const [db] = openTabs();
    const actions = createActions(db);
    const base = catalogue[0]!;
    await actions.saveOverride(base.id, { title: "My version" }, base);
    const overrides = await db.overrides.toArray();
    const corrected: Recipe = {
      ...base,
      steps: [...base.steps, "A corrected step added to the catalogue."],
    };
    const merged = effectiveRecipes([corrected], {
      recipeStates: [],
      sessions: [],
      plans: [],
      pantry: [],
      shopping: [],
      customRecipes: [],
      overrides,
      preferences: defaultPreferences,
      activeCooking: undefined,
    }).find((recipe) => recipe.id === base.id)!;
    // Known limitation, reported as a decision: the override keeps the old step list.
    expect(merged.steps).toEqual(base.steps);
    expect(merged.steps).not.toContain(
      "A corrected step added to the catalogue.",
    );
  });

  it("timestamps stay monotonic per record, so later edits always win a merge", async () => {
    const [db] = openTabs();
    const actions = createActions(db);
    await actions.savePantry({
      name: "Salt",
      quantity: 1,
      unit: "tsp",
      form: "fine",
    });
    const id = (await db.pantry.toArray())[0]!.id;
    const stamps: number[] = [];
    for (let index = 0; index < 5; index++) {
      await actions.savePantry({
        id,
        name: "Salt",
        quantity: index + 1,
        unit: "tsp",
        form: "fine",
      });
      stamps.push((await db.pantry.get(id))!.updatedAt);
    }
    expect(stamps).toEqual([...stamps].sort((a, b) => a - b));
    expect(new Set(stamps).size).toBe(stamps.length);
  });

  it("plannedNutrition only counts what is planned, never tried or rated state", () => {
    const totals = plannedNutrition([], catalogue);
    expect(totals.protein).toBe(0);
  });
});
