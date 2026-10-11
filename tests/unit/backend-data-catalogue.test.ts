import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { recipeSchema, type Recipe } from "../../src/lib/schema";
import {
  atwater,
  belowNswMinceTemp,
  coreTempViolation,
  cookedOnlyMeat,
  dietaryConflicts,
  missingAllergens,
  nearDuplicates,
  plantEvidenceUrls,
  volumeOnSolids,
} from "../../scripts/data-rules";

const root = resolve(__dirname, "../..");
const read = (path: string) => JSON.parse(readFileSync(resolve(root, path), "utf8"));
const savoury = read("src/data/recipes-savoury.json") as Recipe[];
const plant = read("src/data/recipes-plant.json") as Recipe[];
const recipes = [...savoury, ...plant];
const register = read("research/source-register.json") as {
  count: number;
  recipes: { id: string; title: string; category: string; sources: { url: string }[]; nutrition: { method: string } }[];
};
const savouryProvenance = read("research/savoury/provenance.json") as {
  id: string;
  url: string;
  httpStatus: number | null;
}[];
const afcdSavoury = new Map<string, { id: string } & Record<string, number | null>>(
  (read("research/savoury/afcd-reference.json") as ({ id: string } & Record<string, number | null>)[]).map((r) => [r.id, r]),
);
const afcdPlant = new Map<string, { id: string } & Record<string, number | null>>(
  (read("research/plant/afcd-reference.json") as ({ id: string } & Record<string, number | null>)[]).map((r) => [r.id, r]),
);

// Known data defects, kept explicit. Each test below fails if a new violation appears,
// and also fails if a listed defect is fixed, so the entry must then be deleted.
// Defect IDs match RECIPE_DATA_REPORT.md. Nothing here may be silently dropped.
const KNOWN_CORE_TEMP_DEFECTS: string[] = [];
const KNOWN_PLANT_EVIDENCE_GAPS: string[] = [];
// Savoury records whose provenance has no transport-level HTTP status (web reads).
// Documented evidence limitation, not a failure; the count must not grow silently.
const WEB_READ_ONLY_COUNT = 13;
// Calculated records whose product label profile is not in the local AFCD file.
const LABEL_PROFILE_IDS = ["salmon-gnocchi-spinach-pesto", "pesto-mozzarella-gnocchi", "air-fryer-black-bean-burgers"];
const NSW_MINCE_CANDIDATES = 26;
const PROTEIN_25G_MAINS = 128;
const ATWATER_OUTLIERS_DOCUMENTED = 36;
const VOLUME_SOLID_LINES_DOCUMENTED = 31;
const DOCUMENTED_NEAR_DUPLICATES = [
  "air-fryer-omelette|air-fryer-scrambled-eggs-on-toast",
  "air-fryer-steak-fajitas|air-fryer-chicken-fajitas",
];

describe("catalogue shape", () => {
  it("holds 300 recipes with unique stable ids, slugs and titles", () => {
    expect(recipes).toHaveLength(300);
    expect(new Set(recipes.map((r) => r.id)).size).toBe(300);
    for (const r of recipes) expect(r.slug).toBe(r.id);
    const titles = recipes.map((r) => r.title.toLowerCase().replace(/[^a-z0-9]/g, ""));
    expect(new Set(titles).size).toBe(300);
  });

  it("parses every record against the recipe schema", () => {
    for (const r of recipes) expect(recipeSchema.safeParse(r).success, r.id).toBe(true);
  });

  it("uses only the eight category illustrations, present on disk, with licence metadata", () => {
    const categories = ["chicken-turkey", "meat", "seafood", "vegetarian", "breakfast", "quick-dinners", "snacks-sides", "desserts"];
    for (const c of categories) expect(existsSync(resolve(root, `public/images/${c}.webp`)), c).toBe(true);
    for (const r of recipes) {
      expect(r.image.src, r.id).toBe(`/images/${r.category}.webp`);
      expect(r.image.credit, r.id).toBe("AirFuel Kitchen");
      expect(r.image.licence, r.id).toMatch(/^AI-generated illustration; not a photograph/);
    }
  });
});

describe("times and appliance temperatures", () => {
  it("total time includes preheat, and stays within 24 hours", () => {
    for (const r of recipes) {
      expect(r.totalMinutes, r.id).toBeGreaterThanOrEqual(r.prepMinutes + r.cookMinutes + r.preheatMinutes);
      expect(r.totalMinutes, r.id).toBeLessThanOrEqual(1440);
    }
  });

  it("keeps every air-fryer temperature inside the 60-240 C appliance range", () => {
    for (const r of recipes) {
      expect(r.temperatureC, r.id).toBeGreaterThanOrEqual(60);
      expect(r.temperatureC, r.id).toBeLessThanOrEqual(240);
    }
  });
});

