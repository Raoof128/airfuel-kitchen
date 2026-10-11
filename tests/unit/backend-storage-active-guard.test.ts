import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterEach, describe, expect, it } from "vitest";
import { createActions, KitchenDB } from "../../src/lib/db";

const databases: KitchenDB[] = [];
afterEach(async () => {
  for (const database of databases.splice(0)) {
    database.close();
    await Dexie.delete(database.name);
  }
});

const cook = (recipeId: string) => ({
  recipeId,
  servings: 2,
  checkedIngredients: [0],
  checkedSteps: [],
  timerEndsAt: null,
  timerRemainingSeconds: 0,
});

describe("saveActiveCooking conflict guard", () => {
  it("without an expected recipe it keeps the old unguarded seeding behaviour", async () => {
    const name = `active-guard-${crypto.randomUUID()}`;
    const db = new KitchenDB(name);
    databases.push(db);
    const actions = createActions(db);
    await actions.saveActiveCooking(cook("toast"));
    expect((await db.activeCooking.get("active"))?.recipeId).toBe("toast");
  });

  it("refuses to replace a cook another tab started, and keeps that cook", async () => {
    const name = `active-guard-${crypto.randomUUID()}`;
    const tabA = new KitchenDB(name);
    const tabB = new KitchenDB(name);
    databases.push(tabA, tabB);
    await createActions(tabB).startCooking("soup", 2, null);
    // Tab A last saw an empty slot, so its write must not replace tab B's cook.
    await expect(
      createActions(tabA).saveActiveCooking(cook("toast"), null),
    ).rejects.toThrow("Cooking changed in another tab");
    expect((await tabA.activeCooking.get("active"))?.recipeId).toBe("soup");
  });

  it("refuses a clear when the expected recipe no longer matches", async () => {
    const name = `active-guard-${crypto.randomUUID()}`;
    const tabA = new KitchenDB(name);
    const tabB = new KitchenDB(name);
    databases.push(tabA, tabB);
    await createActions(tabB).startCooking("soup", 2, null);
    await expect(
      createActions(tabA).saveActiveCooking(null, "toast"),
    ).rejects.toThrow("Cooking changed in another tab");
    expect((await tabA.activeCooking.get("active"))?.recipeId).toBe("soup");
  });

  it("allows the write when the expected recipe matches the stored one", async () => {
    const name = `active-guard-${crypto.randomUUID()}`;
    const db = new KitchenDB(name);
    databases.push(db);
    const actions = createActions(db);
    await actions.startCooking("soup", 2, null);
    await actions.saveActiveCooking(cook("soup"), "soup");
    await actions.saveActiveCooking(null, "soup");
    expect(await db.activeCooking.get("active")).toBeUndefined();
  });
});
