import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { backupSchema, recipeSchema } from "../../src/lib/schema";

async function exportedKitchen(page: Page) {
  await page.goto("/#/settings");
  const pending = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export backup", exact: true })
    .click();
  const path = await (await pending).path();
  expect(path).not.toBeNull();
  return backupSchema.parse(JSON.parse(await readFile(path!, "utf8")));
}

// Dispatch both native submissions in the same browser task, before React can
// disable the button. This exercises the synchronous ref rather than timing luck.
async function submitTwice(page: Page) {
  await page
    .getByRole("dialog")
    .locator("form")
    .evaluate((node) => {
      const form = node as HTMLFormElement;
      form.requestSubmit();
      form.requestSubmit();
    });
  await expect(page.getByRole("dialog")).toHaveCount(0);
}

test("editing a custom title preserves imported recipe metadata and resting time", async ({
  page,
}) => {
  const base = recipeSchema.parse(
    JSON.parse(
      readFileSync(
        new URL("../../src/data/recipes-savoury.json", import.meta.url),
        "utf8",
      ),
    )[0],
  );
  const custom = recipeSchema.parse({
    ...base,
    id: "custom-metadata-integrity",
    slug: "custom-metadata-integrity",
    title: "Imported personal roast",
    prepMinutes: 0,
    tags: ["Family favourite", "Sunday lunch"],
    sources: [
      ...base.sources,
      {
        title: "Additional personal reference",
        url: "https://example.com/recipe-notes",
        verifiedAt: "2026-01-02",
      },
    ],
    substitutions: ["Keep this personal substitution."],
    equipment: ["My named basket", "Digital thermometer"],
    difficulty: "Moderate",
    nutrition: { ...base.nutrition, fibre: 3.2 },
  });
  const backup = backupSchema.parse({
    format: "airfuel-kitchen",
    version: 2,
    exportedAt: Date.now(),
    recipeStates: [],
    sessions: [],
    plans: [],
    pantry: [],
    shopping: [],
    overrides: [],
    preferences: [],
    activeCooking: [],
    customRecipes: [{ id: custom.id, updatedAt: 1, recipe: custom }],
  });
  await page.goto("/#/settings");
  await page.getByLabel("Import backup file").setInputFiles({
    name: "metadata.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(backup)),
  });
  await page
    .getByRole("button", { name: "Restore backup", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.goto("/#/custom");
  await page
    .getByRole("button", { name: "Edit Imported personal roast", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Recipe name", exact: true })
    .fill("Renamed personal roast");
  await submitTwice(page);
  const saved = await exportedKitchen(page);
  expect(saved.customRecipes).toHaveLength(1);
  expect(saved.customRecipes[0].recipe).toEqual({
    ...custom,
    title: "Renamed personal roast",
  });
});

test("same-task submissions create one plan and one manual item each", async ({
  page,
}) => {
  await page.goto("/#/planner");
  await page
    .getByRole("button", { name: /^Add meal to dinner, / })
    .first()
    .click();
  await submitTwice(page);
  await expect(page.locator(".planned-meal")).toHaveCount(1);

  await page.goto("/#/pantry");
  await page
    .getByRole("button", { name: "Add ingredient", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByLabel("Ingredient", { exact: true })
    .fill("Integrity pantry item");
  await submitTwice(page);

  await page.goto("/#/shopping");
  await page.getByRole("button", { name: "Add an item", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByLabel("Ingredient", { exact: true })
    .fill("Integrity manual item");
  await submitTwice(page);
  const saved = await exportedKitchen(page);
  expect(saved.plans).toHaveLength(1);
  expect(saved.pantry).toHaveLength(1);
  expect(saved.shopping.filter((row) => row.manual)).toHaveLength(1);
});
