import { readFile, readdir, writeFile, access } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { recipeSchema, type Recipe } from "../src/lib/schema";
import {
  AIR_FRYER_MAX_C,
  AIR_FRYER_MIN_C,
  KCAL_PER_SERVING_MAX,
  TOTAL_MINUTES_MAX,
  TOTAL_MINUTES_WARN,
  atwater,
  belowNswMinceTemp,
  coreTempViolation,
  dietaryConflicts,
  missingAllergens,
  nearDuplicates,
  plantEvidenceUrls,
  volumeOnSolids,
} from "./data-rules";
const root = process.cwd();
const errors: string[] = [];
const warnings: string[] = [];
const recipes: Recipe[] = [];
const rawById = new Map<string, Record<string, unknown>>();
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
  for (const raw of data as Record<string, unknown>[])
    if (typeof raw.id === "string") rawById.set(raw.id, raw);
  recipes.push(...parsed.data);
}
const ids = new Set<string>();
const titles = new Set<string>();
const signatures = new Map<string, string>();
const flagged = new Map<string, Set<string>>();
const flag = (id: string, kind: string) => {
  if (!flagged.has(id)) flagged.set(id, new Set());
  flagged.get(id)!.add(kind);
};
const ownerDecisionNsw: string[] = [];
const atwaterOutside: string[] = [];
const volumeSolids: string[] = [];
const registerIds = new Map<string, { title: string; category: string; urls: string[] }>();
try {
  const register = JSON.parse(
    await readFile(resolve(root, "research/source-register.json"), "utf8"),
  ) as { recipes: { id: string; title: string; category: string; sources: { url: string }[] }[] };
  for (const entry of register.recipes)
    registerIds.set(entry.id, {
      title: entry.title,
      category: entry.category,
      urls: entry.sources.map((s) => s.url),
    });
} catch {
  errors.push("research/source-register.json is missing or unreadable");
}
const hasPlantEvidence = plantEvidenceUrls(root, (p) =>
  existsSync(p) ? readFileSync(p, "utf8") : null,
);
// Savoury provenance records httpStatus per source. null means a web read with no
// transport-level evidence, which is kept as an evidence gap rather than treated as 200.
const registerSavoury = new Set<string>(
  existsSync(resolve(root, "research/savoury/provenance.json"))
    ? (JSON.parse(readFileSync(resolve(root, "research/savoury/provenance.json"), "utf8")) as { id: string }[]).map((p) => p.id)
    : [],
);
const provenanceNullStatus = new Set<string>(
  await readFile(resolve(root, "research/savoury/provenance.json"), "utf8")
    .then((t) => (JSON.parse(t) as { id: string; httpStatus: number | null }[]).filter((p) => p.httpStatus === null).map((p) => p.id))
    .catch(() => []),
);

