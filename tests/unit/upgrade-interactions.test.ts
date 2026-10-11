import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createActions, KitchenDB } from "../../src/lib/db";
import type { CookingSession } from "../../src/lib/schema";

let database: KitchenDB;
const connections: KitchenDB[] = [];
beforeEach(() => {
  database = new KitchenDB(`upgrade-${crypto.randomUUID()}`);
});
afterEach(async () => {
  vi.restoreAllMocks();
  for (const connection of connections) connection.close();
  connections.length = 0;
  await database.delete();
});
function secondConnection() {
  const connection = new KitchenDB(database.name);
  connections.push(connection);
  return connection;
}

describe("rapid and concurrent personal-memory interactions", () => {
  it.each(["favourite", "tried"] as const)(
    "applies all 50 rapid %s toggles against saved state",
    async (field) => {
      const actions = createActions(database);
      const results = await Promise.all(
        Array.from({ length: 50 }, () =>
          actions.toggleRecipeState("chicken", field),
        ),
      );
      expect(results.filter((row) => row[field])).toHaveLength(25);
      expect(new Set(results.map((row) => row.updatedAt)).size).toBe(50);
      expect(await database.recipeStates.get("chicken")).toMatchObject({
        [field]: false,
        triedAt: null,
      });
      const toggledOn = await actions.toggleRecipeState("chicken", field);
      expect(toggledOn[field]).toBe(true);
      expect(toggledOn.triedAt).toBe(
        field === "tried" ? toggledOn.updatedAt : null,
      );
    },
  );

  it("keeps unrelated edits during two-connection toggle bursts and after reopening", async () => {
    const first = createActions(database);
    const second = createActions(secondConnection());
    await first.patchRecipeState("chicken", { tried: true });
    const firstTriedAt = (await database.recipeStates.get("chicken"))!.triedAt!;
    const longNote = "Keep my long personal note: " + "x".repeat(9900);
    const writes: Promise<unknown>[] = [];
    for (let index = 0; index < 51; index++) {
      const actions = index % 2 ? first : second;
      writes.push(actions.toggleRecipeState("chicken", "favourite"));
      writes.push(actions.toggleRecipeState("chicken", "tried"));
      if (index === 10)
        writes.push(first.patchRecipeState("chicken", { notes: longNote }));
      if (index === 20)
        writes.push(second.patchRecipeState("chicken", { rating: 5 }));
      if (index === 30)
        writes.push(first.patchRecipeState("chicken", { viewedAt: 1234567 }));
    }
    await Promise.all(writes);
    const saved = await database.recipeStates.get("chicken");
    expect(saved).toMatchObject({
      favourite: true,
      tried: false,
      triedAt: null,
      rating: 5,
      viewedAt: 1234567,
    });
    expect(saved?.notes).toBe(longNote);
    const markedAgain = await second.toggleRecipeState("chicken", "tried");
    expect(markedAgain.triedAt).toBeGreaterThan(firstTriedAt);
    expect(markedAgain.notes).toBe(saved?.notes);
    database.close();
    await database.open();
    expect(await database.recipeStates.get("chicken")).toEqual(markedAgain);
  });

  it("rejects an invalid toggle field without altering memory", async () => {
    const actions = createActions(database);
    await actions.patchRecipeState("chicken", { notes: "Preserve this" });
    const before = await database.recipeStates.get("chicken");
    await expect(
      actions.toggleRecipeState("chicken", "notes" as "tried"),
    ).rejects.toThrow();
    expect(await database.recipeStates.get("chicken")).toEqual(before);
  });
});

