import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KitchenDB, createActions, describeWriteError, readKitchen } from "../../src/lib/db";

let database: KitchenDB;
beforeEach(() => {
  database = new KitchenDB(`test-${crypto.randomUUID()}`);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await database.delete();
});

const quotaError = () =>
  Object.assign(new Error("The quota has been exceeded."), {
    name: "QuotaExceededError",
  });

describe("user-facing write errors", () => {
  it("replaces raw validation JSON with a readable message", async () => {
    const actions = createActions(database);
    const error = await actions
      .patchRecipeState("chicken", { rating: 9 as never })
      .catch((caught: unknown) => caught as Error);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe(
      "Some details are not valid. Check the highlighted fields and try again.",
    );
    expect(error.message).not.toContain("[");
  });

  it("explains a full browser storage quota and writes nothing", async () => {
    const actions = createActions(database);
    vi.spyOn(database.recipeStates, "put").mockRejectedValueOnce(quotaError());
    await expect(actions.patchRecipeState("chicken", { tried: true })).rejects.toThrow(
      "This browser has no free storage left. Export a backup, free some space and try again.",
    );
    expect((await readKitchen(database)).recipeStates).toEqual([]);
  });

  it("keeps deliberate domain messages unchanged", async () => {
    const actions = createActions(database);
    await expect(actions.stopCooking("chicken")).rejects.toThrow(
      "Cooking changed in another tab. Review your active recipe and try again.",
    );
  });

  it("explains when another recipe is already cooking instead of blaming another tab", async () => {
    const actions = createActions(database);
    await actions.startCooking("chicken", 2, null);
    await expect(
      actions.patchActiveCooking("beef", { servings: 3 }),
    ).rejects.toThrow(
      "Another recipe is already cooking. Finish or stop it before changing this one.",
    );
  });

  it("still returns successful results from wrapped actions", async () => {
    const actions = createActions(database);
    const record = await actions.toggleRecipeState("chicken", "favourite");
    expect(record).toMatchObject({ id: "chicken", favourite: true });
    expect(await actions.saveShopping({
      name: "rice",
      quantity: 1,
      unit: "g",
      form: "raw",
      aisle: "Pantry",
      checked: false,
      manual: true,
    })).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("maps unknown non-error throws to a generic save message", () => {
    expect(describeWriteError("boom").message).toBe(
      "Could not save. Please try again or export a backup.",
    );
  });
});
