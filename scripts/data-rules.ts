// Pure data-quality rules shared by scripts/validate-data.ts and
// tests/unit/backend-data-catalogue.test.ts. Keep these side-effect free.
import type { Recipe } from "../src/lib/schema";

export const AIR_FRYER_MIN_C = 60;
export const AIR_FRYER_MAX_C = 240;
// Core temperatures follow the NSW guidance used by the catalogue. The 75 C row for
// minced, stuffed or rolled meat is an owner decision, so it is reported, not failed.
export const POULTRY_MIN_C = 74;
export const FISH_MIN_C = 63;
export const MINCE_NSW_C = 75;
export const TOTAL_MINUTES_WARN = 480;
export const TOTAL_MINUTES_MAX = 1440;
export const KCAL_PER_SERVING_MAX = 2000;

const normalise = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ");
const STOP = new Set([
  "air", "fryer", "airfryer", "the", "with", "and", "for", "recipe", "how", "make",
  "best", "ever", "easy", "crispy", "crisp", "homemade", "style", "copycat", "in", "on",
  "from", "to", "of", "a", "my", "your", "two", "ultimate", "simple", "small",
]);

export const titleTokens = (s: string) =>
  new Set(
    normalise(s)
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP.has(w)),
  );

export const jaccard = (a: Set<string>, b: Set<string>) => {
  const inter = [...a].filter((x) => b.has(x)).length;
  return inter / (a.size + b.size - inter || 1);
};

export const ingredientNameSet = (r: Recipe) =>
  new Set(
    r.ingredients
      .map((i) => normalise(i.name).replace(/\s+/g, " ").trim())
      .filter(Boolean),
  );

// Names that look like meat but are not: vegetarian mince, mincemeat, stock.
const NOT_ANIMAL_RE =
  /\b(vegetarian|vegan|mincemeat|fruit mince|vegetable stock|eggplant|egg-?free)\b/i;
const POULTRY_RE = /\b(chicken|turkey|duck)\b/i;
const FISH_RE =
  /\b(fish|salmon|tuna|cod|hoki|hake|barramundi|snapper|trout|haddock|pollock|mackerel|sardine|bream|anchov\w*|prawn|shrimp|crab|lobster|squid|calamari|scallop|mussel|oyster|clam)\b/i;
const MEAT_RE =
  /\b(beef|pork|lamb|veal|mutton|bacon|ham|sausages?|chorizo|salami|pepperoni|mince|minced|meatballs?|kofta|keema|steak|ribs?|chicken|turkey|duck)\b/i;
const MINCED_OR_ROLLED_RE =
  /\b(mince|minced|sausages?|meatballs?|burgers?|patt(?:y|ies)|kofta|keema|chorizo|meatloaf|meat loaf|rolls?|parcels?|turnovers?|stuffed|roulades?|kebabs?|taquitos?)\b/i;

export const animalIngredientNames = (r: Recipe) =>
  r.ingredients.map((i) => i.name).filter((n) => !NOT_ANIMAL_RE.test(n));

export const hasPoultry = (r: Recipe) =>
  animalIngredientNames(r).some((n) => POULTRY_RE.test(n));
export const hasFish = (r: Recipe) =>
  animalIngredientNames(r).some((n) => FISH_RE.test(n));
export const hasMeat = (r: Recipe) =>
  animalIngredientNames(r).some((n) => MEAT_RE.test(n));

// A poultry or meat recipe may omit a core temperature only when it never cooks raw
// meat: every matching ingredient is already cooked and a safety line addresses the
// cooked, chilled handling. Fish never gets this exemption.
export const cookedOnlyMeat = (r: Recipe) => {
  const meat = r.ingredients.filter(
    (i) => !NOT_ANIMAL_RE.test(i.name) && (POULTRY_RE.test(i.name) || MEAT_RE.test(i.name)),
  );
  return (
    meat.length > 0 &&
    meat.every((i) => i.form === "cooked") &&
    r.safety.some((s) => /cooked/i.test(s) && /(refrigerat|chill)/i.test(s))
  );
};

