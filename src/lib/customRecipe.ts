import { ingredientSchema, type Ingredient, type Recipe } from "./schema";
import { categoryLabels } from "../data/catalogue";

const vulgarFractions: Record<string, string> = {
  "½": "1/2",
  "⅓": "1/3",
  "⅔": "2/3",
  "¼": "1/4",
  "¾": "3/4",
  "⅛": "1/8",
};

// Units people write in recipes, mapped to the units the app stores. Metric
// conversions are exact except cups, which use the 250 ml Australian metric cup.
const unitAliases: Record<
  string,
  { unit: Ingredient["unit"]; factor: number }
> = {
  g: { unit: "g", factor: 1 },
  gram: { unit: "g", factor: 1 },
  grams: { unit: "g", factor: 1 },
  kg: { unit: "g", factor: 1000 },
  kilo: { unit: "g", factor: 1000 },
  kilos: { unit: "g", factor: 1000 },
  kilogram: { unit: "g", factor: 1000 },
  kilograms: { unit: "g", factor: 1000 },
  ml: { unit: "ml", factor: 1 },
  millilitre: { unit: "ml", factor: 1 },
  millilitres: { unit: "ml", factor: 1 },
  milliliter: { unit: "ml", factor: 1 },
  milliliters: { unit: "ml", factor: 1 },
  l: { unit: "ml", factor: 1000 },
  litre: { unit: "ml", factor: 1000 },
  litres: { unit: "ml", factor: 1000 },
  liter: { unit: "ml", factor: 1000 },
  liters: { unit: "ml", factor: 1000 },
  cup: { unit: "ml", factor: 250 },
  cups: { unit: "ml", factor: 250 },
  tsp: { unit: "tsp", factor: 1 },
  teaspoon: { unit: "tsp", factor: 1 },
  teaspoons: { unit: "tsp", factor: 1 },
  tbsp: { unit: "tbsp", factor: 1 },
  tbs: { unit: "tbsp", factor: 1 },
  tablespoon: { unit: "tbsp", factor: 1 },
  tablespoons: { unit: "tbsp", factor: 1 },
  each: { unit: "each", factor: 1 },
  whole: { unit: "each", factor: 1 },
};

function quantityValue(text: string): number {
  const mixed = text.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  const fraction = text.match(/^(\d+)\/(\d+)$/);
  if (fraction) return Number(fraction[1]) / Number(fraction[2]);
  return Number(text);
}

// Reads a line such as "200 g chicken breast, diced", "1½ cups rice",
// "3 eggs", "pinch of salt" or "salt". Returns null when no ingredient name
// can be found. Lines with a | are handled by the pipe format instead.
export function parseNaturalIngredient(line: string): Ingredient | null {
  const text = line
    .replace(/(\d)\s*([½⅓⅔¼¾⅛])/g, "$1 $2")
    .replace(/[½⅓⅔¼¾⅛]/g, (c) => vulgarFractions[c] ?? c)
    .trim();
  let quantity = 1;
  let unit: Ingredient["unit"] = "each";
  let form = "as needed";
  let rest = text;
  const pinch = rest.match(/^pinch(?:es)?\s+(?:of\s+)?(.*)$/i);
  if (pinch) {
    quantity = 0.125;
    unit = "tsp";
    form = "as sold";
    rest = pinch[1];
  } else {
    const amount = rest.match(
      /^(\d+\s+\d+\/\d+|\d+\/\d+|\d*\.\d+|\d+)\s*(.*)$/,
    );
    if (amount) {
      quantity = quantityValue(amount[1]);
      rest = amount[2];
      form = "as sold";
      const [first = "", ...others] = rest.split(/\s+/);
      const alias = unitAliases[first.toLowerCase()];
      if (alias) {
        unit = alias.unit;
        quantity *= alias.factor;
        rest = others.join(" ");
      }
    }
  }
  rest = rest.replace(/^of\s+/i, "").trim();
  const [name, ...preparation] = rest.split(",");
  const cleanName = name.trim();
  if (!/[a-z]/i.test(cleanName)) return null;
  return {
    quantity: Math.round(quantity * 1000) / 1000,
    unit,
    name: cleanName,
    form,
    preparation: preparation.join(",").trim(),
    aisle: "Pantry",
  };
}

