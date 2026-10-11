// Red-team checks on local persistence: concurrent tabs, failed and interrupted imports, hostile
// backups, quota errors and delete-all residue. Each device is a fresh fake-indexeddb database.
// Tests named RT-B<n> are it.fails: they encode a defect confirmed in BACKEND_REGRESSION_REPORT.md.
import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createActions,
  exportBackup,
  importBackup,
  KitchenDB,
  previewImport,
  readKitchen,
} from "../../src/lib/db";

const opened: KitchenDB[] = [];
function device(name = `rt-${crypto.randomUUID()}`): KitchenDB {
  const database = new KitchenDB(name);
  opened.push(database);
  return database;
}
afterEach(async () => {
  vi.restoreAllMocks();
  for (const database of opened.splice(0)) {
    database.close();
    await Dexie.delete(database.name);
  }
});
async function backupOf(database: KitchenDB): Promise<Record<string, unknown>> {
  return JSON.parse(await exportBackup(database));
}
async function mergeInto(target: KitchenDB, backup: unknown) {
  const preview = await previewImport(JSON.stringify(backup), target);
  await importBackup(preview, "merge", target);
}
const emptyState = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  tried: false,
  triedAt: null,
  favourite: false,
  rating: null,
  notes: "",
  viewedAt: null,
  updatedAt: 1,
  ...overrides,
});
// The largest timestamp the schema accepts (8.64e15 ms, year 275760).
const timestampCeiling = 8640000000000000;

describe("RT-B storage: concurrent tabs", () => {
  it("two tabs toggling one recipe concurrently never lose a toggle", async () => {
    const name = `rt-${crypto.randomUUID()}`;
    const tabA = device(name);
    const tabB = device(name);
    const a = createActions(tabA);
    const b = createActions(tabB);
    await Promise.all(
      Array.from({ length: 30 }, (_, index) =>
        (index % 2 ? a : b).toggleRecipeState("rt-recipe", "tried"),
      ),
    );
    // Thirty inversions from false end at false, and every toggle is a saved transaction.
    expect((await tabA.recipeStates.get("rt-recipe"))?.tried).toBe(false);
  });

  it("two tabs ticking disjoint ingredients concurrently keep every tick", async () => {
    const name = `rt-${crypto.randomUUID()}`;
    const tabA = device(name);
    const tabB = device(name);
    const a = createActions(tabA);
    const b = createActions(tabB);
    await Promise.all(
      Array.from({ length: 40 }, (_, index) =>
        (index % 2 ? a : b).setRecipeCheck("rt-recipe", "ingredient", index, true),
      ),
    );
    const checks = (await tabA.recipeStates.get("rt-recipe"))?.checks;
    expect(checks?.ingredients).toEqual(Array.from({ length: 40 }, (_, i) => i));
  });

  it("two tabs starting different recipes at once let exactly one cook start", async () => {
    const name = `rt-${crypto.randomUUID()}`;
    const tabA = device(name);
    const tabB = device(name);
    const results = await Promise.allSettled([
      createActions(tabA).startCooking("recipe-one", 2, null),
      createActions(tabB).startCooking("recipe-two", 2, null),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await tabA.activeCooking.toArray()).length).toBe(1);
  });

  it("a stale tab cannot overwrite notes saved by another tab", async () => {
    const name = `rt-${crypto.randomUUID()}`;
    const tabA = device(name);
    const tabB = device(name);
    await createActions(tabA).saveRecipeNotes("rt-recipe", "from A", "");
    await expect(
      createActions(tabB).saveRecipeNotes("rt-recipe", "from B", ""),
    ).rejects.toThrow(/saved in another tab/);
    expect((await tabA.recipeStates.get("rt-recipe"))?.notes).toBe("from A");
  });
});

