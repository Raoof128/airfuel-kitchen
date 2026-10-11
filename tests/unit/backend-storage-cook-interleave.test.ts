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
// Two connections to one database behave like two tabs.
function tabs() {
  const name = `interleave-${crypto.randomUUID()}`;
  const a = new KitchenDB(name);
  const b = new KitchenDB(name);
  databases.push(a, b);
  return { a, b, actionsA: createActions(a), actionsB: createActions(b) };
}

describe("cross-tab interleaving on the active cook", () => {
  it("a timer start and a step tick, in either order and either tab, both survive", async () => {
    for (const order of ["timer-first", "step-first"] as const) {
      const { a, b, actionsA, actionsB } = tabs();
      await actionsA.startCooking("chicken", 2, null);
      await actionsA.setCookingCheck(
        "chicken",
        "ingredient",
        0,
        true,
        2,
        "chicken",
      );
      const timer = () =>
        actionsB.patchActiveCooking(
          "chicken",
          { timerEndsAt: 2000000000000, timerRemainingSeconds: 0 },
          2,
          "chicken",
        );
      const step = () =>
        actionsA.setCookingCheck("chicken", "step", 0, true, 2, "chicken");
      await Promise.all(
        order === "timer-first" ? [timer(), step()] : [step(), timer()],
      );
      expect(await a.activeCooking.get("active"), order).toMatchObject({
        checkedIngredients: [0],
        checkedSteps: [0],
        timerEndsAt: 2000000000000,
      });
      a.close();
      b.close();
    }
  });

  it("many interleaved ticks and timer writes from both tabs never drop an earlier tick", async () => {
    const { a, b, actionsA, actionsB } = tabs();
    await actionsA.startCooking("chicken", 2, null);
    const jobs: Promise<unknown>[] = [];
    for (let index = 0; index < 20; index++) {
      jobs.push(
        actionsA.setCookingCheck(
          "chicken",
          "step",
          index % 10,
          true,
          2,
          "chicken",
        ),
      );
      jobs.push(
        actionsB.patchActiveCooking(
          "chicken",
          { timerEndsAt: 2000000000000 + index },
          2,
          "chicken",
        ),
      );
      jobs.push(
        actionsB.setCookingCheck(
          "chicken",
          "ingredient",
          index % 10,
          true,
          2,
          "chicken",
        ),
      );
    }
    await Promise.all(jobs);
    expect(await a.activeCooking.get("active")).toMatchObject({
      checkedSteps: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
      checkedIngredients: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    });
    a.close();
    b.close();
  });
});

describe("a write in flight is visible to the page", () => {
  it("hasPendingWrites is true until the write commits, and false after a failure too", async () => {
    const { a, b, actionsA } = tabs();
    const { hasPendingWrites } = await import("../../src/lib/db");
    expect(hasPendingWrites()).toBe(false);
    const write = actionsA.patchRecipeState("toast", { favourite: true });
    expect(hasPendingWrites()).toBe(true);
    await write;
    expect(hasPendingWrites()).toBe(false);
    await expect(
      actionsA.patchRecipeState("toast", { rating: 9 as never }),
    ).rejects.toThrow();
    expect(hasPendingWrites()).toBe(false);
    a.close();
    b.close();
  });
});
