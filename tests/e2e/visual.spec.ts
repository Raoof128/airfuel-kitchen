import { test, expect, type Page } from "@playwright/test";

// Visual regression for the primary routes. Sources of nondeterminism are pinned:
// the clock (greeting, "tonight" picks, planner week), theme, viewport, motion and
// a fresh profile per test. Fonts and illustrations are bundled locally.
// Baselines live next to this file; review every diff before running
// `npx playwright test visual --update-snapshots`.
const fixedNow = new Date("2026-10-07T18:30:00+11:00");

const routes = [
  ["dashboard", "/"],
  ["explore", "/explore"],
  ["recipe", "/recipe/air-fryer-chicken-thighs"],
  ["cook", "/cook/air-fryer-chicken-thighs"],
  ["planner", "/planner"],
  ["journal", "/journal"],
  ["shopping", "/shopping"],
  ["settings", "/settings"],
] as const;

const viewports = [
  ["mobile", { width: 375, height: 812 }],
  ["desktop", { width: 1440, height: 900 }],
] as const;

async function open(page: Page, path: string) {
  await page.clock.setFixedTime(fixedNow);
  await page.goto(`/#${path}`);
  await expect(page.locator("main h1").first()).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  // Let liveQuery settle and lazy images decode before capturing.
  await page.waitForLoadState("networkidle");
}

for (const theme of ["light", "dark"] as const) {
  for (const [vpName, viewport] of viewports) {
    test.describe(`${vpName} ${theme}`, () => {
      test.use({ viewport, colorScheme: theme, reducedMotion: "reduce" });
      for (const [name, path] of routes) {
        test(`${name}`, async ({ page }) => {
          await open(page, path);
          await expect(page).toHaveScreenshot(`${name}-${vpName}-${theme}.png`, {
            fullPage: true,
            animations: "disabled",
            caret: "hide",
            maxDiffPixelRatio: 0.01,
          });
        });
      }
    });
  }
}

test.describe("mobile navigation", () => {
  test.use({ viewport: { width: 375, height: 812 }, reducedMotion: "reduce" });
  test("open menu", async ({ page }) => {
    await open(page, "/");
    await page.getByRole("button", { name: "Open navigation" }).click();
    await expect(page).toHaveScreenshot("menu-open-mobile-light.png", {
      animations: "disabled",
      maxDiffPixelRatio: 0.01,
    });
  });
});