// Returns the core-temperature violation for this recipe, or null when it is safe.
export const coreTempViolation = (r: Recipe): string | null => {
  const shown = r.internalTempC === null ? "missing" : `${r.internalTempC} C`;
  if (hasFish(r) && (r.internalTempC === null || r.internalTempC < FISH_MIN_C))
    return `fish core temperature ${shown}; must be at least ${FISH_MIN_C} C`;
  if (r.internalTempC === null && (hasPoultry(r) || (hasMeat(r) && !hasFish(r))) && cookedOnlyMeat(r))
    return null;
  if (hasPoultry(r) && (r.internalTempC === null || r.internalTempC < POULTRY_MIN_C))
    return `poultry core temperature ${shown}; must be at least ${POULTRY_MIN_C} C`;
  if (!hasPoultry(r) && hasMeat(r) && !hasFish(r) && r.internalTempC === null)
    return "meat ingredient with no internal core temperature";
  return null;
};

// Minced/stuffed/rolled meat at less than the NSW 75 C row (owner decision).
export const belowNswMinceTemp = (r: Recipe) =>
  (hasPoultry(r) || (hasMeat(r) && !hasFish(r))) &&
  MINCED_OR_ROLLED_RE.test(`${r.title} ${animalIngredientNames(r).join(" | ")}`) &&
  r.internalTempC !== null &&
  r.internalTempC < MINCE_NSW_C;

// Expected energy from Atwater factors. Carbohydrate is total carbohydrate including
// fibre (2 kcal/g). Tolerance covers 1 g rounding of four macros, AFCD energy factors
// and publisher rounding: max(10 % of kcal, 10 kcal).
export const atwater = (r: Recipe) => {
  const n = r.nutrition;
  const expected = 4 * n.protein + 4 * n.carbs + 9 * n.fat - 2 * (n.fibre ?? 0);
  const tolerance = Math.max(0.1 * n.calories, 10);
  return { deviation: n.calories - expected, tolerance, expected };
};

// Keyword allergen cross-check. A hit is a candidate for review, not a verdict.
const ALLERGEN_KEYWORDS: [RegExp, string][] = [
  [/\b(milk|butter|cheese|cheddar|mozzarella|parmesan|feta|halloumi|paneer|yoghurt|yogurt|ricotta|ghee)\b/i, "milk"],
  [/\b(egg|eggs)\b/i, "egg"],
  [/\b(prawn|shrimp|crab|lobster|crayfish)\b/i, "crustacean"],
  [/\b(squid|calamari|scallop|mussel|clam|oyster)\b/i, "mollusc"],
  [/\b(fish|salmon|tuna|cod|hoki|hake|barramundi|snapper|trout|haddock|anchov\w*)\b/i, "fish"],
  [/\b(tahini|sesame)\b/i, "sesame"],
  [/\b(peanut)\b/i, "peanut"],
  [/\b(almond|walnut|cashew|pecan|hazelnut|pistachio|macadamia)\b/i, "tree-nut"],
];
// Audit-confirmed false positives: coconut milk/cream, cream-style mustard, nut butters,
// corn tortilla chips and vegetarian mincemeat.
const ALLERGEN_FALSE_POSITIVE_RE =
  /\b(coconut (milk|cream)|cream-style mustard|almond butter|almond milk|peanut butter|tortilla chips|vegetarian fruit mince|mincemeat)\b/i;

export const missingAllergens = (r: Recipe): string[] => {
  const declared = new Set<string>(r.allergens);
  const names = r.ingredients.map((i) => i.name).filter((n) => !ALLERGEN_FALSE_POSITIVE_RE.test(n));
  return ALLERGEN_KEYWORDS.filter(([re, allergen]) => names.some((n) => re.test(n)) && !declared.has(allergen)).map(
    ([, allergen]) => allergen,
  );
};

const WHEAT_RE =
  /\b(flour|bread|bagel|tortilla|wrap|pitta|pita|naan|pastry|couscous|orzo|pasta|noodles?|soy sauce|panko|breadcrumbs?|crumbs|toast|buns?|rolls?|oats|barley|rye|croutons?|biscuits?)\b/i;
const WHEAT_EXCLUDE_RE = /\b(tortilla chips|rice noodles?|cornflour|rolled oats)\b/i;
const DAIRY_RE =
  /\b(milk|butter|cheese|cheddar|mozzarella|parmesan|feta|halloumi|paneer|yoghurt|yogurt|cream|ghee|ricotta|mascarpone)\b/i;