for (const r of recipes) {
  if (ids.has(r.id)) errors.push(`Duplicate ID ${r.id}`);
  ids.add(r.id);
  const title = r.title.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (titles.has(title)) errors.push(`Duplicate title ${r.title}`);
  titles.add(title);
  const raw = rawById.get(r.id);
  if (raw && typeof raw.title === "string" && raw.title !== raw.title.trim())
    errors.push(`${r.id}: title has surrounding whitespace`);
  if (r.sources.some((s) => s.verifiedAt > "2026-10-11"))
    errors.push(`${r.id}: future verification date`);
  if (r.totalMinutes < r.prepMinutes + r.cookMinutes + r.preheatMinutes)
    errors.push(`${r.id}: total excludes preheat`);
  if (r.totalMinutes > TOTAL_MINUTES_MAX)
    errors.push(`${r.id}: total time ${r.totalMinutes} min exceeds 24 h`);
  else if (r.totalMinutes > TOTAL_MINUTES_WARN)
    warnings.push(`${r.id}: total time ${r.totalMinutes} min; confirm any overnight soak is intended`);
  if (r.temperatureC < AIR_FRYER_MIN_C || r.temperatureC > AIR_FRYER_MAX_C)
    errors.push(`${r.id}: air-fryer temperature ${r.temperatureC} C outside ${AIR_FRYER_MIN_C}-${AIR_FRYER_MAX_C} C`);
  if (r.steps.length < 3)
    warnings.push(`${r.id}: only ${r.steps.length} steps; check instructions are complete`);
  if (r.ingredients.some((i) => i.quantity <= 0 || !Number.isFinite(i.quantity)))
    errors.push(`${r.id}: invalid quantity`);
  for (const i of volumeOnSolids(r)) volumeSolids.push(`${r.id}: ${i.quantity} ml ${i.name}`);
  if (r.nutrition.protein > r.nutrition.calories / 4 + 2)
    errors.push(`${r.id}: protein energy exceeds calories`);
  if (r.nutrition.calories / r.servings > KCAL_PER_SERVING_MAX)
    errors.push(`${r.id}: ${r.nutrition.calories} kcal per serving is implausible`);
  const energy = atwater(r);
  if (Math.abs(energy.deviation) > energy.tolerance)
    atwaterOutside.push(`${r.id}: ${r.nutrition.calories} kcal vs ${Math.round(energy.expected)} from macros`);
  const coreViolation = coreTempViolation(r);
  if (coreViolation) {
    errors.push(`${r.id}: ${coreViolation}`);
    flag(r.id, "food-safety");
  }
  if (belowNswMinceTemp(r)) {
    ownerDecisionNsw.push(`${r.id}: ${r.internalTempC} C (${r.title})`);
    flag(r.id, "owner-decision-nsw-75");
  }
  if (!r.safety.length) errors.push(`${r.id}: no safety notes`);
  if (r.image.src !== `/images/${r.category}.webp`)
    errors.push(`${r.id}: image ${r.image.src} does not match category ${r.category}`);
  try {
    await access(resolve(root, "public" + r.image.src));
  } catch {
    errors.push(`${r.id}: image not found ${r.image.src}`);
  }
  const reg = registerIds.get(r.id);
  if (!reg) {
    errors.push(`${r.id}: missing from research/source-register.json`);
  } else {
    if (JSON.stringify(r.sources.map((s) => s.url)) !== JSON.stringify(reg.urls))
      errors.push(`${r.id}: sources differ from research/source-register.json`);
    if (reg.title !== r.title || reg.category !== r.category)
      errors.push(`${r.id}: title or category differs from research/source-register.json`);
  }
  if (provenanceNullStatus.has(r.id)) flag(r.id, "web-read-only-no-http-status");
  if (r.id.length && !provenanceNullStatus.has(r.id) && !registerSavoury.has(r.id) && !r.sources.some((s) => hasPlantEvidence(s.url))) {
    errors.push(`${r.id}: no verification evidence record for ${r.sources[0].url}`);
    flag(r.id, "no-evidence-record");
  }
  if (!r.sources.some((s) => s.url === r.nutrition.reference))
    errors.push(`${r.id}: nutrition.reference is not one of the recipe sources`);
  if (r.nutrition.method.includes("FSANZ") && !r.sources.some((s) => /foodstandards\.gov\.au/.test(s.url)))
    errors.push(`${r.id}: AFCD calculation without an FSANZ source`);
  for (const allergen of missingAllergens(r)) {
    errors.push(`${r.id}: ${allergen} keyword in ingredients but not declared in allergens`);
    flag(r.id, "allergen-check");
  }
  for (const conflict of dietaryConflicts(r)) {
    errors.push(`${r.id}: ${conflict}`);
    flag(r.id, "dietary-check");
  }
  const signature = r.ingredients
    .map((i) => `${i.name.toLowerCase()}|${i.form}|${i.quantity / r.servings}|${i.unit}`)
    .sort()
    .join(";");
  if (signatures.has(signature))
    warnings.push(`Identical ingredient proportions: ${signatures.get(signature)} / ${r.id}`);
  else signatures.set(signature, r.id);
}
const duplicates = nearDuplicates(recipes);
for (const d of duplicates) {
  flag(d.a, "duplicate-candidate");
  flag(d.b, "duplicate-candidate");
}
for (const line of ownerDecisionNsw) warnings.push(`NSW 75 C owner decision: ${line}`);
for (const line of atwaterOutside) warnings.push(`Calorie cross-check outside tolerance: ${line}`);
for (const line of volumeSolids) warnings.push(`Volume unit on a solid ingredient: ${line}`);
if (recipes.length < 300)
  errors.push(`Catalogue has ${recipes.length} recipes; the requested minimum is 300.`);
const categories = Object.fromEntries(
  [...new Set(recipes.map((r) => r.category))].map((c) => [
    c,
    recipes.filter((r) => r.category === c).length,
  ]),
);
const recipeErrorIds = new Set(
  errors
    .map((e) => e.match(/^(\S+?): /)?.[1])
    .filter((id): id is string => id !== undefined && ids.has(id)),
);
const manualReview = [...flagged.entries()].filter(([, kinds]) => kinds.size > 0);
const report = {
  checkedAt: "2026-10-11",
  publishedCount: recipes.length,
  uniqueSourceUrls: new Set(recipes.flatMap((r) => r.sources.map((s) => s.url))).size,
  minimum160Met: recipes.length >= 160,
  requestedTarget: 300,
  target300Met: recipes.length >= 300,
  categories,
  highProteinMains25g: recipes.filter(
    (r) => !["breakfast", "snacks-sides", "desserts"].includes(r.category) && r.nutrition.protein >= 25,
  ).length,
  protein30g: recipes.filter((r) => r.nutrition.protein >= 30).length,
  protein40g: recipes.filter((r) => r.nutrition.protein >= 40).length,
  protein50g: recipes.filter((r) => r.nutrition.protein >= 50).length,
  nutritionMethods: Object.fromEntries(
    ["estimated", "source-estimate"].map((c) => [c, recipes.filter((r) => r.nutrition.confidence === c).length]),
  ),
  audit: {
    fullyValidated: recipes.filter((r) => !recipeErrorIds.has(r.id) && !flagged.has(r.id)).length,
    recipesWithErrors: recipeErrorIds.size,
    recipesNeedingManualReview: manualReview.length,
    incompleteSourceEvidence: provenanceNullStatus.size + recipes.filter((r) => flagged.get(r.id)?.has("no-evidence-record")).length,
    nutritionUncertainty: {
      publisherEstimates: recipes.filter((r) => r.nutrition.confidence === "source-estimate").length,
      calorieCrossCheckOutsideTolerance: atwaterOutside.length,
      fibreUnknown: recipes.filter((r) => r.nutrition.fibre === null).length,
    },
    duplicateCandidatePairs: duplicates,
    ownerDecisionNswMince: ownerDecisionNsw.length,
    volumeUnitOnSolids: volumeSolids.length,
    flags: Object.fromEntries(manualReview.map(([id, kinds]) => [id, [...kinds].sort()])),
  },
  errors,
  warnings,
  note: "Structural, arithmetic and food-safety invariants. Source verification and editorial review are recorded in research/. Not a kitchen or laboratory test.",
};
await writeFile(resolve(root, "research/validation-report.json"), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
if (errors.length) process.exitCode = 1;