describe("food safety", () => {
  it("has no core-temperature violation beyond the known defect ledger", () => {
    const violating = recipes.filter((r) => coreTempViolation(r)).map((r) => r.id);
    expect(violating).toEqual(KNOWN_CORE_TEMP_DEFECTS);
  });

  it("exempts a recipe whose only poultry is already cooked, chilled, with a handling line", () => {
    const salad = recipes.find((r) => r.id === "roast-cauliflower-chickpea-chicken-salad")!;
    expect(salad.internalTempC).toBeNull();
    expect(cookedOnlyMeat(salad)).toBe(true);
    expect(coreTempViolation(salad)).toBeNull();
  });

  it("still fails raw chicken with no core temperature, even with a handling line", () => {
    const salad = recipes.find((r) => r.id === "roast-cauliflower-chickpea-chicken-salad")!;
    const raw: Recipe = {
      ...salad,
      ingredients: salad.ingredients.map((i) => (i.form === "cooked" ? { ...i, form: "raw" } : i)),
    };
    expect(cookedOnlyMeat(raw)).toBe(false);
    expect(coreTempViolation(raw)).toMatch(/poultry core temperature missing/);
  });

  it("still fails cooked chicken with no core temperature when no safety line covers it", () => {
    const salad = recipes.find((r) => r.id === "roast-cauliflower-chickpea-chicken-salad")!;
    const bare: Recipe = { ...salad, safety: ["Wash hands and sanitise tools."] };
    expect(coreTempViolation(bare)).toMatch(/poultry core temperature missing/);
  });

  it("never exempts fish, even when the fish is marked cooked", () => {
    const salad = recipes.find((r) => r.id === "roast-cauliflower-chickpea-chicken-salad")!;
    const fish: Recipe = {
      ...salad,
      ingredients: [{ ...salad.ingredients[0], name: "cooked hoki fillet" }],
    };
    expect(coreTempViolation(fish)).toMatch(/fish core temperature missing/);
  });

  it("keeps the NSW 75 C mince candidates at or above the 71 C floor, pending the owner decision", () => {
    const candidates = recipes.filter(belowNswMinceTemp);
    expect(candidates).toHaveLength(NSW_MINCE_CANDIDATES);
    for (const r of candidates) expect(r.internalTempC, r.id).toBeGreaterThanOrEqual(71);
  });

  it("requires a core temperature for every fish and poultry recipe", () => {
    for (const r of recipes.filter((x) => /\b(fish|salmon|cod|hoki|prawn|tuna)\b/i.test(x.ingredients.map((i) => i.name).join(" ")))) {
      expect(r.internalTempC, r.id).not.toBeNull();
      expect(r.internalTempC, r.id).toBeGreaterThanOrEqual(63);
    }
  });
});

describe("nutrition", () => {
  it("keeps every nutrient finite and non-negative, with fibre unknown rather than zero", () => {
    for (const r of recipes) {
      for (const k of ["protein", "calories", "carbs", "fat"] as const) {
        expect(Number.isFinite(r.nutrition[k]), `${r.id} ${k}`).toBe(true);
        expect(r.nutrition[k], `${r.id} ${k}`).toBeGreaterThanOrEqual(0);
      }
      if (r.nutrition.fibre !== null) expect(r.nutrition.fibre, r.id).toBeGreaterThanOrEqual(0);
    }
  });

  it("keeps calorie-to-macro agreement within the documented Atwater tolerance, with only documented outliers", () => {
    const outliers = recipes.filter((r) => Math.abs(atwater(r).deviation) > atwater(r).tolerance);
    expect(outliers.length).toBeLessThanOrEqual(ATWATER_OUTLIERS_DOCUMENTED);
    for (const r of outliers) expect(Math.abs(atwater(r).deviation) / r.nutrition.calories, r.id).toBeLessThan(0.5);
  });

  it("supports the documented claim of 128 main meals with at least 25 g protein per serving", () => {
    const mains = recipes.filter((r) => !["breakfast", "snacks-sides", "desserts"].includes(r.category));
    expect(mains.filter((r) => r.nutrition.protein >= 25)).toHaveLength(PROTEIN_25G_MAINS);
  });

  it("reproduces every AFCD-calculated record from its listed edible grams within 1 g and 5 kcal", () => {
    const byId = new Map(recipes.map((r) => [r.id, r]));
    const authored = read("research/savoury/authored.json") as Record<string, { afcd?: string[]; ingredients: [number, string, ...unknown[]][]; servings: number }>;
    for (const [id, a] of Object.entries(authored)) {
      if (!a.afcd || LABEL_PROFILE_IDS.includes(id)) continue;
      const rec = byId.get(id);
      expect(rec, id).toBeDefined();
      const t = { protein: 0, fat: 0, carbs: 0, kj: 0 };
      a.ingredients.forEach((ing, i) => {
        const f = afcdSavoury.get(a.afcd![i]);
        expect(f, `${id} ${a.afcd![i]}`).toBeDefined();
        const k = Number(ing[0]) / 100 / a.servings;
        t.protein += (f!.protein ?? 0) * k;
        t.fat += (f!.fat ?? 0) * k;
        t.carbs += (f!.carbs ?? 0) * k;
        t.kj += (f!.energyKj ?? 0) * k;
      });
      expect(Math.abs(rec!.nutrition.protein - t.protein), `${id} protein`).toBeLessThanOrEqual(1);
      expect(Math.abs(rec!.nutrition.fat - t.fat), `${id} fat`).toBeLessThanOrEqual(1);
      expect(Math.abs(rec!.nutrition.carbs - t.carbs), `${id} carbs`).toBeLessThanOrEqual(1);
      expect(Math.abs(rec!.nutrition.calories - t.kj / 4.184), `${id} kcal`).toBeLessThanOrEqual(5);
    }
  });

  it("reproduces plant AFCD calculations from the saved edible grams within 1 g and 5 kcal", () => {
    const byId = new Map(recipes.map((r) => [r.id, r]));
    const calcs = read("research/plant/afcd-calculations.json") as {
      slug: string;
      servings: number;
      ingredientMatches: { grams: number; referenceId: string }[];
    }[];
    for (const c of calcs) {
      if (LABEL_PROFILE_IDS.includes(c.slug)) continue;
      const rec = byId.get(c.slug);
      expect(rec, c.slug).toBeDefined();
      const t = { protein: 0, fat: 0, carbs: 0, kj: 0 };
      for (const m of c.ingredientMatches) {
        const f = afcdPlant.get(m.referenceId) ?? afcdSavoury.get(m.referenceId);
        if (!f) continue;
        const k = m.grams / 100;
        t.protein += (f.protein ?? 0) * k;
        t.fat += (f.fat ?? 0) * k;
        t.carbs += (f.carbs ?? 0) * k;
        t.kj += (f.energyKj ?? 0) * k;
      }
      expect(Math.abs(rec!.nutrition.protein - t.protein / c.servings), `${c.slug} protein`).toBeLessThanOrEqual(1);
      expect(Math.abs(rec!.nutrition.calories - t.kj / 4.184 / c.servings), `${c.slug} kcal`).toBeLessThanOrEqual(5);
    }
  });
});