export const dietaryConflicts = (r: Recipe): string[] => {
  const out: string[] = [];
  const D = new Set<string>(r.dietary);
  const names = r.ingredients.map((i) => i.name).filter((n) => !NOT_ANIMAL_RE.test(n));
  if (D.has("vegetarian") && names.some((n) => ANIMAL_TERM_RE.test(n)))
    out.push("vegetarian label with an animal ingredient");
  const notFalsePositive = r.ingredients.map((i) => i.name).filter((n) => !ALLERGEN_FALSE_POSITIVE_RE.test(n));
  if (D.has("vegan") && notFalsePositive.some((n) => /\b(egg|eggs|honey)\b/i.test(n) || DAIRY_RE.test(n)))
    out.push("vegan label with dairy, egg or honey");
  if (D.has("dairy-free") && notFalsePositive.some((n) => DAIRY_RE.test(n)))
    out.push("dairy-free label with a dairy ingredient");
  if (D.has("gluten-free") && r.ingredients.some((i) => WHEAT_RE.test(i.name) && !WHEAT_EXCLUDE_RE.test(i.name)))
    out.push("gluten-free label with a wheat-type ingredient");
  return out;
};
const ANIMAL_TERM_RE =
  /\b(fish sauce|anchov\w*|gelatin|gelatine|stock|worcestershire|oyster sauce|shrimp paste|bonito|lard|suet|chicken|beef|pork|bacon|ham|salmon|tuna|chorizo|sausages?|mince|prawns?|shrimp|meatballs?)\b/i;

// Volume units on solids (flour, sugar, oats, nuts, cheese). Shopping never converts
// between ml and g, so these lines cannot be aggregated with weighed ingredients.
const SOLID_RE =
  /\b(flour|sugar|oats?|seeds?|nuts?|almonds?|pecans|walnuts|cashews|cornflour|cornstarch|starch|meal|cheese|paneer|ricotta|mozzarella|cheddar|parmesan|granola|chips?)\b/i;
const NOT_SOLID_RE = /\b(sauce|wine|vinegar|oil|milk|juice|yoghurt|stock|pesto|butter|cream(?! cheese))\b/i;
export const volumeOnSolids = (r: Recipe) =>
  r.ingredients.filter((i) => i.unit === "ml" && SOLID_RE.test(i.name) && !NOT_SOLID_RE.test(i.name));

export const nearDuplicates = (recipes: Recipe[]) => {
  const pairs: { a: string; b: string; titleJaccard: number; ingredientJaccard: number }[] = [];
  const titles = recipes.map((r) => titleTokens(r.title));
  const ingredients = recipes.map((r) => ingredientNameSet(r));
  for (let i = 0; i < recipes.length; i++)
    for (let j = i + 1; j < recipes.length; j++) {
      const a = recipes[i];
      const b = recipes[j];
      const titleJaccard = jaccard(titles[i], titles[j]);
      const ingredientJaccard = jaccard(ingredients[i], ingredients[j]);
      if (
        (titleJaccard >= 0.5 && ingredientJaccard >= 0.5) ||
        (a.category === b.category && ingredientJaccard >= 0.9)
      )
        pairs.push({
          a: a.id,
          b: b.id,
          titleJaccard: +titleJaccard.toFixed(2),
          ingredientJaccard: +ingredientJaccard.toFixed(2),
        });
    }
  return pairs;
};

// Plant recipes keep their evidence across several research files. A primary source
// counts as evidenced when its URL appears in one of these files.
export const PLANT_EVIDENCE_FILES = [
  "research/plant/verified-sources.json",
  "research/plant/rt-evidence.json",
  "research/plant/rt-more-evidence.json",
  "research/plant/rt-facts.json",
  "research/plant/extra-facts.json",
  "research/plant/expansion-facts.json",
  "research/plant/indian-facts.json",
  "research/plant/manual-facts.json",
  "research/plant/source-facts.json",
] as const;

const normaliseUrl = (u: string) =>
  u.replace(/\/$/, "").replace(/^https?:\/\/(www\.)?/, "").toLowerCase();

export const plantEvidenceUrls = (root: string, readText: (path: string) => string | null) => {
  const urls = new Set<string>();
  for (const file of PLANT_EVIDENCE_FILES) {
    const text = readText(`${root}/${file}`);
    if (text === null) continue;
    for (const m of text.matchAll(/https?:\/\/[^\s"'<>\\]+/g)) urls.add(normaliseUrl(m[0].replace(/[.,;)]+$/, "")));
  }
  return (url: string) => urls.has(normaliseUrl(url));
};
