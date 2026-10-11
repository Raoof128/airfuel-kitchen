import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { KitchenDB, createActions, readKitchen } from "../../src/lib/db";

let database: KitchenDB;
beforeEach(() => {
  database = new KitchenDB(`test-${crypto.randomUUID()}`);
});
afterEach(async () => {
  await database.delete();
});

const session = (id: string, rating: number | null) => ({
  id,
  recipeId: "chicken",
  date: "2026-10-11",
  servingsPrepared: 2,
  servingsConsumed: 2,
  rating,
  actualMinutes: null,
  ingredientChanges: "",
  temperatureC: null,
  timeChanges: "",
  notes: "",
  wouldCookAgain: null,
});

describe("cooking session rating and recipe rating", () => {
  it("a session rating sets the recipe rating", async () => {
    const actions = createActions(database);
    await actions.saveCookingSession(session("s1", 4));
    const kitchen = await readKitchen(database);
    expect(kitchen.recipeStates[0]?.rating).toBe(4);
  });

  it("clearing a session rating keeps the recipe rating, so a rating set elsewhere is never erased by editing a journal entry", async () => {
    const actions = createActions(database);
    await actions.patchRecipeState("chicken", { rating: 5 });
    await actions.saveCookingSession(session("s1", null));
    const kitchen = await readKitchen(database);
    expect(kitchen.sessions[0]?.rating).toBeNull();
    expect(kitchen.recipeStates[0]?.rating).toBe(5);
  });
});
