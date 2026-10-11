import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterEach, describe, expect, it } from "vitest";
import {
  createActions,
  exportBackup,
  importBackup,
  KitchenDB,
  previewImport,
} from "../../src/lib/db";
import { recipeStateSchema } from "../../src/lib/schema";

const databases: KitchenDB[] = [];
afterEach(async () => {
  for (const database of databases.splice(0)) {
    database.close();
    await Dexie.delete(database.name);
  }
});
const makeDB = (name = `rc-${crypto.randomUUID()}`) => {
  const database = new KitchenDB(name);
  databases.push(database);
  return database;
};

describe("recipe-page checks without Cook Mode", () => {
  it("ticks persist on the recipe, sorted and unique, without creating an active cook", async () => {
    const name = `rc-persist-${crypto.randomUUID()}`;
    const database = makeDB(name);
    const actions = createActions(database);
    await actions.setRecipeCheck("toast", "ingredient", 3, true);
    await actions.setRecipeCheck("toast", "ingredient", 1, true);
    await actions.setRecipeCheck("toast", "ingredient", 3, true);
    await actions.setRecipeCheck("toast", "step", 0, true);
    expect(await database.activeCooking.get("active")).toBeUndefined();
    database.close();
    const reopened = makeDB(name);
    expect((await reopened.recipeStates.get("toast"))?.checks).toEqual({
      ingredients: [1, 3],
      steps: [0],
    });
  });

  it("unticking removes only that index", async () => {
    const database = makeDB();
    const actions = createActions(database);
    await actions.setRecipeCheck("toast", "step", 0, true);
    await actions.setRecipeCheck("toast", "step", 2, true);
    await actions.setRecipeCheck("toast", "step", 0, false);
    expect((await database.recipeStates.get("toast"))?.checks?.steps).toEqual([
      2,
    ]);
  });

  it("never touches the active cook of another recipe", async () => {
    const database = makeDB();
    const actions = createActions(database);
    await actions.startCooking("soup", 2, null);
    await actions.setCookingCheck("soup", "step", 0, true, 2, "soup");
    const before = await database.activeCooking.get("active");
    await actions.setRecipeCheck("toast", "ingredient", 0, true);
    expect(await database.activeCooking.get("active")).toEqual(before);
  });

  it("does not mark the recipe tried, and leaves notes and rating alone", async () => {
    const database = makeDB();
    const actions = createActions(database);
    await actions.patchRecipeState("toast", { notes: "keep", rating: 4 });
    await actions.setRecipeCheck("toast", "ingredient", 0, true);
    expect(await database.recipeStates.get("toast")).toMatchObject({
      tried: false,
      notes: "keep",
      rating: 4,
      checks: { ingredients: [0], steps: [] },
    });
  });

  it("refuses an index outside the recipe, and writes nothing", async () => {
    const database = makeDB();
    const actions = createActions(database);
    await expect(
      actions.setRecipeCheck("toast", "step", 5, true, 5),
    ).rejects.toThrow("not in this recipe");
    expect(await database.recipeStates.get("toast")).toBeUndefined();
    await actions.setRecipeCheck("toast", "step", 4, true, 5);
    expect((await database.recipeStates.get("toast"))?.checks?.steps).toEqual([
      4,
    ]);
  });

  it.each([
    ["an unknown kind", () => ["bogus" as never, 0, true] as const],
    ["an index of 100", () => ["step" as const, 100, true] as const],
    ["a non-boolean", () => ["step" as const, 0, "yes" as never] as const],
  ])("rejects %s without writing", async (_label, make) => {
    const database = makeDB();
    const [kind, index, checked] = make();
    await expect(
      createActions(database).setRecipeCheck("toast", kind, index, checked),
    ).rejects.toThrow("Some details are not valid");
    expect(await database.recipeStates.count()).toBe(0);
  });

  it("two tabs ticking different items both keep their tick", async () => {
    const name = `rc-tabs-${crypto.randomUUID()}`;
    const a = createActions(makeDB(name));
    const b = createActions(makeDB(name));
    await Promise.all([
      a.setRecipeCheck("toast", "ingredient", 0, true),
      b.setRecipeCheck("toast", "ingredient", 1, true),
      a.setRecipeCheck("toast", "step", 0, true),
    ]);
    const stored = await makeDB(name).recipeStates.get("toast");
    expect(stored?.checks).toEqual({ ingredients: [0, 1], steps: [0] });
  });

  it("writes only recipeStates in its transaction, so a failure leaves nothing behind", async () => {
    const database = makeDB();
    const actions = createActions(database);
    await actions.startCooking("soup", 2, null);
    const cookBefore = await database.activeCooking.get("active");
    await expect(
      actions.setRecipeCheck("toast", "ingredient", 1, true, 1),
    ).rejects.toThrow("not in this recipe");
    expect(await database.activeCooking.get("active")).toEqual(cookBefore);
  });
});