export function parseCustomIngredients(value: string): {
  ingredients: Ingredient[];
  errors: string[];
} {
  const lines = value
    .split("\n")
    .map((line, index) => ({ line: line.trim(), number: index + 1 }))
    .filter(({ line }) => line);
  if (!lines.length)
    return {
      ingredients: [],
      errors: ["Add at least one ingredient, using one ingredient per line."],
    };
  if (lines.length > 100)
    return { ingredients: [], errors: ["Use no more than 100 ingredients."] };
  const ingredients: Ingredient[] = [];
  const errors: string[] = [];
  for (const { line, number } of lines) {
    if (!line.includes("|")) {
      const natural = parseNaturalIngredient(line);
      const parsed = natural && ingredientSchema.safeParse(natural);
      if (parsed?.success) ingredients.push(parsed.data);
      else
        errors.push(
          `Line ${number}: could not read “${line}”. Write an amount, a unit and the ingredient, for example 200 g chicken breast, or use the | format.`,
        );
      continue;
    }
    const parts = line.split("|").map((part) => part.trim());
    if (parts.length < 4 || parts.length > 6) {
      errors.push(
        `Line ${number}: use 4 to 6 sections separated by |. Include quantity, unit, ingredient and its form; preparation and supermarket section are optional.`,
      );
      continue;
    }
    const [amount, unit, name, form, preparation = "", aisle = "Pantry"] =
      parts;
    const parsed = ingredientSchema.safeParse({
      quantity: Number(amount),
      unit,
      name,
      form,
      preparation,
      aisle,
    });
    if (parsed.success) {
      ingredients.push(parsed.data);
      continue;
    }
    const messages = new Set(
      parsed.error.issues.map((issue) => {
        switch (issue.path[0]) {
          case "quantity":
            return "enter a quantity greater than 0 and no more than 1,000,000 (use a decimal such as 0.5, not 1/2)";
          case "unit":
            return "choose a unit: g, ml, each, tsp or tbsp";
          case "name":
            return "give the ingredient a name of 1 to 300 characters";
          case "form":
            return "describe its form in 1 to 300 characters, for example raw, cooked or as sold";
          case "preparation":
            return "keep preparation instructions to 10,000 characters";
          case "aisle":
            return "give the supermarket section 1 to 300 characters, or omit that final section";
          default:
            return "check this ingredient’s values";
        }
      }),
    );
    errors.push(`Line ${number}: ${[...messages].join("; ")}.`);
  }
  return { ingredients, errors };
}

// Minimum internal temperatures (°C) by category. Ingredient words below can
// raise the requirement for a recipe in any category, so a quick dinner with
// chicken cannot be saved without a safety temperature.
const categoryMinimumC: Partial<Record<Recipe["category"], number>> = {
  "chicken-turkey": 74,
  meat: 71,
  breakfast: 71,
  seafood: 63,
};
const proteinMinimumC: [RegExp, number, string][] = [
  [/\b(chicken|turkey|duck|quail)\b/i, 74, "poultry"],
  [
    /\b(mince|minced|pork|sausages?|bacon|ham|beef|lamb|steak|veal|eggs?)\b/i,
    71,
    "mince, pork, egg or red meat",
  ],
  [/\b(fish|salmon|cod|tuna|prawns?|shrimp|barramundi|seafood)\b/i, 63, "fish"],
];
// Stock, sauce and similar packaged ingredients name a meat but contain none raw.
const packagedIngredient =
  /\b(sauce|stock|broth|paste|powder|seasoning|extract|oil)\b/i;

export function coreTemperatureRequirement(
  category: Recipe["category"],
  ingredients: Ingredient[],
): { minimum: number | null; reason: string } {
  let minimum = categoryMinimumC[category] ?? null;
  let reason = minimum
    ? `for ${categoryLabels[category].toLowerCase()} recipes`
    : "";
  for (const ingredient of ingredients) {
    if (packagedIngredient.test(ingredient.name)) continue;
    for (const [pattern, value, label] of proteinMinimumC) {
      if (pattern.test(ingredient.name) && value > (minimum ?? 0)) {
        minimum = value;
        reason = `because it contains ${ingredient.name} (${label})`;
      }
    }
  }
  return { minimum, reason };
}