describe("guarded cooking activity and timer persistence", () => {
  it("only one of two simultaneous starts can claim an empty active slot", async () => {
    const first = createActions(database);
    const second = createActions(secondConnection());
    const outcomes = await Promise.allSettled([
      first.startCooking("chicken", 2, null),
      second.startCooking("salmon", 4, null),
    ]);
    expect(
      outcomes.filter((outcome) => outcome.status === "fulfilled"),
    ).toHaveLength(1);
    const rejected = outcomes.find((outcome) => outcome.status === "rejected");
    expect(
      rejected?.status === "rejected" && rejected.reason.message,
    ).toContain("Cooking changed");
    const winner = await database.activeCooking.get("active");
    expect(winner?.recipeId).toBe(
      outcomes[0].status === "fulfilled" ? "chicken" : "salmon",
    );
  });

  it("rejects stale replacement, checklist, timer and stop actions without erasing a newer cook", async () => {
    const first = createActions(database);
    const second = createActions(secondConnection());
    await first.startCooking("chicken", 2, null);
    await second.startCooking("salmon", 4, "chicken");
    await second.setCookingCheck("salmon", "step", 0, true, 4, "salmon");
    const saved = await database.activeCooking.get("active");
    const staleWrites = [
      first.startCooking("tofu", 2, "chicken"),
      first.patchActiveCooking(
        "chicken",
        { timerEndsAt: Date.now() + 60000 },
        2,
        "chicken",
      ),
      first.setCookingCheck("chicken", "ingredient", 0, true, 2, "chicken"),
      first.stopCooking("chicken"),
      // Legacy callers without an expected ID also cannot replace another dish.
      first.patchActiveCooking("chicken", { servings: 3 }),
      first.setCookingCheck("chicken", "step", 0, true),
    ];
    const outcomes = await Promise.allSettled(staleWrites);
    expect(outcomes.every((outcome) => outcome.status === "rejected")).toBe(
      true,
    );
    expect(await database.activeCooking.get("active")).toEqual(saved);
  });

  it("preserves an existing recipe's timer and checklist on resume, resetting them only for an explicit replacement", async () => {
    const actions = createActions(database);
    await actions.startCooking("chicken", 2, null);
    await actions.setCookingCheck(
      "chicken",
      "ingredient",
      0,
      true,
      2,
      "chicken",
    );
    await actions.patchActiveCooking(
      "chicken",
      { timerEndsAt: 2000000000000 },
      2,
      "chicken",
    );
    await actions.startCooking("chicken", 3, "chicken");
    expect(await database.activeCooking.get("active")).toMatchObject({
      servings: 3,
      checkedIngredients: [0],
      timerEndsAt: 2000000000000,
    });
    await actions.startCooking("salmon", 4, "chicken");
    expect(await database.activeCooking.get("active")).toMatchObject({
      recipeId: "salmon",
      servings: 4,
      checkedIngredients: [],
      checkedSteps: [],
      timerEndsAt: null,
      timerRemainingSeconds: 0,
    });
    await actions.stopCooking("salmon");
    expect(await database.activeCooking.get("active")).toBeUndefined();
  });

  it("does not restart or extend a running timer when the database reopens after its deadline", async () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(2000000000000);
    const actions = createActions(database);
    await actions.startCooking("chicken", 2, null);
    await actions.patchActiveCooking(
      "chicken",
      { timerEndsAt: Date.now() + 60000, timerRemainingSeconds: 0 },
      2,
      "chicken",
    );
    const saved = await database.activeCooking.get("active");
    database.close();
    clock.mockReturnValue(2000000120000);
    await database.open();
    const restored = await database.activeCooking.get("active");
    expect(restored).toEqual(saved);
    expect(restored!.timerEndsAt!).toBeLessThan(Date.now());
    await actions.patchActiveCooking(
      "chicken",
      { timerEndsAt: null, timerRemainingSeconds: 42 },
      2,
      "chicken",
    );
    database.close();
    await database.open();
    expect(await database.activeCooking.get("active")).toMatchObject({
      timerEndsAt: null,
      timerRemainingSeconds: 42,
    });
  });

  it("does not resurrect a completed cook through a delayed checklist or timer operation", async () => {
    const actions = createActions(database);
    await actions.startCooking("chicken", 2, null);
    const input: Omit<CookingSession, "id" | "updatedAt"> = {
      recipeId: "chicken",
      date: "2026-10-11",
      servingsPrepared: 2,
      servingsConsumed: 1,
      rating: 5,
      actualMinutes: 20,
      ingredientChanges: "",
      temperatureC: 180,
      timeChanges: "",
      notes: "Finished",
      wouldCookAgain: true,
    };
    await actions.saveCookingSession(input, true);
    await expect(
      actions.setCookingCheck("chicken", "step", 0, true, 2, "chicken"),
    ).rejects.toThrow("Cooking changed");
    await expect(
      actions.patchActiveCooking(
        "chicken",
        { timerEndsAt: Date.now() + 60000 },
        2,
        "chicken",
      ),
    ).rejects.toThrow("Cooking changed");
    expect(await database.activeCooking.get("active")).toBeUndefined();
    expect(await database.sessions.count()).toBe(1);
    expect(await database.recipeStates.get("chicken")).toMatchObject({
      tried: true,
      rating: 5,
    });
  });
});
