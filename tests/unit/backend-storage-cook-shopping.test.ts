import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createActions,
  exportBackup,
  importBackup,
  KitchenDB,
  previewImport,
} from "../../src/lib/db";

const databases: KitchenDB[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const database of databases.splice(0)) {
    database.close();
    await Dexie.delete(database.name);
  }
});
const makeDB = (name = `cs-${crypto.randomUUID()}`) => {
  const database = new KitchenDB(name);
  databases.push(database);
  return database;
};
const cook = (recipeId: string, extra: Record<string, unknown> = {}) => ({
  recipeId,
  servings: 2,
  checkedIngredients: [],
  checkedSteps: [],
  timerEndsAt: null,
  timerRemainingSeconds: 0,
  ...extra,
});

describe("ARCH-3: ticking with nothing cooking does not start a cook", () => {
  it("setCookingCheck with no active cook throws and writes no activeCooking row", async () => {
    const database = makeDB();
    const actions = createActions(database);
    await expect(
      actions.setCookingCheck("chicken", "ingredient", 0, true, 2, null),
    ).rejects.toThrow("Start cooking this recipe before ticking");
    expect(await database.activeCooking.get("active")).toBeUndefined();
    // Starting another recipe afterwards is not blocked by the failed tick.
    await expect(
      actions.startCooking("soup", 2, null),
    ).resolves.toBeUndefined();
    expect((await database.activeCooking.get("active"))?.recipeId).toBe("soup");
  });

  it("ticks work once the recipe is cooking, and persist across reopen", async () => {
    const name = `cs-tick-${crypto.randomUUID()}`;
    const database = makeDB(name);
    const actions = createActions(database);
    await actions.startCooking("chicken", 2, null);
    await actions.setCookingCheck(
      "chicken",
      "ingredient",
      1,
      true,
      2,
      "chicken",
    );
    await actions.setCookingCheck("chicken", "step", 0, true, 2, "chicken");
    database.close();
    const reopened = makeDB(name);
    expect(await reopened.activeCooking.get("active")).toMatchObject({
      recipeId: "chicken",
      checkedIngredients: [1],
      checkedSteps: [0],
    });
  });

  it("a tick on another recipe while one is cooking still gets the existing refusal", async () => {
    const database = makeDB();
    const actions = createActions(database);
    await actions.startCooking("soup", 2, null);
    await expect(
      actions.setCookingCheck("chicken", "step", 0, true, 2, "soup"),
    ).rejects.toThrow("Another recipe is already cooking");
    expect((await database.activeCooking.get("active"))?.recipeId).toBe("soup");
  });

  it("a tick for a cook that has since finished reports the conflict, not a fresh start", async () => {
    const database = makeDB();
    const actions = createActions(database);
    await actions.startCooking("chicken", 2, null);
    await actions.stopCooking("chicken");
    await expect(
      actions.setCookingCheck("chicken", "step", 0, true, 2, "chicken"),
    ).rejects.toThrow("Cooking changed");
    expect(await database.activeCooking.get("active")).toBeUndefined();
  });
});

describe("ARCH-4: a merge keeps the local active cook", () => {
  async function backupWithCook(recipeId: string, updatedAt: number) {
    const source = makeDB();
    await source.activeCooking.put({
      id: "active",
      updatedAt,
      ...cook(recipeId, { checkedIngredients: [3] }),
    });
    return exportBackup(source);
  }

  it("a later cook for a different recipe does not replace the local one", async () => {
    const local = makeDB();
    await createActions(local).startCooking("chicken-tikka", 2, null);
    const text = await backupWithCook("salmon-bake", Date.now() + 100000);
    await importBackup(await previewImport(text, local), "merge", local);
    expect((await local.activeCooking.get("active"))?.recipeId).toBe(
      "chicken-tikka",
    );
  });

  it("with nothing cooking locally, the incoming cook is taken", async () => {
    const local = makeDB();
    const text = await backupWithCook("salmon-bake", Date.now() + 100000);
    await importBackup(await previewImport(text, local), "merge", local);
    expect((await local.activeCooking.get("active"))?.recipeId).toBe(
      "salmon-bake",
    );
  });

  it("for the same recipe, a newer incoming timer and checklist update the local cook", async () => {
    const local = makeDB();
    await createActions(local).startCooking("chicken-tikka", 2, null);
    const text = await (async () => {
      const source = makeDB();
      await source.activeCooking.put({
        id: "active",
        updatedAt: Date.now() + 100000,
        ...cook("chicken-tikka", {
          checkedIngredients: [3],
          timerEndsAt: 2000000000000,
          timerRemainingSeconds: 30,
        }),
      });
      return exportBackup(source);
    })();
    await importBackup(await previewImport(text, local), "merge", local);
    expect(await local.activeCooking.get("active")).toMatchObject({
      recipeId: "chicken-tikka",
      checkedIngredients: [3],
      timerEndsAt: 2000000000000,
    });
  });

  it("replace still takes the backup's cook, since replace is an explicit overwrite", async () => {
    const local = makeDB();
    await createActions(local).startCooking("chicken-tikka", 2, null);
    const text = await backupWithCook("salmon-bake", 1);
    await importBackup(await previewImport(text, local), "replace", local);
    expect((await local.activeCooking.get("active"))?.recipeId).toBe(
      "salmon-bake",
    );
  });
});

