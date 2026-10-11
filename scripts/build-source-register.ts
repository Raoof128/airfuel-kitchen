import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { recipeSchema, type Recipe } from "../src/lib/schema";

async function main() {
  const root = process.cwd();
  const files = (await readdir(resolve(root, "src/data")))
    .filter((name) => /^recipes-.*\.json$/.test(name))
    .sort();
  const recipes: Recipe[] = [];
  const snapshots = [];
  for (const file of files) {
    const bytes = await readFile(resolve(root, "src/data", file));
    const records = recipeSchema.array().parse(JSON.parse(bytes.toString()));
    recipes.push(...records);
    snapshots.push({
      file: `src/data/${file}`,
      count: records.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
  }

  // This is an index of recorded human/agent research, not a URL-verification
  // crawler. Regeneration must never invent a fresh source-check date.
  const register = {
    generatedAt: new Date().toISOString(),
    count: recipes.length,
    uniquePrimarySources: new Set(recipes.map((r) => r.sources[0].url)).size,
    scope:
      "Derived index of bundled records. Verification dates are preserved from editorial research. See stream reports for evidence and limitations; no new network verification is performed by this script.",
    snapshots,
    recipes: [...recipes]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((recipe) => ({
        id: recipe.id,
        title: recipe.title,
        category: recipe.category,
        sources: recipe.sources,
        nutrition: {
          confidence: recipe.nutrition.confidence,
          reference: recipe.nutrition.reference,
          method: recipe.nutrition.method,
        },
      })),
  };
  const path = resolve(root, "research/source-register.json");
  await writeFile(path, JSON.stringify(register, null, 2) + "\n");
  console.log(
    `Source register: ${register.count} recipes, ${register.uniquePrimarySources} primary URLs. Saved ${path}`,
  );
}

main().catch((error: unknown) => {
  console.error(
    "Could not build the source register:",
    error instanceof Error ? error.message : String(error),
  );
  process.exitCode = 1;
});
