// Red-team checks on the Dexie v1 to v2 upgrade with messy legacy rows, and on backups written before
// the recipe-page checks field existed. Each legacy database is a real v1 Dexie database on fake-indexeddb.
// Tests named RT-B<n> are it.fails and encode a confirmed defect.
import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterEach, describe, expect, it } from "vitest";
import {
  exportBackup,
  importBackup,
  KitchenDB,
  previewImport,
  readKitchen,
} from "../../src/lib/db";
import { defaultPreferences } from "../../src/lib/schema";

const legacyStores = {
  recipeStates: "id,updatedAt",
  sessions: "id,recipeId,date,updatedAt",
  plans: "id,date,recipeId,updatedAt",
  pantry: "id,updatedAt",
  shopping: "id,updatedAt",
  customRecipes: "id,updatedAt",
  overrides: "id,updatedAt",
  preferences: "id",
  activeCooking: "id",
};
const names: string[] = [];
afterEach(async () => {
  for (const name of names.splice(0)) await Dexie.delete(name);
});
// Writes rows straight into a version-1 database, as the shipped v1 build would have left them.
async function legacy(seed: Record<string, unknown[]>): Promise<string> {
  const name = `rt-legacy-${crypto.randomUUID()}`;
  names.push(name);
  const v1 = new Dexie(name);
  v1.version(1).stores(legacyStores);
  await v1.open();
  for (const [table, rows] of Object.entries(seed))
    if (rows.length) await v1.table(table).bulkPut(rows);
  v1.close();
  return name;
}
const session = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  updatedAt: 1,
  recipeId: "legacy-recipe",
  date: "2026-10-01",
  servingsPrepared: 2,
  rating: null,
  actualMinutes: null,
  ingredientChanges: "",
  temperatureC: null,
  timeChanges: "",
  notes: "",
  wouldCookAgain: null,
  ...extra,
});

describe("v1 to v2 upgrade with legacy rows", () => {
  it("fills servingsConsumed with zero on sessions that predate it, and treats null the same", async () => {
    const name = await legacy({
      sessions: [session("a"), session("b", { servingsConsumed: null })],
    });
    const database = new KitchenDB(name);
    names.push(name);
    const sessions = await database.sessions.toArray();
    database.close();
    expect(sessions.map((row) => row.servingsConsumed).sort()).toEqual([0, 0]);
  });

  it("fills only the missing preference keys and keeps every value the user set", async () => {
    const name = await legacy({
      preferences: [{ id: "preferences", updatedAt: 5, name: "Kept", allergens: ["milk"] }],
    });
    const database = new KitchenDB(name);
    names.push(name);
    const prefs = await database.preferences.get("preferences");
    database.close();
    expect(prefs?.name).toBe("Kept");
    expect(prefs?.allergens).toEqual(["milk"]);
    expect(prefs?.dislikedIngredients).toEqual(defaultPreferences.dislikedIngredients);
    expect(prefs?.theme).toBe(defaultPreferences.theme);
  });

  it("reopening an upgraded database does not run the upgrade again", async () => {
    const name = await legacy({ sessions: [session("once")] });
    const first = new KitchenDB(name);
    await first.sessions.update("once", { servingsConsumed: 3 });
    first.close();
    names.push(name);
    const second = new KitchenDB(name);
    const row = await second.sessions.get("once");
    second.close();
    expect(row?.servingsConsumed).toBe(3);
  });

  it(
    "RT-B7 the upgrade repairs a null legacy preference, not only a missing one",
    async () => {
      // The upgrade fills only undefined keys. Explorer.tsx spreads data.preferences.allergens, so a
      // null that survives the upgrade throws during render of that page.
      const name = await legacy({
        preferences: [{ id: "preferences", updatedAt: 5, allergens: null }],
      });
      const database = new KitchenDB(name);
      names.push(name);
      const prefs = await database.preferences.get("preferences");
      database.close();
      expect(Array.isArray(prefs?.allergens)).toBe(true);
    },
  );

  it("a legacy row with an unknown theme loads, and export refuses it by naming the table", async () => {
    const name = await legacy({
      preferences: [{ id: "preferences", updatedAt: 5, theme: "neon" }],
    });
    const database = new KitchenDB(name);
    names.push(name);
    const kitchen = await readKitchen(database);
    expect(kitchen.preferences.theme).toBe("neon");
    await expect(exportBackup(database)).rejects.toThrow(/preferences/);
    database.close();
  });
});

describe("backups across the checks field", () => {
  const base = async () => {
    const database = new KitchenDB(`rt-base-${crypto.randomUUID()}`);
    names.push(database.name);
    const text = await exportBackup(database);
    database.close();
    return JSON.parse(text);
  };
  const state = (id: string, extra: Record<string, unknown> = {}) => ({
    id,
    tried: false,
    triedAt: null,
    favourite: false,
    rating: null,
    notes: "",
    viewedAt: null,
    updatedAt: 1,
    ...extra,
  });

  it("accepts a backup written before the checks field existed", async () => {
    const backup = await base();
    backup.recipeStates = [state("old-row")];
    const target = new KitchenDB(`rt-target-${crypto.randomUUID()}`);
    names.push(target.name);
    await expect(
      previewImport(JSON.stringify(backup), target),
    ).resolves.toMatchObject({ added: 1 });
    target.close();
  });

  it("refuses a checks list longer than the 100-item cap", async () => {
    const backup = await base();
    backup.recipeStates = [
      state("long", { checks: { ingredients: Array.from({ length: 101 }, (_, i) => i % 100), steps: [] } }),
    ];
    const target = new KitchenDB(`rt-target-${crypto.randomUUID()}`);
    names.push(target.name);
    await expect(previewImport(JSON.stringify(backup), target)).rejects.toThrow();
    target.close();
  });

  it("an import of an old backup keeps the recipe-page checks already on the device", async () => {
    const target = new KitchenDB(`rt-target-${crypto.randomUUID()}`);
    names.push(target.name);
    await target.recipeStates.put(
      state("page", { checks: { ingredients: [2], steps: [0] }, updatedAt: 5 }),
    );
    const backup = await base();
    backup.recipeStates = [state("page", { updatedAt: 1 })];
    const preview = await previewImport(JSON.stringify(backup), target);
    await importBackup(preview, "merge", target);
    target.close();
    const after = new KitchenDB(target.name);
    const kept = await after.recipeStates.get("page");
    after.close();
    expect(kept?.checks).toEqual({ ingredients: [2], steps: [0] });
  });
});
