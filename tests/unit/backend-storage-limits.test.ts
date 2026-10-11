import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterEach, describe, expect, it } from "vitest";
import {
  createActions,
  exportBackup,
  importBackup,
  KitchenDB,
  previewImport,
} from "../../src/lib/db";
import {
  backupLimits,
  customRecipeSchema,
  recipeSchema,
  type Recipe,
} from "../../src/lib/schema";

const databases: KitchenDB[] = [];
afterEach(async () => {
  for (const database of databases.splice(0)) {
    database.close();
    await Dexie.delete(database.name);
  }
});
const makeDB = () => {
  const database = new KitchenDB(`limits-${crypto.randomUUID()}`);
  databases.push(database);
  return database;
};

const MAX_TIMESTAMP = 8640000000000000;

const custom = (id: string): Recipe => ({
  id,
  slug: id,
  title: `Recipe ${id}`,
  description: "Personal recipe",
  category: "breakfast",
  tags: [],
  sources: [
    { title: "Source", url: "https://example.com/r", verifiedAt: "2026-10-01" },
  ],
  prepMinutes: 1,
  cookMinutes: 4,
  totalMinutes: 5,
  temperatureC: 180,
  servings: 1,
  portion: "1 slice",
  ingredients: [
    {
      name: "Bread",
      quantity: 1,
      unit: "each",
      preparation: "",
      form: "sliced",
      aisle: "Bakery",
    },
  ],
  steps: ["Toast."],
  preheat: false,
  preheatMinutes: 0,
  turn: "",
  safety: [],
  internalTempC: null,
  nutrition: {
    protein: 4,
    calories: 90,
    carbs: 16,
    fat: 1,
    fibre: 2,
    method: "Label",
    confidence: "estimated",
    reference: "Label",
  },
  allergens: ["wheat", "gluten"],
  dietary: [],
  substitutions: [],
  oilFree: true,
  storage: "",
  equipment: [],
  difficulty: "Easy",
  image: {
    src: "/images/toast.webp",
    alt: "Toast",
    credit: "Own photo",
    licence: "Own work",
  },
});

describe("SEC-2: a row at the timestamp ceiling stays editable", () => {
  it("saves, toggles and notes a pantry row and recipe state imported at the maximum", async () => {
    const source = makeDB();
    await source.pantry.put({
      id: "p1",
      updatedAt: MAX_TIMESTAMP,
      name: "Salt",
      quantity: 1,
      unit: "tsp",
      form: "fine",
    });
    await source.recipeStates.put({
      id: "toast",
      updatedAt: MAX_TIMESTAMP,
      tried: true,
      triedAt: 1,
      favourite: false,
      rating: null,
      notes: "",
      viewedAt: null,
    });
    const target = makeDB();
    await importBackup(
      await previewImport(await exportBackup(source), target),
      "merge",
      target,
    );
    const actions = createActions(target);
    await expect(
      actions.savePantry({
        id: "p1",
        name: "Salt",
        quantity: 2,
        unit: "tsp",
        form: "fine",
      }),
    ).resolves.toBe("p1");
    await expect(
      actions.patchRecipeState("toast", { favourite: true }),
    ).resolves.toMatchObject({ favourite: true });
    await expect(
      actions.saveRecipeNotes("toast", "later", ""),
    ).resolves.toMatchObject({ notes: "later" });
    expect((await target.pantry.get("p1"))!.updatedAt).toBeLessThanOrEqual(
      MAX_TIMESTAMP,
    );
    expect(
      (await target.recipeStates.get("toast"))!.updatedAt,
    ).toBeLessThanOrEqual(MAX_TIMESTAMP);
  });
});

