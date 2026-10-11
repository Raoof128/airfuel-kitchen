import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFile } from "node:fs/promises";

const route = "/#/recipe/air-fryer-chicken-fajitas";
for (const colour of ["light", "dark"] as const) {
  test(`accessible recipe, forms, planner and settings in ${colour} mode`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: colour, reducedMotion: "reduce" });
    for (const path of [
      route,
      "/#/explore",
      "/#/planner",
      "/#/shopping",
      "/#/pantry",
      "/#/journal",
      "/#/settings",
      "/#/help",
      "/#/custom",
    ]) {
      await page.goto(path);
      await expect(page.locator("main h1")).toBeVisible();
      const audit = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
        .analyze();
      expect(
        audit.violations.map((v) => ({
          id: v.id,
          nodes: v.nodes.map((n) => ({
            target: n.target,
            reason: n.failureSummary,
          })),
        })),
        path,
      ).toEqual([]);
    }
    await page.goto(route);
    await page
      .getByRole("button", { name: "Finished? Save a cooking memory" })
      .click();
    await expect(page.getByRole("dialog")).toBeVisible();
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Finished? Save a cooking memory" }),
    ).toBeFocused();
  });
}

test("scaled servings reach the shopping list and a confirmed reset can be restored from backup", async ({
  page,
}) => {
  await page.goto(route);
  const original = await page
    .locator(".ingredient-list li")
    .first()
    .innerText();
  await page
    .getByRole("spinbutton", { name: "Servings", exact: true })
    .fill("4");
  expect(
    await page.locator(".ingredient-list li").first().innerText(),
  ).not.toEqual(original);
  await page
    .getByRole("button", { name: "Add ingredients", exact: true })
    .click();
  await expect(page.locator(".toast[role=status]")).toContainText(
    "Ingredients added",
  );
  await page.getByLabel("Personal recipe notes").fill("A memory to restore");
  await page.getByRole("button", { name: "Save notes", exact: true }).click();
  await expect(page.locator(".toast[role=status]")).toContainText(
    "Recipe notes saved",
  );
  await page.goto("/#/settings");
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export backup", exact: true })
    .click();
  const path = await (await download).path();
  const saved = JSON.parse(await readFile(path!, "utf8"));
  expect(saved.shopping.length).toBeGreaterThan(0);
  await page
    .getByRole("button", { name: "Delete personal data", exact: true })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Delete everything personal",
      exact: true,
    }),
  ).toBeDisabled();
  await page.getByLabel("Type DELETE to confirm").fill("DELETE");
  await page
    .getByRole("button", { name: "Delete everything personal", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".toast[role=status]")).toContainText(
    "Personal data deleted",
  );
  await page.goto(route);
  await expect(page.getByLabel("Personal recipe notes")).toHaveValue("");
  await page.goto("/#/settings");
  await page.getByLabel("Import backup file").setInputFiles(path!);
  await page
    .getByRole("button", { name: "Restore backup", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.goto(route);
  await expect(page.getByLabel("Personal recipe notes")).toHaveValue(
    "A memory to restore",
  );
  await page.goto("/#/shopping");
  await expect(page.locator(".shopping-row")).toHaveCount(
    saved.shopping.length,
  );
});