describe("RT-B storage: interrupted imports", () => {
  async function sourceWithRows() {
    const source = device();
    await createActions(source).patchRecipeState("source-recipe", {
      notes: "source note",
    });
    await createActions(source).savePlan({
      recipeId: "source-recipe",
      date: "2026-10-11",
      slot: "dinner",
      servings: 2,
    });
    return backupOf(source);
  }

  it("a merge that fails part-way writes nothing to any table", async () => {
    const target = device();
    const backup = await sourceWithRows();
    const preview = await previewImport(JSON.stringify(backup), target);
    vi.spyOn(target.table("plans"), "bulkPut").mockRejectedValueOnce(
      new Error("simulated write failure"),
    );
    await expect(importBackup(preview, "merge", target)).rejects.toThrow(
      /simulated write failure/,
    );
    const kitchen = await readKitchen(target);
    expect(kitchen.recipeStates).toHaveLength(0);
    expect(kitchen.plans).toHaveLength(0);
  });

  it("a replace that fails part-way keeps the previous data intact", async () => {
    const target = device();
    await createActions(target).patchRecipeState("kept-recipe", { notes: "keep me" });
    const backup = await sourceWithRows();
    const preview = await previewImport(JSON.stringify(backup), target);
    vi.spyOn(target.table("plans"), "bulkPut").mockRejectedValueOnce(
      new Error("simulated write failure"),
    );
    await expect(importBackup(preview, "replace", target)).rejects.toThrow();
    const state = await target.recipeStates.get("kept-recipe");
    expect(state?.notes).toBe("keep me");
  });

  it("a preview taken before a local edit refuses to import", async () => {
    const target = device();
    const backup = await sourceWithRows();
    const preview = await previewImport(JSON.stringify(backup), target);
    await createActions(target).patchRecipeState("local", { notes: "changed" });
    await expect(importBackup(preview, "merge", target)).rejects.toThrow(
      /preview again/i,
    );
  });
});