describe("SEC-3: a merge cannot leave more records than a backup can hold", () => {
  it("refuses a merge that would exceed the custom-recipe cap, and writes nothing", async () => {
    const local = makeDB();
    const remote = makeDB();
    const localRows = Array.from(
      { length: backupLimits.customRecipes * 0 + 600 },
      (_, i) => ({
        id: `custom-a-${i}`,
        updatedAt: 1,
        recipe: custom(`custom-a-${i}`),
      }),
    );
    const remoteRows = Array.from({ length: 600 }, (_, i) => ({
      id: `custom-b-${i}`,
      updatedAt: 1,
      recipe: custom(`custom-b-${i}`),
    }));
    await local.customRecipes.bulkPut(localRows);
    await remote.customRecipes.bulkPut(remoteRows);
    const preview = await previewImport(await exportBackup(remote), local);
    await expect(importBackup(preview, "merge", local)).rejects.toThrow(
      `more than a backup can hold (${backupLimits.customRecipes})`,
    );
    expect(await local.customRecipes.count()).toBe(600);
    // The local state is still exportable.
    expect(JSON.parse(await exportBackup(local)).customRecipes).toHaveLength(
      600,
    );
  });

  it("allows a merge that lands exactly on the cap", async () => {
    const local = makeDB();
    const remote = makeDB();
    await local.customRecipes.bulkPut(
      Array.from({ length: 500 }, (_, i) => ({
        id: `custom-a-${i}`,
        updatedAt: 1,
        recipe: custom(`custom-a-${i}`),
      })),
    );
    await remote.customRecipes.bulkPut(
      Array.from({ length: 500 }, (_, i) => ({
        id: `custom-b-${i}`,
        updatedAt: 1,
        recipe: custom(`custom-b-${i}`),
      })),
    );
    await importBackup(
      await previewImport(await exportBackup(remote), local),
      "merge",
      local,
    );
    expect(await local.customRecipes.count()).toBe(1000);
    expect(JSON.parse(await exportBackup(local)).customRecipes).toHaveLength(
      1000,
    );
  });

  it("refuses a new custom recipe once the cap is reached, with a plain sentence", async () => {
    const database = makeDB();
    await database.customRecipes.bulkPut(
      Array.from({ length: backupLimits.customRecipes }, (_, i) => ({
        id: `custom-full-${i}`,
        updatedAt: 1,
        recipe: custom(`custom-full-${i}`),
      })),
    );
    await expect(
      createActions(database).saveCustomRecipe(custom("custom-one-more")),
    ).rejects.toThrow("the most customRecipes records a backup can contain");
    expect(await database.customRecipes.count()).toBe(
      backupLimits.customRecipes,
    );
    // Editing an existing recipe is still allowed at the cap.
    await expect(
      createActions(database).saveCustomRecipe(custom("custom-full-0")),
    ).resolves.toBe("custom-full-0");
  });
});

describe("SEC-6: a malformed source URL is a field issue, not an exception", () => {
  it.each(["not a url", "/relative", "//example.com/recipe"])(
    "rejects %s as an issue on the URL field",
    (url) => {
      const bad = {
        ...custom("custom-url"),
        sources: [{ title: "Source", url, verifiedAt: "2026-01-01" }],
      };
      const result = recipeSchema.safeParse(bad);
      expect(result.success).toBe(false);
      expect(
        result.error?.issues.some(
          (issue) => issue.path.join(".") === "sources.0.url",
        ),
      ).toBe(true);
    },
  );

  it("save reports the HTTPS field message, not the raw 'Invalid URL'", async () => {
    const database = makeDB();
    const bad = {
      ...custom("custom-url"),
      sources: [
        { title: "Source", url: "not a url", verifiedAt: "2026-01-01" },
      ],
    };
    const error = await createActions(database)
      .saveCustomRecipe(bad)
      .catch((caught: unknown) => caught);
    expect((error as Error).message).toBe(
      "Some details are not valid. Check the highlighted fields and try again.",
    );
    expect(
      customRecipeSchema.safeParse({
        id: "custom-url",
        updatedAt: 1,
        recipe: bad,
      }).success,
    ).toBe(false);
  });

  it("still accepts a valid https source", () => {
    expect(recipeSchema.safeParse(custom("custom-ok")).success).toBe(true);
  });
});
