import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { defaultPreferences, type Recipe } from "../../src/lib/schema";
const recipes = JSON.parse(
  readFileSync(
    new URL("../../src/data/recipes-savoury.json", import.meta.url),
    "utf8",
  ),
) as Recipe[];
const recipe = recipes.find((row) => row.id === "air-fryer-chicken-breasts")!;
const route = `/#/recipe/${recipe.slug}`;
const baseBackup = () => ({
  format: "airfuel-kitchen",
  version: 2,
  exportedAt: Date.now(),
  recipeStates: [],
  sessions: [],
  plans: [],
  pantry: [],
  shopping: [],
  customRecipes: [],
  overrides: [],
  preferences: [],
  activeCooking: [],
});

test("notes stay plain text and malformed backup does not overwrite them", async ({
  page,
}) => {
  const payload =
    '<img src=x onerror="window.__airfuelXss=true"> <script>window.__airfuelXss=true</script>';
  await page.goto(route);
  await page.getByLabel("Personal recipe notes").fill(payload);
  await page.getByRole("button", { name: "Save notes", exact: true }).click();
  await expect(page.locator(".toast[role=status]")).toContainText(
    "Recipe notes saved",
  );
  await page.reload();
  await expect(page.getByLabel("Personal recipe notes")).toHaveValue(payload);
  expect(
    await page.evaluate(
      () => (window as unknown as Record<string, unknown>).__airfuelXss,
    ),
  ).toBeUndefined();
  await page.goto("/#/settings");
  await page.getByLabel("Import backup file").setInputFiles({
    name: "untrusted.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({ ...baseBackup(), unexpected: { script: payload } }),
    ),
  });
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.goto(route);
  await expect(page.getByLabel("Personal recipe notes")).toHaveValue(payload);
});

test("separate tabs preserve simultaneous cooking checklist changes and timer", async ({
  page,
  context,
}) => {
  await page.goto(route);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    recipe.title,
  );
  await page
    .getByRole("button", { name: "Start cooking", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Begin cooking", exact: true })
    .click();
  await page.getByRole("link", { name: "Back to recipe", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Continue cooking", exact: true }),
  ).toBeVisible();
  const second = await context.newPage();
  await second.goto(route);
  await expect(second.getByRole("heading", { level: 1 })).toHaveText(
    recipe.title,
  );
  await Promise.all([
    page.locator('.ingredient-list input[type="checkbox"]').nth(0).check(),
    second.locator('.ingredient-list input[type="checkbox"]').nth(1).check(),
  ]);
  await expect(
    page.locator('.ingredient-list input[type="checkbox"]').nth(0),
  ).toBeChecked();
  await expect(
    page.locator('.ingredient-list input[type="checkbox"]').nth(1),
  ).toBeChecked();
  await second
    .getByRole("button", { name: "Start timer", exact: true })
    .click();
  await page.locator('.method-list input[type="checkbox"]').nth(0).check();
  // The tick is shown before it is saved. Wait until the save is acknowledged, or the reload
  // below aborts the pending IndexedDB transaction and the tick is lost.
  await expect(
    page.locator('.method-list input[type="checkbox"]').nth(0),
  ).not.toHaveAttribute("aria-busy");
  await expect(
    page.locator('.method-list input[type="checkbox"]').nth(0),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Pause timer", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.locator('.ingredient-list input[type="checkbox"]').nth(0),
  ).toBeChecked();
  await expect(
    page.locator('.ingredient-list input[type="checkbox"]').nth(1),
  ).toBeChecked();
  await expect(
    page.locator('.method-list input[type="checkbox"]').nth(0),
  ).toBeChecked();
  await expect(
    page.getByRole("button", { name: "Pause timer", exact: true }),
  ).toBeVisible();
  await second.close();
});

test("unverified custom recipe cannot bypass a saved allergen exclusion through a backup", async ({
  page,
}) => {
  const custom: Recipe = {
    ...recipe,
    id: "custom-undeclared-milk",
    slug: "custom-undeclared-milk",
    title: "Undeclared milk dish",
    allergens: [],
    ingredients: [
      { ...recipe.ingredients[0], name: "Milk", unit: "ml", quantity: 200 },
    ],
  };
  const backup = {
    ...baseBackup(),
    customRecipes: [{ id: custom.id, updatedAt: Date.now(), recipe: custom }],
    preferences: [
      { ...defaultPreferences, updatedAt: Date.now(), allergens: ["milk"] },
    ],
  };
  await page.goto("/#/settings");
  await page.getByLabel("Import backup file").setInputFiles({
    name: "custom.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(backup)),
  });
  await expect(
    page.getByRole("dialog", { name: "Review your backup" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Restore backup", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.goto("/#/explore");
  await page
    .getByRole("textbox", { name: "Search catalogue" })
    .fill(custom.title);
  await expect(
    page.getByRole("heading", { name: "No recipes on this shelf" }),
  ).toBeVisible();
  await page.goto("/#/custom");
  await expect(
    page.getByRole("link", { name: custom.title, exact: true }),
  ).toBeVisible();
});
