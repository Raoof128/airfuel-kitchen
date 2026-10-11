import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterEach, describe, expect, it } from "vitest";
import {
  createActions,
  exportBackup,
  importBackup,
  KitchenDB,
  previewImport,
  readKitchen,
} from "../../src/lib/db";

const databases: KitchenDB[] = [];
afterEach(async () => {
  for (const database of databases.splice(0)) {
    database.close();
    await Dexie.delete(database.name);
  }
});
const makeDB = () => {
  const database = new KitchenDB(`sizes-${crypto.randomUUID()}`);
  databases.push(database);
  return database;
};
const bigRows = (prefix: string, count = 1200) =>
  Array.from({ length: count }, (_, i) => ({
    id: `${prefix}-${i}`,
    tried: false,
    triedAt: null,
    favourite: false,
    rating: null,
    notes: "n".repeat(10000),
    viewedAt: null,
    updatedAt: 1,
  }));
async function backupWith(recipeStates: unknown[]) {
  const source = makeDB();
  const backup = JSON.parse(await exportBackup(source));
  backup.recipeStates = recipeStates;
  return JSON.stringify(backup);
}

describe("RT-B1: a merge is judged by the bytes its export would produce", () => {
  it("refuses the merge that would exceed one backup file, writes nothing, and keeps export working", async () => {
    const target = makeDB();
    await importBackup(
      await previewImport(await backupWith(bigRows("a")), target),
      "merge",
      target,
    );
    const before = await target.recipeStates.count();
    await expect(
      importBackup(
        await previewImport(await backupWith(bigRows("b")), target),
        "merge",
        target,
      ),
    ).rejects.toThrow(
      "more than one backup file can hold (20 MB). Nothing was imported.",
    );
    expect(await target.recipeStates.count()).toBe(before);
    expect(JSON.parse(await exportBackup(target)).recipeStates).toHaveLength(
      before,
    );
  }, 60000);

  it("an ordinary merge of two small backups still succeeds", async () => {
    const source = makeDB();
    await createActions(source).patchRecipeState("one", { favourite: true });
    const target = makeDB();
    await importBackup(
      await previewImport(await exportBackup(source), target),
      "merge",
      target,
    );
    expect(await target.recipeStates.count()).toBe(1);
    await createActions(target).patchRecipeState("two", { favourite: true });
    expect(await target.recipeStates.count()).toBe(2);
  });
});

describe("RT-B2: future-stamped rows do not block later genuine edits", () => {
  it("a future stamp in an imported file is capped, so the next local edit replaces it", async () => {
    const phone = makeDB();
    const poisoned = JSON.parse(await exportBackup(makeDB()));
    poisoned.recipeStates = [
      {
        id: "rt",
        updatedAt:
          Number.MAX_SAFE_INTEGER > 8640000000000000
            ? 8640000000000000
            : 8640000000000000,
        tried: false,
        triedAt: null,
        favourite: false,
        rating: null,
        notes: "poisoned",
        viewedAt: null,
      },
    ];
    await importBackup(
      await previewImport(JSON.stringify(poisoned), phone),
      "merge",
      phone,
    );
    expect((await phone.recipeStates.get("rt"))!.updatedAt).toBeLessThanOrEqual(
      Date.now(),
    );
    await createActions(phone).saveRecipeNotes("rt", "phone edit", "poisoned");
    expect((await phone.recipeStates.get("rt"))?.notes).toBe("phone edit");
  });

  it("a local edit always stamps above a stored future value, even one written directly", async () => {
    const database = makeDB();
    const future = Date.now() + 60 * 60 * 1000;
    await database.recipeStates.put({
      id: "rt",
      updatedAt: future,
      tried: false,
      triedAt: null,
      favourite: false,
      rating: null,
      notes: "old",
      viewedAt: null,
    });
    await createActions(database).patchRecipeState("rt", { favourite: true });
    expect((await database.recipeStates.get("rt"))!.updatedAt).toBeGreaterThan(
      future,
    );
  });

  it("a capped stamp loses only to an edit made after the import, never to an equal one", async () => {
    const phone = makeDB();
    const file = JSON.parse(await exportBackup(makeDB()));
    file.recipeStates = [
      {
        id: "rt",
        updatedAt: 8640000000000000,
        tried: false,
        triedAt: null,
        favourite: false,
        rating: null,
        notes: "poisoned",
        viewedAt: null,
      },
    ];
    await importBackup(
      await previewImport(JSON.stringify(file), phone),
      "merge",
      phone,
    );
    const stamp = (await phone.recipeStates.get("rt"))!.updatedAt;
    expect(stamp).toBeLessThan(Date.now());
  });
});

describe("RT-B7: null preference values are repaired by the upgrade", () => {
  it("fills several null keys with defaults and keeps the values that are set", async () => {
    const { defaultPreferences } = await import("../../src/lib/schema");
    const name = `sizes-legacy-${crypto.randomUUID()}`;
    const old = new Dexie(name);
    old.version(1).stores({
      recipeStates: "id,updatedAt",
      sessions: "id,recipeId,date,updatedAt",
      plans: "id,date,recipeId,updatedAt",
      pantry: "id,updatedAt",
      shopping: "id,updatedAt",
      customRecipes: "id,updatedAt",
      overrides: "id,updatedAt",
      preferences: "id",
      activeCooking: "id",
    });
    await old.table("preferences").put({
      id: "preferences",
      name: "Kept",
      allergens: null,
      dietary: null,
      theme: null,
      minProtein: 42,
    });
    old.close();
    const upgraded = new KitchenDB(name);
    databases.push(upgraded);
    const prefs = await readKitchen(upgraded);
    expect(prefs.preferences).toMatchObject({
      name: "Kept",
      minProtein: 42,
      allergens: [],
      dietary: [],
      theme: defaultPreferences.theme,
    });
    await Dexie.delete(name);
  });
});
