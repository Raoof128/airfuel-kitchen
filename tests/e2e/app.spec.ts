import { test, expect, chromium, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const recipePath = "/#/recipe/air-fryer-chicken-fajitas";
async function openRecipe(page: Page) {
  await page.goto(recipePath);
  await expect(
    page.getByRole("heading", { name: "Chicken fajita filling", exact: true }),
  ).toBeVisible();
}

test("acceptance journey survives a full browser restart, plans, export and offline reopening", async () => {
  const profile = await mkdtemp(join(tmpdir(), "airfuel-e2e-"));
  const options = {
    baseURL: "http://127.0.0.1:4173",
    headless: true,
    viewport: { width: 1440, height: 1000 },
    colorScheme: "light" as const,
  };
  let context = await chromium.launchPersistentContext(profile, options);
  try {
    let page = await context.newPage();
    await page.goto("/#/explore");
    await page
      .getByRole("textbox", { name: "Search catalogue" })
      .fill("chicken breast");
    await page.getByRole("button", { name: "Filters", exact: true }).click();
    await page.getByLabel("Maximum total time (min)").fill("24");
    await expect(
      page.getByRole("link", { name: "Chicken fajita filling", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("link", { name: "Chicken fajita filling", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Mark as tried" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Mark as tried" }).click();
    await page
      .getByRole("button", { name: "Rate 5 stars", exact: true })
      .click();
    await page
      .getByLabel("Personal recipe notes")
      .fill("Great with paprika. Cook slightly less next time.");
    await page.getByRole("button", { name: "Save notes", exact: true }).click();
    await expect(page.locator(".toast[role=status]")).toContainText(
      "Recipe notes saved",
    );
    await page
      .getByRole("button", { name: "Save recipe", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Save recipe", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
    await context.close();
    context = await chromium.launchPersistentContext(profile, options);
    page = await context.newPage();
    await openRecipe(page);
    await expect(
      page.getByRole("button", { name: "Mark as tried", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(
      page.getByRole("button", { name: "Rate 5 stars", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByLabel("Personal recipe notes")).toHaveValue(
      "Great with paprika. Cook slightly less next time.",
    );
    await page
      .getByRole("button", { name: "Add to meal plan", exact: true })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Add to meal plan", exact: true })
      .click();
    await expect(page.locator(".toast[role=status]")).toContainText(
      "Added to your meal plan",
    );
    await page.goto("/#/shopping");
    await expect(page.locator(".shopping-row")).not.toHaveCount(0);
    // Checkboxes stay enabled while saving (aria-busy marks the save), so wait
    // for the save to finish and the stored count to change before reloading.
    const checkbox = page.locator(".shopping-row input").first();
    const progress = page.locator(".shopping-progress strong");
    const before = (await progress.textContent()) ?? "";
    const ticked = Number(before.match(/^(\d+) of/)?.[1]);
    const total = before.match(/ of (\d+)/)?.[1];
    await checkbox.check();
    await expect(checkbox).not.toHaveAttribute("aria-busy", "true");
    await expect(progress).toHaveText(
      `${ticked + 1} of ${total} items ticked off`,
    );
    await page.reload();
    await expect(page.locator(".shopping-row input").first()).toBeChecked();
    await page.goto("/#/settings");
    const download = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Export backup", exact: true })
      .click();
    const file = await (await download).path();
    const backup = JSON.parse(await readFile(file!, "utf8"));
    expect(
      backup.recipeStates.find(
        (s: { id: string }) => s.id === "air-fryer-chicken-fajitas",
      ).rating,
    ).toBe(5);
    expect(backup.plans).toHaveLength(1);
    await page.goto("/#/");
    await expect(page.locator(".stats-rail")).toContainText("1Recipes tried");
    await expect(page.locator(".progress-row")).toContainText(
      "0g protein logged",
    );
    await context.setOffline(true);
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "What’s cooking today?" }),
    ).toBeVisible();
    await page.goto(recipePath);
    await expect(page.getByLabel("Personal recipe notes")).toHaveValue(
      "Great with paprika. Cook slightly less next time.",
    );
    await expect(page.locator(".hero-image img")).toHaveJSProperty(
      "complete",
      true,
    );
    await page.goto("/#/planner");
    await expect(page.locator(".planned-meal")).toHaveCount(1);
    await page.goto("/#/shopping");
    await expect(page.locator(".shopping-row input").first()).toBeChecked();
  } finally {
    await context.close();
    await rm(profile, { recursive: true, force: true });
  }
});

test("tried is independent of consumed protein; session edits and deletion persist", async ({
  page,
}) => {
  await openRecipe(page);
  await page.getByRole("button", { name: "Mark as tried" }).click();
  await page
    .getByRole("spinbutton", { name: "Servings", exact: true })
    .fill("4");
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
  await page
    .getByRole("button", { name: "Finished? Save a cooking memory" })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Servings prepared")).toHaveValue("4");
  await dialog.getByLabel("Servings you ate").fill("1");
  await dialog.getByLabel("Rating", { exact: true }).selectOption("5");
  await dialog
    .getByLabel("Cooking notes", { exact: true })
    .fill("Juicy and quick.");
  await dialog.getByRole("button", { name: "Save cooking session" }).click();
  await expect(page.locator(".toast[role=status]")).toContainText(
    "Cooking memory saved",
  );
  await expect(
    page.getByRole("button", { name: "Start cooking", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Close cooking checklist", exact: true }),
  ).toHaveCount(0);
  await page.goto("/#/journal");
  await expect(page.locator(".journal-entry")).toHaveCount(1);
  await page.getByRole("button", { name: /Edit cooking session/ }).click();
  await page
    .getByRole("dialog")
    .getByLabel("Cooking notes", { exact: true })
    .fill("Edited memory");
  await page.getByRole("button", { name: "Save cooking session" }).click();
  await expect(page.locator(".toast[role=status]")).toContainText(
    "Cooking session updated",
  );
  await page.reload();
  await expect(page.getByText("Edited memory", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /Delete cooking session/ }).click();
  await page.getByRole("button", { name: "Keep memory", exact: true }).click();
  await expect(page.locator(".journal-entry")).toHaveCount(1);
  await page.getByRole("button", { name: /Delete cooking session/ }).click();
  await page
    .getByRole("button", { name: "Delete memory", exact: true })
    .click();
  await expect(page.locator(".journal-entry")).toHaveCount(0);
});

test("timer and checklists persist, and two tabs merge independent recipe memories", async ({
  page,
  context,
}) => {
  await openRecipe(page);
  await page
    .getByRole("button", { name: "Start cooking", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Begin cooking", exact: true })
    .click();
  await page.getByRole("link", { name: "Back to recipe", exact: true }).click();
  await page.locator(".ingredient-list input").first().check();
  await page.locator(".method-list input").first().check();
  await page.getByRole("button", { name: "Start timer", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Pause timer", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(page.locator(".ingredient-list input").first()).toBeChecked();
  await expect(page.locator(".method-list input").first()).toBeChecked();
  await expect(page.getByRole("button", { name: "Pause timer" })).toBeVisible();
  const second = await context.newPage();
  await openRecipe(second);
  await Promise.all([
    page.getByRole("button", { name: "Rate 4 stars" }).click(),
    second.getByRole("button", { name: "Save recipe", exact: true }).click(),
  ]);
  await expect(
    page.getByRole("button", { name: "Save recipe", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    second.getByRole("button", { name: "Rate 4 stars" }),
  ).toHaveAttribute("aria-pressed", "true");
  await Promise.all([
    page.locator(".ingredient-list input").nth(1).check(),
    second.locator(".method-list input").nth(1).check(),
  ]);
  await expect(page.locator(".method-list input").nth(1)).toBeChecked();
  await expect(second.locator(".ingredient-list input").nth(1)).toBeChecked();
});

test("validated backup preview, merge, replace confirmation, and corrupt import rejection", async ({
  page,
}) => {
  await openRecipe(page);
  await page.getByLabel("Personal recipe notes").fill("A backup memory");
  await page.getByRole("button", { name: "Save notes", exact: true }).click();
  await page.goto("/#/settings");
  const d = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export backup", exact: true })
    .click();
  const path = await (await d).path();
  await page.getByLabel("Import backup file").setInputFiles(path!);
  await expect(page.getByRole("dialog")).toContainText("Existing IDs");
  await page.getByRole("button", { name: "Restore backup" }).click();
  await expect(page.locator(".toast[role=status]")).toContainText(
    "Backup restored",
  );
  await page.getByLabel("Import backup file").setInputFiles(path!);
  await page
    .getByLabel("How should this backup be restored?")
    .selectOption("replace");
  await expect(
    page.getByRole("button", { name: "Restore backup" }),
  ).toBeDisabled();
  await page
    .getByLabel("I understand this replaces all current personal data.")
    .check();
  await page.getByRole("button", { name: "Restore backup" }).click();
  await expect(page.locator(".toast[role=status]")).toContainText(
    "Backup restored",
  );
  await page.getByLabel("Import backup file").setInputFiles({
    name: "bad.json",
    mimeType: "application/json",
    buffer: Buffer.from('{"format":"airfuel-kitchen","version":999}'),
  });
  await expect(page.getByRole("alert")).toBeVisible();
  await openRecipe(page);
  await expect(page.getByLabel("Personal recipe notes")).toHaveValue(
    "A backup memory",
  );
});

test("pantry entries, manual shopping edits and planner additions work", async ({
  page,
}) => {
  await page.goto("/#/pantry");
  await page
    .getByRole("button", { name: "Add ingredient", exact: true })
    .click();
  await page.getByLabel("Ingredient", { exact: true }).fill("chicken breast");
  await page.getByLabel("Quantity", { exact: true }).fill("350");
  await page.getByRole("button", { name: "Save item" }).click();
  await expect(page.locator(".pantry-item")).toContainText("350 g");
  await page.reload();
  await expect(page.locator(".pantry-item")).toContainText("chicken breast");
  await page.getByRole("button", { name: "Edit chicken breast" }).click();
  await page.getByLabel("Quantity", { exact: true }).fill("200");
  await page.getByRole("button", { name: "Save item" }).click();
  await expect(page.locator(".pantry-item")).toContainText("200 g");
  await page.goto("/#/shopping");
  await page.getByRole("button", { name: "Add an item" }).click();
  await page.getByLabel("Ingredient", { exact: true }).fill("Greek yoghurt");
  await page.getByLabel("Quantity", { exact: true }).fill("500");
  await page.getByRole("button", { name: "Save item" }).click();
  // Checkboxes stay enabled while saving (aria-busy marks the save), so wait
  // for the save to finish and the stored count to change before reloading.
  // Target the row by name: list order is not stable.
  const greek = page
    .locator(".shopping-row")
    .filter({ hasText: "Greek yoghurt" })
    .locator("input");
  const progress = page.locator(".shopping-progress strong");
  // Read the count only after the new row has rendered: the add's live update
  // also changes the total, so an earlier read would be stale.
  await expect(greek).toBeVisible();
  const before = (await progress.textContent()) ?? "";
  const ticked = Number(before.match(/^(\d+) of/)?.[1]);
  const total = before.match(/ of (\d+)/)?.[1];
  await greek.check();
  await expect(greek).not.toHaveAttribute("aria-busy", "true");
  await expect(progress).toHaveText(
    `${ticked + 1} of ${total} items ticked off`,
  );
  await page.reload();
  await expect(greek).toBeChecked();
  await page.getByRole("button", { name: "Edit Greek yoghurt" }).click();
  await page.getByLabel("Quantity", { exact: true }).fill("750");
  await page.getByRole("button", { name: "Save item" }).click();
  await expect(page.locator(".shopping-row")).toContainText("750 g");
  await page.goto("/#/planner");
  await page
    .getByRole("button", { name: /^Add meal to dinner, / })
    .first()
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Add meal", exact: true })
    .click();
  await expect(page.locator(".planned-meal")).toHaveCount(1);
});

test("custom recipe creation is validated, safe text renders and editing is saved", async ({
  page,
}) => {
  await page.goto("/#/custom");
  await page.getByRole("button", { name: "Create a recipe" }).click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByRole("textbox", { name: "Recipe name", exact: true })
    .fill("My chicken recipe");
  await dialog
    .getByRole("combobox", { name: "Category", exact: true })
    .selectOption("chicken-turkey");
  await dialog
    .getByLabel("A short description")
    .fill("A simple personal recipe.");
  await dialog.getByLabel("What is one serving?").fill("Half the batch");
  await dialog
    .getByLabel("Ingredients, one per line")
    .fill("300 | g | chicken breast | raw | 2 cm pieces | Meat & seafood");
  await dialog
    .getByLabel("Method, one complete step per line")
    .fill(
      "Preheat to 180°C.\nAir fry chicken in one layer for 15 minutes, turning halfway.\nCheck a clean thermometer reads at least 74°C in the thickest piece.",
    );
  await dialog.getByLabel("When to shake or turn").fill("Turn at 7 minutes");
  await dialog
    .getByLabel("Food safety notes")
    .fill("Use a clean thermometer. Keep raw chicken separate.");
  await dialog
    .getByRole("spinbutton", { name: "Protein (g)", exact: true })
    .fill("34");
  await dialog.getByLabel("calories (kcal)").fill("170");
  await dialog.getByLabel("carbs (g)").fill("0");
  await dialog.getByLabel("fat (g)").fill("4");
  await dialog
    .getByLabel("How did you estimate the nutrition?")
    .fill("Package label for 150g edible raw chicken per serving.");
  await dialog
    .getByLabel("Ingredients, one per line")
    .fill("1/2 | cup | chicken breast | raw");
  await dialog.getByRole("button", { name: "Save my recipe" }).click();
  await expect(dialog.getByRole("alert")).toContainText("Line 1");
  await expect(dialog.getByLabel("Ingredients, one per line")).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await expect(
    dialog.getByRole("textbox", { name: "Recipe name", exact: true }),
  ).toHaveValue(
    "My chicken recipe",
  );
  await dialog
    .getByLabel("Ingredients, one per line")
    .fill("300 | g | chicken breast | raw | 2 cm pieces | Meat & seafood");
  await dialog.getByRole("button", { name: "Save my recipe" }).click();
  await expect(page.locator(".toast[role=status]")).toContainText(
    "Your recipe is saved",
  );
  await page.getByRole("link", { name: "My chicken recipe" }).click();
  await page
    .getByLabel("Personal recipe notes")
    .fill('<img src=x onerror="window.injected=true">');
  await page.getByRole("button", { name: "Save notes" }).click();
  await expect(page.locator(".toast[role=status]")).toContainText(
    "Recipe notes saved",
  );
  await page.reload();
  await expect(page.getByLabel("Personal recipe notes")).toHaveValue(
    '<img src=x onerror="window.injected=true">',
  );
  expect(await page.evaluate(() => Object.hasOwn(window, "injected"))).toBe(
    false,
  );
});

for (const [name, width, height] of [
  ["desktop", 1440, 1050],
  ["tablet", 820, 1180],
  ["mobile", 390, 844],
  ["narrow", 320, 740],
] as const) {
  test(`responsive routes and accessible dashboard: ${name}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    for (const route of [
      "/#/",
      "/#/explore",
      recipePath,
      "/#/planner",
      "/#/shopping",
      "/#/journal",
      "/#/pantry",
      "/#/settings",
      "/#/help",
    ]) {
      await page.goto(route);
      await expect(page.locator("main h1")).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth + 1,
        ),
        `overflow on ${route}`,
      ).toBe(true);
      if (route === recipePath && (name === "desktop" || name === "mobile")) {
        await page.screenshot({
          path: `docs/screenshots/recipe-${name}-light.png`,
          fullPage: true,
        });
      }
    }
    await page.goto("/#/");
    await page.screenshot({
      path: `docs/screenshots/${name}-light.png`,
      fullPage: true,
    });
    const a11y = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(
      a11y.violations.map((v) => ({
        id: v.id,
        impact: v.impact,
        nodes: v.nodes.map((n) => n.target),
      })),
    ).toEqual([]);
    await page.emulateMedia({ colorScheme: "dark" });
    await page.screenshot({
      path: `docs/screenshots/${name}-dark.png`,
      fullPage: true,
    });
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    expect(errors).toEqual([]);
  });
}

test("keyboard navigation, empty search and dark preference persist", async ({
  page,
}) => {
  await page.goto("/#/");
  await expect(page.locator("main h1")).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "Skip to content" }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("main")).toBeFocused();
  await page.goto("/#/explore");
  await page
    .getByRole("textbox", { name: "Search catalogue" })
    .fill("no-such-food-abcdef");
  await expect(
    page.getByRole("heading", { name: "No recipes on this shelf" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Reset search & filters" }).click();
  await expect(page.locator(".recipe-card").first()).toBeVisible();
  await page.goto("/#/settings");
  await page.getByLabel("Appearance").selectOption("dark");
  await page
    .getByRole("button", { name: "Save preferences", exact: true })
    .click();
  await expect(page.locator(".toast[role=status]")).toContainText(
    "preferences are saved",
  );
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});
