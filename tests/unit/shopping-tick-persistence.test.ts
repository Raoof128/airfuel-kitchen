import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  KitchenDB,
  createActions,
  readKitchen,
} from "../../src/lib/db";
import { buildShoppingList } from "../../src/lib/engine";

let database: KitchenDB;
beforeEach(() => {
  database = new KitchenDB(`test-${crypto.randomUUID()}`);
});
afterEach(async () => {
  await database.delete();
});

// Mirrors Planning.tsx Shopping: the checkbox saves the displayed row with the new tick.
async function displayedRows() {
  const data = await readKitchen(database);
  return buildShoppingList([], [], data.pantry, data.shopping);
}

describe("manual shopping ticks persist", () => {
  it("keeps a tick on a manual item even when a pantry item has the same name", async () => {
    const actions = createActions(database);
    await actions.savePantry({ name: "Greek yoghurt", quantity: 200, unit: "g", form: "raw" });
    const id = await actions.saveShopping({
      name: "Greek yoghurt",
      quantity: 500,
      unit: "g",
      form: "raw",
      aisle: "Dairy",
      checked: false,
      manual: true,
    });
    const [row] = (await displayedRows()).filter((item) => item.id === id);
    expect(row).toBeDefined();
    await actions.saveShopping({ ...row!, checked: true });
    const stored = (await readKitchen(database)).shopping.find((item) => item.id === id);
    expect(stored?.checked).toBe(true);
    expect((await displayedRows()).find((item) => item.id === id)?.checked).toBe(true);
  });

  it("sends the displayed row back unchanged, so a toggle is not treated as an edit", async () => {
    const actions = createActions(database);
    const id = await actions.saveShopping({
      name: "Greek yoghurt",
      quantity: 500,
      unit: "g",
      form: "raw",
      aisle: "Dairy",
      checked: false,
      manual: true,
    });
    const before = (await readKitchen(database)).shopping.find((item) => item.id === id)!;
    const [row] = (await displayedRows()).filter((item) => item.id === id);
    expect(row).toMatchObject({ name: before.name, quantity: before.quantity, unit: before.unit, form: before.form });
    await actions.saveShopping({ ...row!, checked: true });
    expect((await readKitchen(database)).shopping.find((item) => item.id === id)?.checked).toBe(true);
  });

  it("a later save of the same row keeps its tick", async () => {
    const actions = createActions(database);
    const id = await actions.saveShopping({
      name: "Greek yoghurt",
      quantity: 500,
      unit: "g",
      form: "raw",
      aisle: "Dairy",
      checked: false,
      manual: true,
    });
    await actions.saveShopping({ ...(await displayedRows()).find((r) => r.id === id)!, checked: true });
    const [row] = (await displayedRows()).filter((item) => item.id === id);
    await actions.saveShopping({ ...row!, checked: row!.checked });
    expect((await readKitchen(database)).shopping.find((item) => item.id === id)?.checked).toBe(true);
  });
});