describe("RT-B storage: hostile backups", () => {
  it("rejects a prototype-pollution key at the top level and inside a row", async () => {
    const base = await backupOf(device());
    const topLevel = JSON.stringify({
      ...base,
      __proto__: { polluted: true },
    }).replace('"format"', '"__proto__": {"polluted": true}, "format"');
    await expect(previewImport(topLevel, device())).rejects.toThrow();
    const nested = {
      ...base,
      recipeStates: [JSON.parse('{"id":"x","__proto__":{"polluted":true},"tried":false,"triedAt":null,"favourite":false,"rating":null,"notes":"","viewedAt":null,"updatedAt":1}')],
    };
    await expect(
      previewImport(JSON.stringify(nested), device()),
    ).rejects.toThrow();
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("accepts exactly the 10,000 shopping rows the cap allows and refuses one more", async () => {
    const base = await backupOf(device());
    const row = (index: number) => ({
      id: `manual-${index}`,
      updatedAt: 1,
      name: `item ${index}`,
      quantity: 1,
      unit: "each",
      form: "whole",
      aisle: "pantry",
      checked: false,
      manual: true,
    });
    const atCap = {
      ...base,
      shopping: Array.from({ length: 10000 }, (_, i) => row(i)),
    };
    await expect(previewImport(JSON.stringify(atCap), device())).resolves.toBeDefined();
    const overCap = {
      ...base,
      shopping: Array.from({ length: 10001 }, (_, i) => row(i)),
    };
    await expect(previewImport(JSON.stringify(overCap), device())).rejects.toThrow();
  }, 60000);

  it("refuses a backup whose future timestamp is past the schema ceiling", async () => {
    const base = await backupOf(device());
    const beyond = {
      ...base,
      recipeStates: [emptyState("future", { updatedAt: timestampCeiling + 1 })],
    };
    await expect(previewImport(JSON.stringify(beyond), device())).rejects.toThrow();
  });

  it("refuses a javascript: or relative recipe source URL through the recipe schema", async () => {
    const base = await backupOf(device());
    const custom = {
      id: "custom-rt-source",
      updatedAt: 1,
      recipe: {
        id: "custom-rt-source",
        slug: "custom-rt-source",
        title: "x",
        description: "x",
        category: "snacks-sides",
        tags: [],
        sources: [{ title: "x", url: "javascript:alert(1)", verifiedAt: "2026-10-11" }],
      },
    };
    await expect(
      previewImport(JSON.stringify({ ...base, customRecipes: [custom] }), device()),
    ).rejects.toThrow();
  });

  it("a failed import never reports a successful write to the user", async () => {
    const target = device();
    const bad = await backupOf(device());
    bad.recipeStates = [emptyState("x", { notes: "a".repeat(10001) })];
    await expect(previewImport(JSON.stringify(bad), target)).rejects.toThrow();
    expect((await readKitchen(target)).recipeStates).toHaveLength(0);
  });
});

describe("RT-B storage: quota and write errors", () => {
  it("a storage-full error reaches the user as the storage message and changes nothing", async () => {
    const database = device();
    const actions = createActions(database);
    await actions.patchRecipeState("rt-recipe", { notes: "kept" });
    vi.spyOn(database.recipeStates, "put").mockRejectedValueOnce(
      Object.assign(new Error("The quota has been exceeded."), {
        name: "QuotaExceededError",
      }),
    );
    await expect(
      actions.patchRecipeState("rt-recipe", { notes: "lost?" }),
    ).rejects.toThrow(/no free storage left/);
    expect((await database.recipeStates.get("rt-recipe"))?.notes).toBe("kept");
  });

  it("an export that cannot fit the 20 MB limit says so and writes nothing", async () => {
    const database = device();
    await database.recipeStates.bulkPut(
      Array.from({ length: 2100 }, (_, i) =>
        emptyState(`big-${i}`, { notes: "n".repeat(10000) }),
      ),
    );
    await expect(exportBackup(database)).rejects.toThrow(/too large|20 MB/);
  }, 60000);
});

describe("RT-B storage: merge and export agree on size", () => {
  it(
    "RT-B1 a merge whose result the 20 MB export limit would refuse is refused up front",
    async () => {
      // Each backup is about 12 MB, under the import limit. Merged, the local data is about 25 MB.
      // The merge counts rows only, so the app can end in a state its own export refuses.
      const notesHeavy = (prefix: string) =>
        Array.from({ length: 1200 }, (_, i) =>
          emptyState(`${prefix}-${i}`, { notes: "n".repeat(10000) }),
        );
      const base = await backupOf(device());
      const target = device();
      await mergeInto(target, { ...base, recipeStates: notesHeavy("a") });
      const firstMergeRows = (await target.recipeStates.count());
      await expect(mergeInto(target, { ...base, recipeStates: notesHeavy("b") })).rejects.toThrow(/MB of data/);
      // The refused merge wrote nothing, the first merge is intact, and export still works.
      expect(await target.recipeStates.count()).toBe(firstMergeRows);
      expect(JSON.parse(await exportBackup(target)).recipeStates).toHaveLength(firstMergeRows);
    },
    120000,
  );
});

describe("RT-B storage: future timestamps", () => {
  it(
    "RT-B2 a record stamped at the ceiling by one backup is still replaced by a genuine newer edit from another device",
    async () => {
      // Clock skew or a hostile backup can stamp a row far in the future. The merge only accepts a
      // strictly larger updatedAt, so the stamped value can never be overwritten by a later real edit.
      const phone = device();
      const laptop = device();
      const poisoned = await backupOf(device());
      poisoned.recipeStates = [
        emptyState("rt-recipe", { notes: "poisoned", updatedAt: timestampCeiling }),
      ];
      await mergeInto(phone, poisoned);
      await createActions(laptop).saveRecipeNotes("rt-recipe", "laptop edit", "");
      await mergeInto(phone, await backupOf(laptop));
      expect((await phone.recipeStates.get("rt-recipe"))?.notes).toBe("laptop edit");
    },
  );
});

describe("RT-B storage: delete-all residue", () => {
  it("clearing user data leaves no row in any user table", async () => {
    const database = device();
    const actions = createActions(database);
    await actions.patchRecipeState("rt-recipe", { notes: "x" });
    await actions.saveCookingSession({
      recipeId: "rt-recipe",
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
    });
    await actions.savePantry({ name: "rice", quantity: 1, unit: "g", form: "dry" });
    await actions.saveShopping({
      name: "eggs",
      quantity: 6,
      unit: "each",
      form: "whole",
      aisle: "dairy",
      checked: false,
      manual: true,
    });
    await actions.savePreferences({ name: "Someone" });
    await actions.startCooking("rt-recipe", 2, null);
    await actions.clearUserData();
    const counts = await Promise.all(database.tables.map((t) => t.count()));
    expect(counts).toEqual(counts.map(() => 0));
    expect((await readKitchen(database)).preferences.name).not.toBe("Someone");
  });
});
