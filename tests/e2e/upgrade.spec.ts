import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { backupSchema } from "../../src/lib/schema";

const recipeRoute = "/#/recipe/air-fryer-chicken-fajitas";
const cookRoute = "/#/cook/air-fryer-chicken-fajitas?servings=2";
const screenshots = resolve("docs/screenshots/upgrade-after/matrix");
const routes = [
  ["today", "/#/"],
  ["explore", "/#/explore"],
  ["recipe", recipeRoute],
  ["cook", cookRoute],
  ["planner", "/#/planner"],
  ["shopping", "/#/shopping"],
  ["journal", "/#/journal"],
  ["settings", "/#/settings"],
] as const;

async function ready(page: Page, path: string) {
  await page.goto(path);
  await expect(page.locator("main h1")).toBeVisible();
}

async function kitchenBackup(page: Page) {
  await ready(page, "/#/settings");
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export backup", exact: true })
    .click();
  const path = await (await download).path();
  expect(path).not.toBeNull();
  return backupSchema.parse(JSON.parse(await readFile(path!, "utf8")));
}

async function beginCook(page: Page) {
  await ready(page, cookRoute);
  const begin = page.getByRole("button", {
    name: "Begin cooking",
    exact: true,
  });
  if (await begin.isVisible()) await begin.click();
  await expect(
    page.getByRole("region", { name: "Current cooking step" }),
  ).toBeVisible();
}

test.beforeAll(async () => {
  await mkdir(screenshots, { recursive: true });
});

for (const width of [320, 375, 430, 768, 1024, 1440, 1920]) {
  for (const theme of ["light", "dark"] as const) {
    test(`upgrade gauntlet: ${width}px ${theme}, eight product routes`, async ({
      page,
    }) => {
      test.setTimeout(150000);
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      for (const [name, path] of routes) {
        await ready(page, path);
        if (name === "cook") await beginCook(page);
        await page.evaluate(() => document.fonts.ready);
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth),
          name,
        ).toBeLessThanOrEqual(width + 1);
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        const audit = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
          .analyze();
        expect(
          audit.violations.map((v) => ({
            id: v.id,
            nodes: v.nodes.map((node) => ({
              target: node.target,
              reason: node.failureSummary,
            })),
          })),
          `${name} at ${width}px ${theme}`,
        ).toEqual([]);
        if (name === "explore" && width <= 430) {
          const card = await page.locator(".recipe-card").first().boundingBox();
          expect(card?.width).toBeGreaterThan(width * 0.75);
          const favourite = await page
            .locator(".heart-button")
            .first()
            .boundingBox();
          expect(favourite?.width).toBeGreaterThanOrEqual(44);
          expect(favourite?.height).toBeGreaterThanOrEqual(44);
        }
        await page.screenshot({
          path: resolve(screenshots, `${width}-${theme}-${name}.png`),
        });
      }
      expect(errors).toEqual([]);
    });
  }
}

