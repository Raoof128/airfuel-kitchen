import { readFile, readdir, writeFile, access } from "node:fs/promises";
import { resolve } from "node:path";
import { recipeSchema, type Recipe } from "../src/lib/schema";
const root = process.cwd();
const errors: string[] = [];
const warnings: string[] = [];
const recipes: Recipe[] = [];
for (const file of (await readdir(resolve(root, "src/data"))).filter((f) =>
  /^recipes-.*\.json$/.test(f),
)) {
  const data: unknown = JSON.parse(
    await readFile(resolve(root, "src/data", file), "utf8"),
  );
  const parsed = recipeSchema.array().safeParse(data);
  if (!parsed.success) {
    errors.push(
      ...parsed.error.issues.map(
        (i) => `${file} ${i.path.join(".")}: ${i.message}`,
      ),
    );
    continue;
  }
  recipes.push(...parsed.data);
}
const ids = new Set<string>();
const titles = new Set<string>();
const signatures = new Map<string, string>();
for (const r of recipes) {
  if (ids.has(r.id)) errors.push(`Duplicate ID ${r.id}`);
  ids.add(r.id);
  const title = r.title.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (titles.has(title)) errors.push(`Duplicate title ${r.title}`);
  titles.add(title);
  if (r.sources.some((s) => s.verifiedAt > "2026-10-11"))
    errors.push(`${r.id}: future verification date`);
  if (r.totalMinutes < r.prepMinutes + r.cookMinutes + r.preheatMinutes)
    errors.push(`${r.id}: total excludes preheat`);
  if (
    r.ingredients.some((i) => i.quantity <= 0 || !Number.isFinite(i.quantity))
  )
    errors.push(`${r.id}: invalid quantity`);
  if (r.nutrition.protein > r.nutrition.calories / 4 + 2)
    errors.push(`${r.id}: protein energy exceeds calories`);
  if (
    r.category === "chicken-turkey" &&
    (!r.internalTempC || r.internalTempC < 74)
  )
    errors.push(`${r.id}: poultry safety temperature missing`);
  if (r.category === "seafood" && (!r.internalTempC || r.internalTempC < 63))
    warnings.push(`${r.id}: review seafood temperature`);
  if (!r.safety.length) errors.push(`${r.id}: no safety notes`);
  try {
    await access(resolve(root, "public" + r.image.src));
  } catch {
    errors.push(`${r.id}: image not found ${r.image.src}`);
  }
  const signature = r.ingredients
    .map(
      (i) =>
        `${i.name.toLowerCase()}|${i.form}|${i.quantity / r.servings}|${i.unit}`,
    )
    .sort()
    .join(";");
  if (signatures.has(signature))
    warnings.push(
      `Identical ingredient proportions: ${signatures.get(signature)} / ${r.id}`,
    );
  else signatures.set(signature, r.id);
}
const categories = Object.fromEntries(
  [...new Set(recipes.map((r) => r.category))].map((c) => [
    c,
    recipes.filter((r) => r.category === c).length,
  ]),
);
if (recipes.length < 300)
  errors.push(
    `Catalogue has ${recipes.length} recipes; the requested minimum is 300.`,
  );
const report = {
  checkedAt: "2026-10-11",
  publishedCount: recipes.length,
  uniqueSourceUrls: new Set(recipes.flatMap((r) => r.sources.map((s) => s.url)))
    .size,
  minimum160Met: recipes.length >= 160,
  requestedTarget: 300,
  target300Met: recipes.length >= 300,
  categories,
  highProteinMains25g: recipes.filter(
    (r) =>
      !["breakfast", "snacks-sides", "desserts"].includes(r.category) &&
      r.nutrition.protein >= 25,
  ).length,
  protein30g: recipes.filter((r) => r.nutrition.protein >= 30).length,
  protein40g: recipes.filter((r) => r.nutrition.protein >= 40).length,
  protein50g: recipes.filter((r) => r.nutrition.protein >= 50).length,
  nutritionMethods: Object.fromEntries(
    ["estimated", "source-estimate"].map((c) => [
      c,
      recipes.filter((r) => r.nutrition.confidence === c).length,
    ]),
  ),
  errors,
  warnings,
  note: "Structural and arithmetic validation only. Individual source verification and editorial review are recorded in research/. Not a kitchen or laboratory test.",
};
await writeFile(
  resolve(root, "research/validation-report.json"),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(JSON.stringify(report, null, 2));
if (errors.length) process.exitCode = 1;
