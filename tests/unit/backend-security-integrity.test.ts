// Security defects that are open at the time of writing. Each `it.fails` asserts the
// SAFE behaviour, so it passes while the defect exists. When the owner fixes the defect the
// assertion starts passing, `it.fails` then reports a failure, and the `.fails` should be
// removed. Findings: docs/backend/findings/security.md (SEC-*).
import "fake-indexeddb/auto";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import {
  createActions,
  exportBackup,
  importBackup,
  KitchenDB,
  maxBackupBytes,
  previewImport,
} from "../../src/lib/db";
import { effectiveRecipes, filterRecipes } from "../../src/lib/engine";
import {
  defaultPreferences,
  type KitchenData,
  type Recipe,
} from "../../src/lib/schema";
import savoury from "../../src/data/recipes-savoury.json";
import plant from "../../src/data/recipes-plant.json";

const catalogue = [...(savoury as Recipe[]), ...(plant as Recipe[])];
const byId = (id: string) => {
  const found = catalogue.find((recipe) => recipe.id === id);
  if (!found) throw new Error(`missing fixture ${id}`);
  return found;
};
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const withOverride = (recipe: Recipe, preferences: Partial<KitchenData["preferences"]>): KitchenData =>
  ({
    recipeStates: [],
    sessions: [],
    plans: [],
    pantry: [],
    shopping: [],
    customRecipes: [],
    overrides: [{ id: recipe.id, updatedAt: 1, recipe }],
    preferences: { ...defaultPreferences, ...preferences },
    activeCooking: undefined,
  }) as KitchenData;
const visibleUnder = (data: KitchenData, filters: Parameters<typeof filterRecipes>[1]) =>
  filterRecipes(effectiveRecipes(catalogue, data), filters, []).map((r) => r.id);

const databases: KitchenDB[] = [];
const fresh = () => {
  const database = new KitchenDB(`security-integrity-${crypto.randomUUID()}`);
  databases.push(database);
  return database;
};
afterEach(async () => {
  for (const database of databases.splice(0)) await database.delete();
});

const backupText = (rows: Partial<Record<string, unknown[]>>) =>
  JSON.stringify({
    format: "airfuel-kitchen",
    version: 2,
    exportedAt: 1,
    recipeStates: [],
    sessions: [],
    plans: [],
    pantry: [],
    shopping: [],
    customRecipes: [],
    overrides: [],
    preferences: [],
    activeCooking: [],
    ...rows,
  });

describe("SEC: an imported override must not weaken food restrictions", () => {
  // The canonical merge keeps baseline allergens and dietary claims, but it trusts the
  // override's ingredient list. Nothing ties the claims to the ingredients.
  it("SEC-1 hides a recipe whose override adds a meat ingredient from a vegetarian user", () => {
    const base = byId("air-fryer-sweet-potato-fries");
    expect(base.dietary).toContain("vegetarian");
    const edited = clone(base);
    edited.ingredients = [
      ...edited.ingredients,
      { name: "chicken thighs", quantity: 300, unit: "g", preparation: "", form: "fresh", aisle: "meat" },
    ];
    edited.steps = [...edited.steps, "Add the chicken and cook through."];
    const visible = visibleUnder(withOverride(edited, { dietary: ["vegetarian"] }), {
      dietary: ["vegetarian"],
    });
    expect(visible).not.toContain(base.id);
  });

  it("SEC-1 hides a recipe whose override adds peanuts from a peanut-excluding user", () => {
    const base = byId("air-fryer-sweet-potato-fries");
    const edited = clone(base);
    edited.ingredients = [
      ...edited.ingredients,
      { name: "roasted peanuts", quantity: 40, unit: "g", preparation: "", form: "dry", aisle: "pantry" },
    ];
    const visible = visibleUnder(withOverride(edited, { allergens: ["peanut"] }), {
      excludeAllergens: ["peanut"],
    });
    expect(visible).not.toContain(base.id);
  });
});

describe("SEC: far-future timestamps must not brick a record", () => {
  // nextTime() adds 1 to the stored updatedAt, which then exceeds the schema's
  // 8.64e15 ceiling. Every later edit to that row fails with a generic message.
  it("SEC-2 lets the user edit a row imported with updatedAt at the schema maximum", async () => {
    const MAX = 8640000000000000;
    const database = fresh();
    const actions = createActions(database);
    const text = backupText({
      recipeStates: [
        { id: "air-fryer-sweet-potato-fries", updatedAt: MAX, tried: false, triedAt: null, favourite: false, rating: null, notes: "", viewedAt: null },
      ],
    });
    const preview = await previewImport(text, database);
    await importBackup(preview, "merge", database);
    await expect(
      actions.patchRecipeState("air-fryer-sweet-potato-fries", { favourite: true }),
    ).resolves.toBeDefined();
  });
});

describe("SEC: a merge must not create data that can never be backed up", () => {
  // Each file respects the caps, but the merged table exceeds the 1000-row custom-recipe cap.
  // The merge succeeds, and every later export fails with "too many records".
  it("SEC-3 refuses a merge whose result exceeds a schema cap, or keeps export working", async () => {
    const database = fresh();
    const base = clone(byId("air-fryer-sweet-potato-fries"));
    const custom = (index: number) => {
      const recipe = clone(base);
      recipe.id = `custom-cap-${index}`;
      recipe.slug = recipe.id;
      return { id: recipe.id, updatedAt: 1, recipe };
    };
    await importBackup(
      await previewImport(backupText({ customRecipes: Array.from({ length: 600 }, (_, i) => custom(i)) }), database),
      "merge",
      database,
    );
    let mergeOutcome = "merged";
    try {
      await importBackup(
        await previewImport(backupText({ customRecipes: Array.from({ length: 600 }, (_, i) => custom(1000 + i)) }), database),
        "merge",
        database,
      );
    } catch {
      mergeOutcome = "refused";
    }
    let exportOutcome = "exported";
    try {
      await exportBackup(database);
    } catch {
      exportOutcome = "export-failed";
    }
    expect(mergeOutcome === "refused" || exportOutcome === "exported").toBe(true);
  }, 30_000);
});

describe("SEC: the UI restore limit must not be lower than the export ceiling", () => {
  // Regression guard: the Settings file check must use the export/import ceiling (SEC-4, fixed by lead).
  it("SEC-4 uses the same limit for the Settings file check as the library enforces", () => {
    const source = readFileSync(
      new URL("../../src/pages/Settings.tsx", import.meta.url),
      "utf8",
    );
    expect(source).toMatch(/file\.size > maxBackupBytes/);
    expect(source).not.toMatch(/file\.size > \d+ \* 1024 \* 1024/);
    expect(maxBackupBytes).toBe(20 * 1024 * 1024);
  });
});