describe("checks in the schema and backups", () => {
  it("older rows without checks stay valid", () => {
    const row = {
      id: "toast",
      updatedAt: 1,
      tried: false,
      triedAt: null,
      favourite: false,
      rating: null,
      notes: "",
      viewedAt: null,
    };
    expect(recipeStateSchema.safeParse(row).success).toBe(true);
  });

  it("rejects extra keys inside checks", () => {
    const row = {
      id: "t",
      updatedAt: 1,
      tried: false,
      triedAt: null,
      favourite: false,
      rating: null,
      notes: "",
      viewedAt: null,
      checks: { ingredients: [], steps: [], extra: [] },
    };
    expect(recipeStateSchema.safeParse(row).success).toBe(false);
  });

  it("round-trips checks through backup and restore", async () => {
    const source = makeDB();
    await createActions(source).setRecipeCheck("toast", "step", 2, true);
    const target = makeDB();
    await importBackup(
      await previewImport(await exportBackup(source), target),
      "merge",
      target,
    );
    expect((await target.recipeStates.get("toast"))?.checks).toEqual({
      ingredients: [],
      steps: [2],
    });
  });

  it("imports an older backup that has no checks field", async () => {
    const source = makeDB();
    await createActions(source).patchRecipeState("toast", { tried: true });
    const backup = JSON.parse(await exportBackup(source));
    expect(backup.recipeStates[0]).not.toHaveProperty("checks");
    const target = makeDB();
    await importBackup(
      await previewImport(JSON.stringify(backup), target),
      "merge",
      target,
    );
    expect(await target.recipeStates.get("toast")).toMatchObject({
      tried: true,
    });
  });
});

describe("a new cook starts from the recipe-page checks", () => {
  it("seeds the cook's checklist from recipe checks", async () => {
    const database = makeDB();
    const actions = createActions(database);
    await actions.setRecipeCheck("toast", "ingredient", 2, true);
    await actions.setRecipeCheck("toast", "step", 1, true);
    await actions.startCooking("toast", 2, null);
    expect(await database.activeCooking.get("active")).toMatchObject({
      recipeId: "toast",
      checkedIngredients: [2],
      checkedSteps: [1],
    });
  });

  it("a cook already running for this recipe keeps its own checklist, not the page's", async () => {
    const database = makeDB();
    const actions = createActions(database);
    await actions.startCooking("toast", 2, null);
    await actions.setCookingCheck("toast", "step", 0, true, 2, "toast");
    await actions.setRecipeCheck("toast", "step", 5, true);
    await actions.startCooking("toast", 2, "toast");
    expect((await database.activeCooking.get("active"))?.checkedSteps).toEqual([
      0,
    ]);
  });

  it("the cook's ticks do not write back to the recipe page", async () => {
    const database = makeDB();
    const actions = createActions(database);
    await actions.startCooking("toast", 2, null);
    await actions.setCookingCheck("toast", "ingredient", 0, true, 2, "toast");
    expect((await database.recipeStates.get("toast"))?.checks).toBeUndefined();
  });

  it("setCookingCheck still refuses a tick with nothing cooking", async () => {
    const database = makeDB();
    await expect(
      createActions(database).setCookingCheck(
        "toast",
        "step",
        0,
        true,
        2,
        null,
      ),
    ).rejects.toThrow("Start cooking this recipe");
    expect(await database.activeCooking.get("active")).toBeUndefined();
  });
});
