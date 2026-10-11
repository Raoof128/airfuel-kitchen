import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  KitchenDB,
  createActions,
  exportBackup,
  importBackup,
  previewImport,
  readKitchen,
} from "../../src/lib/db";
import { defaultPreferences } from "../../src/lib/schema";
let database: KitchenDB;
beforeEach(() => {
  database = new KitchenDB(`test-${crypto.randomUUID()}`);
});
afterEach(async () => {
  await database.delete();
});
describe("IndexedDB persistence", () => {
  it("survives close/reopen and preserves independent concurrent field changes", async () => {
    const actions = createActions(database);
    const other = new KitchenDB(database.name);
    const secondActions = createActions(other);
    await Promise.all([
      actions.patchRecipeState("chicken", { tried: true }),
      secondActions.patchRecipeState("chicken", {
        notes: "Keep this",
        rating: 5,
        favourite: true,
      }),
    ]);
    const saved = await database.recipeStates.get("chicken");
    expect(saved).toMatchObject({
      tried: true,
      notes: "Keep this",
      rating: 5,
      favourite: true,
    });
    database.close();
    await database.open();
    expect(await database.recipeStates.get("chicken")).toEqual(saved);
    await actions.patchRecipeState("chicken", { tried: false });
    expect(await database.recipeStates.get("chicken")).toMatchObject({
      tried: false,
      triedAt: null,
      rating: 5,
    });
    other.close();
  });
  it("viewing never marks tried and default preferences remain available", async () => {
    await createActions(database).patchRecipeState("chicken", {
      viewedAt: Date.now(),
    });
    const snapshot = await readKitchen(database);
    expect(snapshot.recipeStates[0].tried).toBe(false);
    expect(snapshot.preferences.airFryerLitres).toBe(6.7);
  });
  it("merges concurrent preferences without replacing unrelated fields", async () => {
    const actions = createActions(database);
    await Promise.all([
      actions.savePreferences({ name: "Someone" }),
      actions.savePreferences({ minProtein: 40 }),
    ]);
    expect(await database.preferences.get("preferences")).toMatchObject({
      name: "Someone",
      minProtein: 40,
    });
  });
});
describe("validated backups", () => {
  it("restores memory after reset and viewing without allowing viewing to defeat newer explicit edits", async () => {
    const actions = createActions(database);
    await actions.patchRecipeState("chicken", {
      notes: "Backed-up memory",
      favourite: true,
    });
    const backup = await exportBackup(database);
    await actions.clearUserData();
    await actions.patchRecipeState("chicken", { viewedAt: Date.now() });
    expect((await database.recipeStates.get("chicken"))?.updatedAt).toBe(0);
    await importBackup(
      await previewImport(backup, database),
      "merge",
      database,
    );
    expect(await database.recipeStates.get("chicken")).toMatchObject({
      notes: "Backed-up memory",
      favourite: true,
    });
    await actions.patchRecipeState("chicken", { notes: "New explicit edit" });
    const edited = await database.recipeStates.get("chicken");
    await actions.patchRecipeState("chicken", { viewedAt: Date.now() + 1000 });
    expect((await database.recipeStates.get("chicken"))?.updatedAt).toBe(
      edited?.updatedAt,
    );
    await importBackup(
      await previewImport(backup, database),
      "merge",
      database,
    );
    expect((await database.recipeStates.get("chicken"))?.notes).toBe(
      "New explicit edit",
    );
  });
  it("roundtrips all data and merges idempotently", async () => {
    const actions = createActions(database);
    await actions.patchRecipeState("chicken", {
      tried: true,
      notes: "<script>alert(1)</script>",
    });
    await actions.savePreferences({ allergens: ["egg"] });
    const backup = await exportBackup(database);
    const preview = await previewImport(backup, database);
    expect(preview.duplicates).toBe(2);
    expect(preview.conflicts).toBe(0);
    await importBackup(preview, "merge", database);
    expect(await database.recipeStates.count()).toBe(1);
    const replace = await previewImport(backup, database);
    await importBackup(replace, "replace", database);
    expect((await database.recipeStates.get("chicken"))?.notes).toBe(
      "<script>alert(1)</script>",
    );
    expect((await database.preferences.get("preferences"))?.allergens).toEqual([
      "egg",
    ]);
  });
  it("rejects stale or tampered previews atomically", async () => {
    const actions = createActions(database);
    await actions.patchRecipeState("chicken", { notes: "original" });
    const text = await exportBackup(database);
    const preview = await previewImport(text, database);
    await actions.patchRecipeState("chicken", {
      notes: "newer in another tab",
    });
    await expect(importBackup(preview, "replace", database)).rejects.toThrow(
      "changed",
    );
    expect((await database.recipeStates.get("chicken"))?.notes).toBe(
      "newer in another tab",
    );
    const another = await previewImport(text, database);
    another.backup.recipeStates[0].notes = "tampered";
    await expect(importBackup(another, "replace", database)).rejects.toThrow(
      "preview",
    );
  });
  it("rejects duplicates, malformed values and prototype keys before writing", async () => {
    const backup = JSON.parse(await exportBackup(database));
    backup.preferences = [defaultPreferences, defaultPreferences];
    await expect(
      previewImport(JSON.stringify(backup), database),
    ).rejects.toThrow();
    backup.preferences = [];
    backup.recipeStates = [
      {
        id: "x",
        updatedAt: 1,
        tried: false,
        triedAt: null,
        favourite: false,
        rating: null,
        notes: "",
        viewedAt: null,
      },
    ];
    backup.recipeStates.push(backup.recipeStates[0]);
    await expect(
      previewImport(JSON.stringify(backup), database),
    ).rejects.toThrow("Duplicate");
    await expect(
      previewImport('{"__proto__": {"polluted": true}}', database),
    ).rejects.toThrow();
    expect(await database.recipeStates.count()).toBe(0);
  });
  it("keeps newer local records and existing records on timestamp ties", async () => {
    await createActions(database).patchRecipeState("chicken", {
      notes: "local",
    });
    const backup = JSON.parse(await exportBackup(database));
    backup.recipeStates[0].notes = "old import";
    backup.recipeStates[0].updatedAt -= 1;
    await importBackup(
      await previewImport(JSON.stringify(backup), database),
      "merge",
      database,
    );
    expect((await database.recipeStates.get("chicken"))?.notes).toBe("local");
  });
});
describe("migration", () => {
  it("preserves v1 records and never infers consumed servings", async () => {
    const name = `legacy-${crypto.randomUUID()}`;
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
    await old.table("sessions").put({
      id: "legacy",
      updatedAt: 1,
      recipeId: "chicken",
      date: "2026-10-10",
      servingsPrepared: 2,
      rating: 5,
      actualMinutes: 20,
      ingredientChanges: "",
      temperatureC: null,
      timeChanges: "",
      notes: "Keep my history",
      wouldCookAgain: true,
    });
    await old
      .table("preferences")
      .put({ id: "preferences", name: "Legacy name" });
    old.close();
    const migrated = new KitchenDB(name);
    await migrated.open();
    expect(await migrated.sessions.get("legacy")).toMatchObject({
      servingsPrepared: 2,
      servingsConsumed: 0,
      notes: "Keep my history",
    });
    expect(await migrated.preferences.get("preferences")).toMatchObject({
      name: "Legacy name",
      timezone: "Australia/Sydney",
    });
    expect(JSON.parse(await exportBackup(migrated)).sessions).toHaveLength(1);
    await migrated.delete();
  });
});
