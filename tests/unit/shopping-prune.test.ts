import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  KitchenDB,
  createActions,
  pruneStaleGeneratedShopping,
} from "../../src/lib/db";
import type { ShoppingItem } from "../../src/lib/schema";

let database: KitchenDB;
beforeEach(() => {
  database = new KitchenDB(`test-${crypto.randomUUID()}`);
});
afterEach(async () => {
  await database.delete();
});

const row = (id: string, manual = false): ShoppingItem => ({
  id,
  updatedAt: 1,
  name: "paprika",
  quantity: 1,
  unit: "tsp",
  form: "raw",
  aisle: "Pantry",
  checked: true,
  manual,
});

describe("stale generated shopping ticks", () => {
  it("removes generated ticks for weeks older than the retention window only", async () => {
    await database.shopping.bulkPut([
      row("week-2026-08-03:generated:paprika"), // ~10 weeks before today
      row("week-2026-09-07:generated:paprika"), // 5 weeks before today
      row("week-2026-09-21:generated:paprika"), // 2 weeks before today
      row("week-2026-10-05:generated:paprika"), // this week
      row("week-2026-08-03:manual-kept", true), // manual items are never pruned
      row("direct-air-fryer-chicken-thighs-0", true),
    ]);
    const removed = await pruneStaleGeneratedShopping(database.shopping, "2026-10-11");
    expect(removed).toBe(2);
    const left = (await database.shopping.toArray()).map((item) => item.id).sort();
    expect(left).toEqual([
      "direct-air-fryer-chicken-thighs-0",
      "week-2026-08-03:manual-kept",
      "week-2026-09-21:generated:paprika",
      "week-2026-10-05:generated:paprika",
    ]);
  });

  it("runs on save so the table does not grow without bound", async () => {
    const actions = createActions(database);
    await database.shopping.put(row("week-2025-01-06:generated:old"));
    await actions.saveShopping({
      name: "rice",
      quantity: 200,
      unit: "g",
      form: "raw",
      aisle: "Pantry",
      checked: false,
      manual: true,
    });
    expect((await database.shopping.toArray()).map((item) => item.id)).not.toContain(
      "week-2025-01-06:generated:old",
    );
  });
});
