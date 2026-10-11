import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  KitchenDB,
  createActions,
  exportBackup,
  previewImport,
  readKitchen,
} from "../../src/lib/db";

let database: KitchenDB;
beforeEach(() => {
  database = new KitchenDB(`test-${crypto.randomUUID()}`);
});
afterEach(async () => {
  await database.delete();
});

describe("wrong-schema backups", () => {
  it("reports a plain sentence with a short field hint, not raw schema JSON", async () => {
    const backup = JSON.parse(await exportBackup(database));
    backup.recipeStates = [{ id: "chicken", rating: 9 }];
    const error = await previewImport(JSON.stringify(backup), database).catch(
      (caught: unknown) => caught as Error,
    );
    expect(error).toBeInstanceOf(Error);
    expect(error.message.startsWith("This file is not an AirFuel Kitchen backup.")).toBe(true);
    expect(error.message).toContain("Problem at recipeStates");
    expect(error.message).not.toContain("[");
    expect(error.message).not.toContain('"code"');
  });

  it("keeps the detailed Zod issues available on cause", async () => {
    const backup = JSON.parse(await exportBackup(database));
    backup.format = "something-else";
    const error = await previewImport(JSON.stringify(backup), database).catch(
      (caught: unknown) => caught as Error,
    );
    expect(error.cause).toBeInstanceOf(z.ZodError);
    expect((error.cause as z.ZodError).issues.length).toBeGreaterThan(0);
  });

  it("writes nothing when the file is rejected", async () => {
    const actions = createActions(database);
    await actions.patchRecipeState("chicken", { tried: true });
    const backup = JSON.parse(await exportBackup(database));
    backup.version = 99;
    await expect(previewImport(JSON.stringify(backup), database)).rejects.toThrow(
      "This file is not an AirFuel Kitchen backup.",
    );
    expect((await readKitchen(database)).recipeStates).toHaveLength(1);
  });
});