test("focused cooking preserves step, servings and a real deadline through reload and return", async ({
  page,
}) => {
  await beginCook(page);
  await page
    .getByRole("spinbutton", { name: "Servings", exact: true })
    .fill("4");
  await page
    .getByRole("button", { name: "Done, next step", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Step 2", exact: true }),
  ).toBeVisible();
  await page.getByRole("spinbutton", { name: "Timer duration", exact: true }).fill("2");
  await page.getByRole("button", { name: "Start timer", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Pause timer", exact: true }),
  ).toBeVisible();
  // Let the deadline advance independently of the component lifetime.
  await expect
    .poll(async () =>
      page.getByLabel("Time remaining", { exact: true }).textContent(),
    )
    .not.toBe("02:00");
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Step 2", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("spinbutton", { name: "Servings", exact: true }),
  ).toHaveValue("4");
  await expect(
    page.getByRole("button", { name: "Pause timer", exact: true }),
  ).toBeVisible();
  const remaining = await page
    .getByLabel("Time remaining", { exact: true })
    .textContent();
  expect(remaining).not.toBe("02:00");
  await page.getByRole("link", { name: "Back to recipe", exact: true }).click();
  await expect(page.locator(".method-list input").first()).toBeChecked();
  await beginCook(page);
  await page
    .getByRole("button", { name: "Finish & save", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByLabel("Cooking notes", { exact: true })
    .fill("Focused cook survived leaving and reopening.");
  await page
    .getByRole("button", { name: "Save cooking session", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const backup = await kitchenBackup(page);
  expect(backup.activeCooking).toHaveLength(0);
  expect(backup.sessions).toHaveLength(1);
  expect(backup.sessions[0].servingsPrepared).toBe(4);
  expect(backup.sessions[0].notes).toBe(
    "Focused cook survived leaving and reopening.",
  );
});

test("rapid favourite and tried interactions settle to the last completed intent", async ({
  page,
}) => {
  await ready(page, recipeRoute);
  // The toggles keep a constant name; the state lives in aria-pressed.
  for (let cycle = 0; cycle < 3; cycle++) {
    await page
      .getByRole("button", { name: "Save recipe", exact: true })
      .click();
    await page.getByRole("button", { name: "Save recipe", exact: true }).click();
  }
  await page.getByRole("button", { name: "Save recipe", exact: true }).click();
  await page
    .getByRole("button", { name: "Mark as tried", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Mark as tried", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Mark as tried", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Mark as tried", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Save recipe", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("button", { name: "Mark as tried", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
});

test("discovery filters survive a recipe round trip and browser reload", async ({
  page,
}) => {
  await ready(page, "/#/explore");
  const search = page.getByRole("textbox", { name: "Search catalogue" });
  await search.fill("tofu");
  await search.fill("salmon");
  await search.fill("chicken breast");
  await page.getByRole("button", { name: /^Filters/ }).click();
  await page.getByLabel("Maximum total time (min)").fill("24");
  await page.getByLabel("Minimum protein (g)").fill("25");
  await page.getByLabel("Sort recipes").selectOption("protein");
  await page
    .getByRole("link", { name: "Chicken fajita filling", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Chicken fajita filling", exact: true }),
  ).toBeVisible();
  await page.goBack();
  await expect(search).toHaveValue("chicken breast");
  await page.reload();
  await expect(search).toHaveValue("chicken breast");
  await expect(page.getByLabel("Sort recipes")).toHaveValue("protein");
  if (!(await page.getByLabel("Maximum total time (min)").isVisible()))
    await page.getByRole("button", { name: /^Filters/ }).click();
  await expect(page.getByLabel("Maximum total time (min)")).toHaveValue("24");
  await expect(page.getByLabel("Minimum protein (g)")).toHaveValue("25");
});

test("a planned meal can be replaced and moved without creating a duplicate", async ({
  page,
}) => {
  await ready(page, "/#/planner");
  await page
    .getByRole("button", { name: /^Add meal to dinner, / })
    .first()
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Add meal", exact: true })
    .click();
  await expect(page.locator(".planned-meal")).toHaveCount(1);
  const original = (await kitchenBackup(page)).plans[0];
  await ready(page, "/#/planner");
  await page.getByRole("button", { name: /^Edit .* on/ }).click();
  const modal = page.getByRole("dialog");
  await modal
    .getByLabel("Find a recipe", { exact: true })
    .fill("Chicken fajita filling");
  await modal
    .getByRole("listbox", { name: "Recipe", exact: true })
    .selectOption("air-fryer-chicken-fajitas");
  await modal
    .getByRole("combobox", { name: "Meal", exact: true })
    .selectOption("lunch");
  await modal.getByLabel("Servings", { exact: true }).fill("3");
  await modal
    .getByRole("button", { name: "Save meal changes", exact: true })
    .click();
  await expect(modal).toHaveCount(0);
  await page.reload();
  await expect(page.locator(".planned-meal")).toHaveCount(1);
  await expect(page.locator(".planned-meal")).toContainText(
    "Chicken fajita filling",
  );
  const updated = (await kitchenBackup(page)).plans;
  expect(updated).toHaveLength(1);
  expect(updated[0]).toMatchObject({
    id: original.id,
    date: original.date,
    slot: "lunch",
    servings: 3,
    recipeId: "air-fryer-chicken-fajitas",
  });
});

test("main Explore navigation clears the query after in-place filter URL updates", async ({
  page,
}) => {
  await ready(page, "/#/explore");
  await page.getByRole("textbox", { name: "Search catalogue" }).fill("salmon");
  await expect(page).toHaveURL(/q=salmon/);
  await page
    .getByRole("navigation", { name: "Main navigation", exact: true })
    .getByRole("link", { name: "Explore recipes", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Search catalogue" }),
  ).toHaveValue("");
  expect(
    new URLSearchParams(new URL(page.url()).hash.split("?")[1]).has("q"),
  ).toBe(false);
});

test("long notes and repeated appearance saves persist without overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const note =
    "A useful cooking detail: lemon, paprika and careful thermometer checks. ".repeat(
      100,
    );
  await ready(page, recipeRoute);
  await page.getByLabel("Personal recipe notes").fill(note);
  await page
    .getByRole("link", { name: "Back to the kitchen", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Search catalogue" }),
  ).toBeVisible();
  await page.goBack();
  await expect(page.getByLabel("Personal recipe notes")).toHaveValue(note);
  await page.getByRole("button", { name: "Save notes", exact: true }).click();
  await expect(page.locator(".toast[role=status]")).toContainText(
    "Recipe notes saved",
  );
  await ready(page, "/#/settings");
  for (const theme of ["dark", "light", "dark"]) {
    await page
      .getByRole("combobox", { name: "Appearance", exact: true })
      .selectOption(theme);
    await page
      .getByRole("button", { name: "Save preferences", exact: true })
      .click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
  }
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await ready(page, recipeRoute);
  await expect(page.getByLabel("Personal recipe notes")).toHaveValue(note);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(376);
});

test("two settings tabs preserve an unsaved name while merging a saved location", async ({
  page,
  context,
}) => {
  await ready(page, "/#/settings");
  await page.getByLabel("Your name", { exact: true }).fill("First tab cook");
  const second = await context.newPage();
  await ready(second, "/#/settings");
  await second
    .getByLabel("Location", { exact: true })
    .fill("Canberra, Australia");
  await second
    .getByRole("button", { name: "Save preferences", exact: true })
    .click();
  await expect(second.locator(".toast[role=status]")).toContainText(
    "preferences are saved",
  );
  await expect(page.getByLabel("Your name", { exact: true })).toHaveValue(
    "First tab cook",
  );
  await expect(
    page.getByText(
      "Preferences changed elsewhere. Your unsaved changes are kept. Saving updates only the fields you edited.",
      { exact: true },
    ),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Save preferences", exact: true })
    .click();
  await expect(page.locator(".toast[role=status]")).toContainText(
    "preferences are saved",
  );
  await page.reload();
  await expect(page.getByLabel("Your name", { exact: true })).toHaveValue(
    "First tab cook",
  );
  await expect(page.getByLabel("Location", { exact: true })).toHaveValue(
    "Canberra, Australia",
  );
  await page
    .getByLabel("Your name", { exact: true })
    .fill("Discard this draft");
  await page
    .getByRole("button", { name: "Discard unsaved changes", exact: true })
    .click();
  await expect(page.getByLabel("Your name", { exact: true })).toHaveValue(
    "First tab cook",
  );
});

test("mobile navigation contains keyboard focus and restores its trigger", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await ready(page, "/#/");
  const trigger = page.getByRole("button", {
    name: "Open navigation",
    exact: true,
  });
  await trigger.focus();
  await page.keyboard.press("Enter");
  const modal = page.getByRole("dialog", { name: "Your kitchen", exact: true });
  await expect(modal).toBeVisible();
  for (let index = 0; index < 14; index++) {
    await page.keyboard.press("Tab");
    expect(
      await modal.evaluate((element) =>
        element.contains(document.activeElement),
      ),
    ).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(modal).toHaveCount(0);
  await expect(trigger).toBeFocused();
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
});

test("journal recipe search narrows choices without deleting the current session draft", async ({
  page,
}) => {
  await ready(page, "/#/journal");
  await page.getByRole("button", { name: "Log a cook", exact: true }).click();
  const modal = page.getByRole("dialog");
  await modal
    .getByLabel("Cooking notes", { exact: true })
    .fill("Keep this until I choose another dish.");
  await modal
    .getByLabel("Find a recipe", { exact: true })
    .fill("Chicken fajita filling");
  await expect(modal.getByLabel("Cooking notes", { exact: true })).toHaveValue(
    "Keep this until I choose another dish.",
  );
  expect(
    await modal
      .getByRole("combobox", { name: "Recipe", exact: true })
      .locator("option")
      .count(),
  ).toBeLessThanOrEqual(2);
  await modal
    .getByRole("combobox", { name: "Recipe", exact: true })
    .selectOption("air-fryer-chicken-fajitas");
  await modal
    .getByLabel("Cooking notes", { exact: true })
    .fill("Found quickly by its name.");
  await modal
    .getByRole("button", { name: "Save cooking session", exact: true })
    .click();
  await expect(modal).toHaveCount(0);
  await expect(page.locator(".journal-entry")).toContainText(
    "Chicken fajita filling",
  );
  await expect(page.locator(".journal-entry")).toContainText(
    "Found quickly by its name.",
  );
});

test("missing food images expose a readable fallback and retain layout", async ({
  browser,
}) => {
  const context = await browser.newContext({
    serviceWorkers: "block",
    viewport: { width: 375, height: 812 },
  });
  try {
    await context.route("**/images/*.webp", (route) => route.abort());
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:4173${recipeRoute}`);
    await expect(
      page.getByRole("img", { name: /recipe illustration unavailable/ }),
    ).toBeVisible();
    const fallback = await page.locator(".food-image-fallback").boundingBox();
    expect(fallback?.height).toBeGreaterThan(100);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(376);
  } finally {
    await context.close();
  }
});

test("confirmed personal-data deletion clears unsaved note drafts in every open tab", async ({
  page,
  context,
}) => {
  await ready(page, recipeRoute);
  await page
    .getByLabel("Personal recipe notes")
    .fill("Private unsaved draft in the first tab");
  const second = await context.newPage();
  await ready(second, recipeRoute);
  await second
    .getByLabel("Personal recipe notes")
    .fill("Private unsaved draft in the second tab");
  for (const tab of [page, second]) {
    expect(
      await tab.evaluate(
        () =>
          Object.keys(sessionStorage).filter((key) =>
            key.startsWith("airfuel-note-draft:"),
          ).length,
      ),
    ).toBe(1);
  }
  await second.getByRole("link", { name: "Settings", exact: true }).click();
  await second
    .getByRole("button", { name: "Delete personal data", exact: true })
    .click();
  await second.getByLabel("Type DELETE to confirm").fill("DELETE");
  await second
    .getByRole("button", { name: "Delete everything personal", exact: true })
    .click();
  await expect(second.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByLabel("Personal recipe notes")).toHaveValue("");
  for (const tab of [page, second]) {
    await expect
      .poll(() =>
        tab.evaluate(() =>
          Object.keys(sessionStorage).filter((key) =>
            key.startsWith("airfuel-note-draft:"),
          ),
        ),
      )
      .toEqual([]);
    await ready(tab, recipeRoute);
    await tab.reload();
    await expect(tab.getByLabel("Personal recipe notes")).toHaveValue("");
  }
});

test("records production-browser load and layout observations without inventing a performance score", async ({
  browser,
}, testInfo) => {
  const context = await browser.newContext({
    serviceWorkers: "block",
    viewport: { width: 1440, height: 1000 },
    reducedMotion: "reduce",
  });
  try {
    const page = await context.newPage();
    await page.addInitScript(() => {
      const record = { lcpMs: 0, cls: 0, longTasksMs: [] as number[] };
      (
        window as Window & { airfuelPerformance?: typeof record }
      ).airfuelPerformance = record;
      new PerformanceObserver((entries) => {
        for (const entry of entries.getEntries())
          record.lcpMs = entry.startTime;
      }).observe({ type: "largest-contentful-paint", buffered: true });
      new PerformanceObserver((entries) => {
        for (const entry of entries.getEntries() as (PerformanceEntry & {
          value: number;
          hadRecentInput: boolean;
        })[])
          if (!entry.hadRecentInput) record.cls += entry.value;
      }).observe({ type: "layout-shift", buffered: true });
      new PerformanceObserver((entries) => {
        for (const entry of entries.getEntries())
          record.longTasksMs.push(entry.duration);
      }).observe({ type: "longtask", buffered: true });
    });
    await page.goto("http://127.0.0.1:4173/#/");
    await expect(page.locator("main h1")).toBeVisible();
    await page
      .locator(".hero-image img")
      .evaluate((img) => (img as HTMLImageElement).decode());
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(1200);
    const measurements = await page.evaluate(() => {
      const navigation = performance.getEntriesByType(
        "navigation",
      )[0] as PerformanceNavigationTiming;
      const resources = performance.getEntriesByType(
        "resource",
      ) as PerformanceResourceTiming[];
      return {
        ...(
          window as Window & {
            airfuelPerformance?: {
              lcpMs: number;
              cls: number;
              longTasksMs: number[];
            };
          }
        ).airfuelPerformance,
        domContentLoadedMs: navigation.domContentLoadedEventEnd,
        firstContentfulPaintMs:
          performance.getEntriesByName("first-contentful-paint")[0]
            ?.startTime ?? null,
        transferredBytes: resources.reduce(
          (sum, resource) => sum + resource.transferSize,
          0,
        ),
        decodedResourceBytes: resources.reduce(
          (sum, resource) => sum + resource.decodedBodySize,
          0,
        ),
        resourceCount: resources.length,
      };
    });
    expect(measurements.domContentLoadedMs).toBeGreaterThan(0);
    const report = {
      measuredAt: new Date().toISOString(),
      environment:
        "Local production preview, headless Chromium, 1440×1000, fresh context, service worker blocked, no network or CPU throttling. A laboratory observation, not field Core Web Vitals or a Lighthouse score.",
      measurements,
    };
    await mkdir(resolve(screenshots, ".."), { recursive: true });
    await writeFile(
      resolve(screenshots, "..", "performance.json"),
      `${JSON.stringify(report, null, 2)}\n`,
    );
    await testInfo.attach("production-browser-performance", {
      body: JSON.stringify(report, null, 2),
      contentType: "application/json",
    });
  } finally {
    await context.close();
  }
});