describe("ARCH-12: batch shopping writes are one transaction", () => {
  const item = (name: string, extra: Record<string, unknown> = {}) => ({
    name,
    quantity: 100,
    unit: "g" as const,
    form: "fresh",
    aisle: "Produce",
    checked: false,
    manual: true,
    ...extra,
  });

  it("saveShoppingBatch writes every row and returns their ids", async () => {
    const database = makeDB();
    const ids = await createActions(database).saveShoppingBatch([
      item("Rice"),
      item("Lime"),
      item("Chilli"),
    ]);
    expect(ids).toHaveLength(3);
    expect(await database.shopping.count()).toBe(3);
  });

  it("one invalid row in a batch writes nothing", async () => {
    const database = makeDB();
    const actions = createActions(database);
    await actions.saveShopping(item("Existing"));
    await expect(
      actions.saveShoppingBatch([
        item("Rice"),
        item("Lime"),
        { ...item("Bad"), quantity: -1 },
      ]),
    ).rejects.toThrow("Some details are not valid");
    expect((await database.shopping.toArray()).map((row) => row.name)).toEqual([
      "Existing",
    ]);
  });

  it("a storage failure partway through writes nothing", async () => {
    const database = makeDB();
    const actions = createActions(database);
    // save() reaches the table through database.table(name), so the failure is injected there.
    const realTable = database.table.bind(database);
    let puts = 0;
    vi.spyOn(database, "table").mockImplementation((name: string) => {
      const table = realTable(name);
      if (name !== "shopping") return table;
      return new Proxy(table, {
        get(target, prop) {
          if (prop === "put")
            return async (row: unknown) => {
              if (++puts === 2) throw new Error("disk full mid-batch");
              return target.put(row as never);
            };
          const value = Reflect.get(target, prop);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    });
    await expect(
      actions.saveShoppingBatch([item("A"), item("B"), item("C")]),
    ).rejects.toThrow("disk full mid-batch");
    expect(puts).toBe(2);
    expect(await database.shopping.count()).toBe(0);
  });

  it("a changed manual item is unticked in the batch, exactly as saveShopping does", async () => {
    const database = makeDB();
    const actions = createActions(database);
    await actions.saveShoppingBatch([
      item("Rice", { id: "direct-x-0", checked: true }),
    ]);
    await actions.saveShoppingBatch([
      item("Rice", { id: "direct-x-0", quantity: 200, checked: true }),
    ]);
    expect((await database.shopping.get("direct-x-0"))?.checked).toBe(false);
  });

  it("clearTickedShopping deletes ticked manual items and unticks this week's generated rows only", async () => {
    const database = makeDB();
    const actions = createActions(database);
    const week = "2026-10-05";
    await database.shopping.bulkPut([
      {
        id: "m1",
        updatedAt: 1,
        name: "Milk",
        quantity: 1,
        unit: "ml",
        form: "fresh",
        aisle: "Dairy",
        checked: true,
        manual: true,
      },
      {
        id: "m2",
        updatedAt: 1,
        name: "Bread",
        quantity: 1,
        unit: "each",
        form: "loaf",
        aisle: "Bakery",
        checked: false,
        manual: true,
      },
      {
        id: `week-${week}:egg`,
        updatedAt: 1,
        name: "Egg",
        quantity: 2,
        unit: "each",
        form: "whole",
        aisle: "Dairy",
        checked: true,
        manual: false,
      },
      {
        id: "week-2026-09-28:egg",
        updatedAt: 1,
        name: "Egg",
        quantity: 2,
        unit: "each",
        form: "whole",
        aisle: "Dairy",
        checked: true,
        manual: false,
      },
    ]);
    expect(await actions.clearTickedShopping(week)).toBe(2);
    expect(await database.shopping.get("m1")).toBeUndefined();
    expect((await database.shopping.get("m2"))?.checked).toBe(false);
    expect((await database.shopping.get(`week-${week}:egg`))?.checked).toBe(
      false,
    );
    // Another week's generated tick is left alone.
    expect((await database.shopping.get("week-2026-09-28:egg"))?.checked).toBe(
      true,
    );
  });

  it("clearTickedShopping is all or nothing", async () => {
    const database = makeDB();
    const actions = createActions(database);
    await database.shopping.put({
      id: "m1",
      updatedAt: 1,
      name: "Milk",
      quantity: 1,
      unit: "ml",
      form: "fresh",
      aisle: "Dairy",
      checked: true,
      manual: true,
    });
    vi.spyOn(database.shopping, "bulkDelete").mockRejectedValueOnce(
      new Error("write refused"),
    );
    await expect(actions.clearTickedShopping("2026-10-05")).rejects.toThrow(
      "write refused",
    );
    expect((await database.shopping.get("m1"))?.checked).toBe(true);
  });

  it("clearTickedShopping rejects a value that is not a Monday date", async () => {
    const database = makeDB();
    await expect(
      createActions(database).clearTickedShopping("next week"),
    ).rejects.toThrow("Some details are not valid");
  });
});
