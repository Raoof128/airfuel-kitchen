import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  KitchenDB,
  createActions,
  exportBackup,
  importBackup,
  previewImport,
} from "../../src/lib/db";

let database: KitchenDB;
beforeEach(() => {
  database = new KitchenDB(`test-${crypto.randomUUID()}`);
});
afterEach(async () => {
  await database.delete();
});

describe("backup preview conflicts", () => {
  it("does not count viewing a recipe as a different version", async () => {
    const actions = createActions(database);
    await actions.patchRecipeState("chicken", { tried: true });
    const text = await exportBackup(database);
    await actions.patchRecipeState("chicken", { viewedAt: Date.now() + 5000 });
    const preview = await previewImport(text, database);
    expect(preview.duplicates).toBe(1);
    expect(preview.conflicts).toBe(0);
  });

  it("still counts a real edit made after export as a different version", async () => {
    const actions = createActions(database);
    await actions.patchRecipeState("chicken", { tried: true });
    const text = await exportBackup(database);
    await actions.patchRecipeState("chicken", { rating: 2 });
    const preview = await previewImport(text, database);
    expect(preview.conflicts).toBe(1);
  });

  it("imports the backup without overwriting a later local edit", async () => {
    const actions = createActions(database);
    await actions.patchRecipeState("chicken", { tried: true });
    const text = await exportBackup(database);
    await actions.patchRecipeState("chicken", { rating: 2 });
    await importBackup(await previewImport(text, database), "merge", database);
    const [state] = (await (await import("../../src/lib/db")).readKitchen(database)).recipeStates;
    expect(state?.rating).toBe(2);
  });
});