describe("sources and provenance", () => {
  it("has a register entry for every recipe with matching sources, title and category", () => {
    expect(register.count).toBe(300);
    const byId = new Map(register.recipes.map((r) => [r.id, r]));
    for (const r of recipes) {
      const entry = byId.get(r.id);
      expect(entry, r.id).toBeDefined();
      expect(entry!.sources.map((s) => s.url), r.id).toEqual(r.sources.map((s) => s.url));
      expect(entry!.title, r.id).toBe(r.title);
      expect(entry!.category, r.id).toBe(r.category);
    }
  });

  it("gives every savoury recipe a provenance record for its primary URL", () => {
    const byId = new Map(savouryProvenance.map((p) => [p.id, p]));
    for (const r of savoury) {
      expect(byId.get(r.id), r.id).toBeDefined();
      expect(byId.get(r.id)!.url, r.id).toBe(r.sources[0].url);
    }
  });

  it("keeps the web-read-only evidence limitation at its documented size", () => {
    expect(savouryProvenance.filter((p) => p.httpStatus === null)).toHaveLength(WEB_READ_ONLY_COUNT);
  });

  it("finds verification evidence for every plant primary source except the known gaps", () => {
    const hasEvidence = plantEvidenceUrls(root, (p) => (existsSync(p) ? readFileSync(p, "utf8") : null));
    const gaps = plant.filter((r) => !r.sources.some((s) => hasEvidence(s.url))).map((r) => r.id);
    expect(gaps).toEqual(KNOWN_PLANT_EVIDENCE_GAPS);
  });

  it("ties every calculated record to an FSANZ source and a nutrition reference it lists", () => {
    for (const r of recipes) {
      expect(r.sources.some((s) => s.url === r.nutrition.reference), r.id).toBe(true);
      if (r.nutrition.method.includes("FSANZ")) {
        expect(r.sources.some((s) => /foodstandards\.gov\.au/.test(s.url)), r.id).toBe(true);
      }
    }
  });
});

describe("allergens and dietary labels", () => {
  it("declares every allergen keyword found in the ingredients", () => {
    for (const r of recipes) expect(missingAllergens(r), r.id).toEqual([]);
  });

  it("keeps vegetarian, vegan, dairy-free and gluten-free labels consistent with the ingredients", () => {
    for (const r of recipes) expect(dietaryConflicts(r), r.id).toEqual([]);
  });
});

describe("units and duplicates", () => {
  it("does not grow the number of volume units used on solid ingredients", () => {
    const lines = recipes.flatMap((r) => volumeOnSolids(r).map((i) => `${r.id}: ${i.quantity} ml ${i.name}`));
    expect(lines.length).toBeLessThanOrEqual(VOLUME_SOLID_LINES_DOCUMENTED);
  });

  it("reports only the documented near-duplicate candidates for editorial review", () => {
    const pairs = nearDuplicates(recipes).map((p) => `${p.a}|${p.b}`).sort();
    expect(pairs).toEqual([...DOCUMENTED_NEAR_DUPLICATES].sort());
  });
});
