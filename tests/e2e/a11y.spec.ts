import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// Primary routes only. The not-found page has no <h1> in <main>, so it is covered by the
// manual sweep in docs/frontend/ACCESSIBILITY_AUDIT.md rather than by this spec.
const primaryRoutes = [
  ["Today", "/"],
  ["Explore", "/explore"],
  ["Favourites", "/favourites"],
  ["Recipe", "/recipe/air-fryer-chicken-thighs"],
  ["Cook Mode", "/cook/air-fryer-chicken-thighs"],
  ["Meal planner", "/planner"],
  ["Shopping list", "/shopping"],
  ["Pantry", "/pantry"],
  ["Cooking journal", "/journal"],
  ["Settings", "/settings"],
  ["Kitchen guide", "/help"],
  ["Custom recipes", "/custom"],
] as const;

const wcagTags = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];
const blockingImpacts = new Set(["serious", "critical"]);

async function blockingViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(wcagTags).analyze();
  return results.violations.filter((violation) =>
    blockingImpacts.has(violation.impact ?? ""),
  );
}

function summarise(
  violations: Awaited<ReturnType<typeof blockingViolations>>,
): string {
  return violations
    .map(
      (violation) =>
        `${violation.id} (${violation.impact}): ${violation.nodes
          .slice(0, 5)
          .map((node) => node.target.join(" "))
          .join(", ")}`,
    )
    .join("\n");
}

for (const colorScheme of ["light", "dark"] as const) {
  test.describe(`${colorScheme} theme`, () => {
    test.use({ colorScheme });

    for (const [name, path] of primaryRoutes) {
      test(`${name} (${path}) has no serious or critical WCAG 2.2 AA violations`, async ({
        page,
      }) => {
        await page.goto(`/#${path}`);
        // Wait for the kitchen to finish loading. The loader's h1 sits outside <main>.
        await expect(page.locator("main h1").first()).toBeVisible();
        const violations = await blockingViolations(page);
        expect(violations, summarise(violations)).toEqual([]);
      });
    }
  });
}
