import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { KitchenDB, createActions, readKitchen } from "../../src/lib/db";

let database: KitchenDB;
let other: KitchenDB;
beforeEach(() => {
  database = new KitchenDB(`test-${crypto.randomUUID()}`);
  other = new KitchenDB(database.name);
});
afterEach(async () => {
  other.close();
  await database.delete();
});

describe("recipe notes across tabs", () => {
  it("saves when the stored notes are the ones this tab last loaded", async () => {
    const actions = createActions(database);
    await actions.saveRecipeNotes("chicken", "First note", "");
    await actions.saveRecipeNotes("chicken", "Second note", "First note");
    expect((await readKitchen(database)).recipeStates[0]?.notes).toBe("Second note");
  });

  it("refuses a stale tab's save instead of overwriting another tab's note", async () => {
    const tab1 = createActions(database);
    const tab2 = createActions(other);
    await tab2.saveRecipeNotes("chicken", "Saved from tab 2", "");
    await expect(
      tab1.saveRecipeNotes("chicken", "Draft from tab 1", ""),
    ).rejects.toThrow("These notes were saved in another tab. Review them before saving again.");
    expect((await readKitchen(database)).recipeStates[0]?.notes).toBe("Saved from tab 2");
  });

  it("lets the stale tab save after reviewing by passing the newly stored notes", async () => {
    const tab1 = createActions(database);
    const tab2 = createActions(other);
    await tab2.saveRecipeNotes("chicken", "Saved from tab 2", "");
    await tab1.saveRecipeNotes("chicken", "Merged by hand", "Saved from tab 2");
    expect((await readKitchen(database)).recipeStates[0]?.notes).toBe("Merged by hand");
  });

  it("does not disturb tried, rating or favourite fields when saving notes", async () => {
    const actions = createActions(database);
    await actions.patchRecipeState("chicken", { tried: true, rating: 4, favourite: true });
    await actions.saveRecipeNotes("chicken", "Only notes change", "");
    const [state] = (await readKitchen(database)).recipeStates;
    expect(state).toMatchObject({ tried: true, rating: 4, favourite: true, notes: "Only notes change" });
  });

  it("rejects over-long notes without writing anything", async () => {
    const actions = createActions(database);
    await expect(
      actions.saveRecipeNotes("chicken", "x".repeat(10001), ""),
    ).rejects.toThrow("Some details are not valid");
    expect((await readKitchen(database)).recipeStates).toEqual([]);
  });
});
