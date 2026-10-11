// Security regression tests for untrusted input: backup files, sync payloads and note text.
// Owner: security (SEC-*). Findings are in docs/backend/findings/security.md.
import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { createActions, KitchenDB, previewImport } from "../../src/lib/db";
import { backupSchema, recipeSchema } from "../../src/lib/schema";
import savoury from "../../src/data/recipes-savoury.json";

const sample = (savoury as unknown as Record<string, unknown>[])[0];
const emptyBackup = (extra: Record<string, unknown> = {}) =>
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
    ...extra,
  });
const customRecipe = (
  overrides: Record<string, unknown> = {},
  id = "custom-security-probe",
) => {
  const recipe = JSON.parse(JSON.stringify(sample));
  recipe.id = id;
  recipe.slug = id;
  Object.assign(recipe, overrides);
  return recipe as Record<string, unknown> & { sources: unknown[] };
};

const databases: KitchenDB[] = [];
const fresh = () => {
  const database = new KitchenDB(`security-input-${crypto.randomUUID()}`);
  databases.push(database);
  return database;
};
afterEach(async () => {
  for (const database of databases.splice(0)) await database.delete();
});

describe("backup import rejects hostile structure", () => {
  it("rejects a __proto__ key and leaves Object.prototype untouched", async () => {
    const text = emptyBackup().replace(
      /\}$/,
      ',"__proto__":{"polluted":true}}',
    );
    await expect(previewImport(text, fresh())).rejects.toThrow(
      /not an AirFuel Kitchen backup/,
    );
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("rejects a constructor key at top level and inside a row", () => {
    expect(() =>
      backupSchema.parse(
        JSON.parse(emptyBackup({ constructor: { prototype: { x: 1 } } })),
      ),
    ).toThrow();
    const row = {
      id: "p1",
      updatedAt: 1,
      name: "flour",
      quantity: 1,
      unit: "g",
      form: "dry",
    };
    expect(() =>
      backupSchema.parse(
        JSON.parse(
          emptyBackup({
            pantry: [JSON.parse(JSON.stringify({ ...row, constructor: { a: 1 } }))],
          }),
        ),
      ),
    ).toThrow();
  });

  it("rejects unknown fields inside a nested custom recipe ingredient", () => {
    const recipe = customRecipe();
    (recipe.ingredients as Record<string, unknown>[])[0].hiddenAllergen = "none";
    expect(() => recipeSchema.parse(recipe)).toThrow();
  });

  it("refuses JSON nested 200,000 levels deep with the backup sentence, not a crash", async () => {
    const deep = "[".repeat(200_000) + "]".repeat(200_000);
    await expect(previewImport(deep, fresh())).rejects.toThrow(
      /not an AirFuel Kitchen backup/,
    );
  });

  it("refuses text over 20 MB before parsing it", async () => {
    const huge = "x".repeat(20 * 1024 * 1024 + 1);
    await expect(previewImport(huge, fresh())).rejects.toThrow(/exceeds 20 MB/);
  });

  it("caps row counts so a 20,001-row list cannot be imported", () => {
    const rows = Array.from({ length: 20001 }, (_, index) => ({
      id: `r${index}`,
      updatedAt: 1,
      tried: false,
      triedAt: null,
      favourite: false,
      rating: null,
      notes: "",
      viewedAt: null,
    }));
    expect(() =>
      backupSchema.parse(JSON.parse(emptyBackup({ recipeStates: rows }))),
    ).toThrow();
  });
});

describe("custom recipe links and fields stay inside safe schemes", () => {
  it.each([
    ["javascript:alert(1)"],
    ["data:text/html,<script>alert(1)</script>"],
    ["http://example.com/recipe"],
    ["vbscript:msgbox(1)"],
  ])("refuses source URL %s", (url) => {
    const recipe = customRecipe({
      sources: [{ title: "Source", url, verifiedAt: "2026-01-01" }],
    });
    expect(recipeSchema.safeParse(recipe).success).toBe(false);
  });

  // SEC-6: a non-absolute source makes `new URL()` throw inside the refine, so safeParse throws a
  // TypeError instead of returning a ZodError. Save then shows the raw text "Invalid URL".
  it.each([["//example.com/recipe"], ["/relative"], ["not a url"]])(
    "SEC-6 reports %s as a validation issue instead of throwing",
    (url) => {
      const recipe = customRecipe({
        sources: [{ title: "Source", url, verifiedAt: "2026-01-01" }],
      });
      let result: { success: boolean } | undefined;
      expect(() => {
        result = recipeSchema.safeParse(recipe);
      }).not.toThrow();
      expect(result?.success).toBe(false);
    },
  );

  it("accepts an https source and keeps it verbatim", () => {
    const url = "https://example.com/recipe?x=1";
    const recipe = customRecipe({
      sources: [{ title: "Source", url, verifiedAt: "2026-01-01" }],
    });
    const parsed = recipeSchema.parse(recipe);
    expect(parsed.sources[0].url).toBe(url);
  });

  it("refuses an image path that escapes /images/", () => {
    for (const src of [
      "javascript:alert(1)",
      "/images/../secret.png",
      "https://example.com/x.png",
      "/images/x.svg?onload=1",
    ])
      expect(
        recipeSchema.safeParse(
          customRecipe({
            image: { ...(sample.image as object), src },
          }),
        ).success,
      ).toBe(false);
  });

  it("stores markup in titles as inert text: the schema keeps it, the renderer must escape it", () => {
    // React escapes text children; scripts/security-probe confirms no injected node in a browser.
    const payload = `<img src=x onerror="window.__xss=1">`;
    const parsed = recipeSchema.parse(customRecipe({ title: payload }));
    expect(parsed.title).toBe(payload);
  });
});

describe("note and text bounds", () => {
  it("rejects a recipe note over 10,000 characters", async () => {
    const database = fresh();
    const actions = createActions(database);
    await expect(
      actions.saveRecipeNotes("air-fryer-sweet-potato-fries", "a".repeat(10001), ""),
    ).rejects.toThrow();
  });

  it("rejects an ingredient list over 100 entries", () => {
    const recipe = customRecipe();
    recipe.ingredients = Array.from({ length: 101 }, () =>
      JSON.parse(JSON.stringify((sample.ingredients as object[])[0])),
    );
    expect(recipeSchema.safeParse(recipe).success).toBe(false);
  });
});

describe("sync payload size matches the server limit", () => {
  // migration: check (octet_length(payload::text) <= 524288). The client accepts up to 100 steps
  // of 10,000 characters, so one legitimate custom recipe can be queued and then rejected. The
  // sync loop has no per-record error handling, so that one rejection stops every later record.
  it.fails("SEC-7 refuses to queue a record the server will reject as over 512 KB", async () => {
    const { validateWire } = await import("../../src/cloud/core");
    const recipe = customRecipe();
    recipe.steps = Array.from({ length: 60 }, () => "s".repeat(9000));
    const payload = recipeWrapper(recipe);
    expect(JSON.stringify(payload).length).toBeGreaterThan(524288);
    expect(() =>
      validateWire({
        entity: "customRecipes",
        record_id: recipe.id,
        revision: 1,
        operation_id: crypto.randomUUID(),
        deleted: false,
        payload,
      }),
    ).toThrow();
  });
});

function recipeWrapper(recipe: Record<string, unknown>) {
  return { id: recipe.id, updatedAt: 1, recipe };
}
