import { useEffect, useRef, useState, type ReactNode } from "react";
import { Plus, Trash2, Pencil } from "lucide-react";
import {
  actions,
  recipeSchema,
  ingredientSchema,
  localDate,
  type Recipe,
  type Ingredient,
} from "../lib";
import { useApp } from "../components/context";
import { Empty, Modal, PageHeading } from "../components/UI";
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

type FieldErrors = Record<string, string>;

const requiredMessages: Record<string, string> = {
  category: "Choose a category, so the safety temperature rule can apply.",
  title: "Enter a name for this recipe. Spaces alone do not count.",
  description: "Describe the recipe in a sentence.",
  portion: "Say what one serving is.",
  turn: "Say when to shake or turn the food, or write “Not needed”.",
  steps: "Add at least one method step.",
  safety: "Add the food-safety notes for this recipe.",
  storage: "Say how to store or reheat it, or that it is eaten immediately.",
  nutritionSource: "Explain how the nutrition was estimated.",
};
// Same bounds as the inputs. The form uses noValidate so every message sits
// next to its field, which means these checks must be explicit here.
const numberBounds: Record<string, [number, number]> = {
  servings: [0.5, 100],
  prep: [0, 600],
  cook: [1, 600],
  preheat: [0, 20],
  temperature: [40, 260],
  protein: [0, 10000],
  calories: [0, 10000],
  carbs: [0, 10000],
  fat: [0, 10000],
};
// Maps schema paths to the form field names rendered below.
const schemaFieldFor: Record<string, string> = {
  internalTempC: "core",
  temperatureC: "temperature",
  prepMinutes: "prep",
  cookMinutes: "cook",
  totalMinutes: "cook",
  preheatMinutes: "preheat",
  sources: "source",
};
const renderedFields = new Set([
  "title",
  "description",
  "category",
  "servings",
  "prep",
  "cook",
  "preheat",
  "temperature",
  "portion",
  "ingredients",
  "steps",
  "turn",
  "core",
  "safety",
  "storage",
  "protein",
  "calories",
  "carbs",
  "fat",
  "nutritionSource",
  "source",
]);

function fieldForIssue(path: PropertyKey[]): string {
  const [head, second] = path.map(String);
  if (head === "nutrition")
    return second === "reference" ? "nutritionSource" : (second ?? "protein");
  return schemaFieldFor[head] ?? head;
}

function issueMessage(field: string, code: string) {
  if (requiredMessages[field]) return requiredMessages[field];
  if (field === "source")
    return "Use a full https:// link, or leave this blank.";
  if (field === "cook" && code === "custom")
    return "Total time must include prep and cooking.";
  return "Use a value within the range shown.";
}

// Field-level message placed next to its control. Screen readers reach it
// through aria-describedby, so the label keeps a short accessible name.
function FieldError({ name, errors }: { name: string; errors: FieldErrors }) {
  const message = errors[name];
  return message ? (
    <p id={`${name}-error`} className="custom-field-error">
      {message}
    </p>
  ) : null;
}

function Field({
  name,
  errors,
  children,
}: {
  name: string;
  errors: FieldErrors;
  children: ReactNode;
}) {
  return (
    <div className="custom-field">
      {children}
      <FieldError name={name} errors={errors} />
    </div>
  );
}

function describedBy(name: string, errors: FieldErrors, hint?: string) {
  const ids = [hint, errors[name] ? `${name}-error` : undefined]
    .filter(Boolean)
    .join(" ");
  return {
    "aria-invalid": errors[name] ? true : undefined,
    "aria-describedby": ids || undefined,
  } as const;
}

function Required() {
  return (
    <span className="required-mark" aria-hidden="true">
      {" "}
      *
    </span>
  );
}

export function CustomRecipes() {
  const { data, run } = useApp();
  const [editing, setEditing] = useState<Recipe | "new" | null>(null);
  const [deleting, setDeleting] = useState<Recipe | null>(null);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const [ingredientErrors, setIngredientErrors] = useState<string[]>([]);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [dirty, setDirty] = useState(false);
  const [discardPrompt, setDiscardPrompt] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const keepEditing = useRef<HTMLButtonElement>(null);
  const focusFirstError = useRef(false);
  const recipe = editing && editing !== "new" ? editing : null;

  // Keep unsaved work from being lost to a reload or closed tab.
  useEffect(() => {
    if (!editing || !dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [editing, dirty]);

  useEffect(() => {
    if (discardPrompt) keepEditing.current?.focus();
  }, [discardPrompt]);

  useEffect(() => {
    if (!focusFirstError.current) return;
    focusFirstError.current = false;
    formRef.current
      ?.querySelector<HTMLElement>('[aria-invalid="true"]')
      ?.focus();
  });

  function closeEditor() {
    setEditing(null);
    setDirty(false);
    setDiscardPrompt(false);
    setFieldErrors({});
    setIngredientErrors([]);
  }

  function requestClose() {
    if (dirty) setDiscardPrompt(true);
    else closeEditor();
  }

  function reportErrors(errors: FieldErrors) {
    setFieldErrors(errors);
    focusFirstError.current = true;
  }

  return (
    <>
      <PageHeading
        title="Recipes from your own kitchen"
        description="Keep your own creations alongside the collection. They’re private to your saved kitchen."
        action={
          <button
            className="button primary"
            onClick={() => {
              setIngredientErrors([]);
              setFieldErrors({});
              setDirty(false);
              setEditing("new");
            }}
          >
            <Plus size={18} />
            Create a recipe
          </button>
        }
      />
      {data.customRecipes.length ? (
        <div className="custom-list">
          {data.customRecipes.map((c) => (
            <article className="surface" key={c.id}>
              <h2>
                <a href={`#/recipe/${c.id}`}>{c.recipe.title}</a>
              </h2>
              <p>{c.recipe.description}</p>
              <div className="button-row">
                <button
                  className="button"
                  aria-label={`Edit ${c.recipe.title}`}
                  onClick={() => {
                    setIngredientErrors([]);
                    setFieldErrors({});
                    setDirty(false);
                    setEditing(c.recipe);
                  }}
                >
                  <Pencil size={16} />
                  Edit
                </button>
                <button
                  className="button"
                  aria-label={`Delete ${c.recipe.title}`}
                  onClick={() => setDeleting(c.recipe)}
                >
                  <Trash2 size={16} />
                  Delete
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <Empty title="A place for your own favourites">
          Create your first recipe with measured ingredients, safe cooking
          instructions and an honest nutrition estimate.
        </Empty>
      )}
      {editing && (
        <Modal
          title={recipe ? "Edit your recipe" : "Create your recipe"}
          onClose={requestClose}
        >
          <form
            ref={formRef}
            className="stack-form"
            noValidate
            onChange={(e) => {
              setDirty(true);
              const name = (e.target as HTMLElement).getAttribute("name");
              if (name && fieldErrors[name])
                setFieldErrors((current) =>
                  Object.fromEntries(
                    Object.entries(current).filter(([key]) => key !== name),
                  ),
                );
              if (ingredientErrors.length && name === "ingredients")
                setIngredientErrors([]);
            }}
            onSubmit={async (e) => {
              e.preventDefault();
              if (submitting.current) return;
              const f = new FormData(e.currentTarget);
              const text = (name: string) => String(f.get(name) ?? "");
              const errors: FieldErrors = {};
              for (const [name, message] of Object.entries(requiredMessages))
                if (!text(name).trim()) errors[name] = message;
              for (const [name, [min, max]] of Object.entries(numberBounds)) {
                const value = text(name).trim();
                const number = Number(value);
                if (value === "" || !(number >= min && number <= max))
                  errors[name] = `Enter a number from ${min} to ${max}.`;
              }
              const parsedIngredients = parseCustomIngredients(
                text("ingredients"),
              );
              setIngredientErrors(parsedIngredients.errors);
              const category = text("category") as Recipe["category"];
              const requirement = coreTemperatureRequirement(
                category,
                parsedIngredients.ingredients,
              );
              const coreText = text("core").trim();
              const core =
                coreText === "" ? requirement.minimum : Number(coreText);
              if (
                coreText !== "" &&
                !(Number(coreText) >= 0 && Number(coreText) <= 100)
              )
                errors.core = "Enter a temperature from 0 to 100.";
              else if (
                !parsedIngredients.errors.length &&
                requirement.minimum !== null &&
                (core === null || core < requirement.minimum)
              )
                errors.core = `Use at least ${requirement.minimum}°C as the core safety temperature ${requirement.reason}.`;
              const sourceText = text("source").trim();
              if (sourceText && !/^https:\/\/\S+$/.test(sourceText))
                errors.source =
                  "Use a full https:// link, or leave this blank.";
              if (
                Object.keys(errors).length ||
                parsedIngredients.errors.length
              ) {
                reportErrors(errors);
                return;
              }

              const prep = Number(text("prep"));
              const cook = Number(text("cook"));
              const preheat = Number(text("preheat"));
              const source =
                sourceText || "https://www.foodauthority.nsw.gov.au/media/871";
              const firstSource = recipe?.sources[0];
              const unchangedSource = firstSource?.url === source;
              const timesUnchanged =
                recipe &&
                prep === recipe.prepMinutes &&
                cook === recipe.cookMinutes &&
                preheat === recipe.preheatMinutes;
              const id = recipe?.id || `custom-${crypto.randomUUID()}`;
              // Keep imported metadata that this editor does not expose. Only a
              // changed source gets a new unverified reference label and date.
              const candidate = {
                ...recipe,
                id,
                slug: recipe?.slug ?? id,
                title: text("title"),
                description: text("description"),
                category,
                tags: recipe?.tags ?? ["Your own recipe"],
                sources: [
                  unchangedSource
                    ? firstSource
                    : {
                        title:
                          source ===
                          "https://www.foodauthority.nsw.gov.au/media/871"
                            ? "Food safety reference; custom recipe not independently verified"
                            : "User-supplied reference; not independently verified",
                        url: source,
                        verifiedAt: localDate(
                          new Date(),
                          data.preferences.timezone,
                        ),
                      },
                  ...(recipe?.sources.slice(1) ?? []),
                ],
                prepMinutes: prep,
                cookMinutes: cook,
                totalMinutes: timesUnchanged
                  ? recipe.totalMinutes
                  : prep + cook + preheat,
                temperatureC: Number(text("temperature")),
                servings: Number(text("servings")),
                portion: text("portion"),
                ingredients: parsedIngredients.ingredients,
                steps: text("steps")
                  .split("\n")
                  .filter((s) => s.trim()),
                preheat: preheat > 0,
                preheatMinutes: preheat,
                turn: text("turn"),
                safety:
                  recipe && text("safety") === recipe.safety.join(" ")
                    ? recipe.safety
                    : [text("safety")],
                internalTempC: core,
                nutrition: {
                  protein: Number(text("protein")),
                  calories: Number(text("calories")),
                  carbs: Number(text("carbs")),
                  fat: Number(text("fat")),
                  fibre: recipe?.nutrition.fibre ?? null,
                  method:
                    recipe?.nutrition.method ??
                    "User-entered per-serving estimate; not independently verified.",
                  confidence: recipe?.nutrition.confidence ?? "estimated",
                  reference: text("nutritionSource"),
                },
                allergens: f.getAll("allergens"),
                dietary: recipe?.dietary ?? [],
                substitutions: recipe?.substitutions ?? [],
                oilFree: f.get("oilFree") === "on",
                storage: text("storage"),
                equipment: recipe?.equipment ?? [
                  "Basket-style air fryer",
                  "Food thermometer as required",
                ],
                difficulty: recipe?.difficulty ?? "Easy",
                image:
                  recipe?.category === category
                    ? recipe.image
                    : {
                        src: `/images/${category}.webp`,
                        alt: `Illustrative ${categoryLabels[category].toLowerCase()} image`,
                        credit: "AirFuel Kitchen",
                        licence:
                          "AI-generated category illustration; not a photograph of this recipe",
                      },
              };
              // Validate here so every problem lands next to its field, not in a
              // toast with raw schema text.
              const checked = recipeSchema.safeParse(candidate);
              if (!checked.success) {
                for (const issue of checked.error.issues) {
                  const field = fieldForIssue(issue.path);
                  const known = renderedFields.has(field);
                  const key = known ? field : "form";
                  errors[key] ??= known
                    ? issueMessage(field, issue.code)
                    : "Check the highlighted details and try again.";
                }
                reportErrors(errors);
                return;
              }
              submitting.current = true;
              setBusy(true);
              try {
                const okay = await run(
                  () => actions.saveCustomRecipe(checked.data),
                  "Your recipe is saved",
                );
                if (okay) closeEditor();
              } finally {
                submitting.current = false;
                setBusy(false);
              }
            }}
          >
            <p className="small muted custom-required-note">
              Fields marked <span aria-hidden="true">*</span> are required.
            </p>
            {fieldErrors.form && (
              <div className="field-error" role="alert">
                <strong>Check the details</strong>
                <p>{fieldErrors.form}</p>
              </div>
            )}
            <Field name="title" errors={fieldErrors}>
              <label>
                Recipe name
                <Required />
                <input
                  name="title"
                  required
                  maxLength={200}
                  defaultValue={recipe?.title}
                  {...describedBy("title", fieldErrors)}
                />
              </label>
            </Field>
            <Field name="description" errors={fieldErrors}>
              <label>
                A short description
                <Required />
                <textarea
                  name="description"
                  required
                  rows={2}
                  maxLength={1000}
                  defaultValue={recipe?.description}
                  {...describedBy("description", fieldErrors)}
                />
              </label>
            </Field>
            <div className="form-grid">
              <Field name="category" errors={fieldErrors}>
                <label>
                  Category
                  <Required />
                  <select
                    name="category"
                    required
                    defaultValue={recipe?.category ?? ""}
                    {...describedBy("category", fieldErrors)}
                  >
                    <option value="" disabled>
                      Choose a category
                    </option>
                    {Object.entries(categoryLabels).map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </select>
                </label>
              </Field>
              <Field name="servings" errors={fieldErrors}>
                <label>
                  Recipe servings
                  <Required />
                  <input
                    name="servings"
                    type="number"
                    min="0.5"
                    max="100"
                    step="0.5"
                    defaultValue={recipe?.servings || 2}
                    required
                    {...describedBy("servings", fieldErrors)}
                  />
                </label>
              </Field>
              <Field name="prep" errors={fieldErrors}>
                <label>
                  Prep minutes
                  <Required />
                  <input
                    name="prep"
                    type="number"
                    min="0"
                    max="600"
                    defaultValue={recipe?.prepMinutes ?? 5}
                    required
                    {...describedBy("prep", fieldErrors)}
                  />
                </label>
              </Field>
              <Field name="cook" errors={fieldErrors}>
                <label>
                  Air-frying minutes
                  <Required />
                  <input
                    name="cook"
                    type="number"
                    min="1"
                    max="600"
                    defaultValue={recipe?.cookMinutes || 15}
                    required
                    {...describedBy("cook", fieldErrors)}
                  />
                </label>
              </Field>
              <Field name="preheat" errors={fieldErrors}>
                <label>
                  Preheat minutes (0 if none)
                  <Required />
                  <input
                    name="preheat"
                    type="number"
                    min="0"
                    max="20"
                    defaultValue={recipe?.preheatMinutes ?? 3}
                    required
                    {...describedBy("preheat", fieldErrors)}
                  />
                </label>
              </Field>
              <Field name="temperature" errors={fieldErrors}>
                <label>
                  Air-fryer setting (°C)
                  <Required />
                  <input
                    name="temperature"
                    type="number"
                    min="40"
                    max="260"
                    defaultValue={recipe?.temperatureC || 180}
                    required
                    {...describedBy("temperature", fieldErrors)}
                  />
                </label>
              </Field>
            </div>
            <Field name="portion" errors={fieldErrors}>
              <label>
                What is one serving?
                <Required />
                <input
                  name="portion"
                  required
                  defaultValue={recipe?.portion}
                  placeholder="e.g. Half the cooked batch"
                  {...describedBy("portion", fieldErrors)}
                />
              </label>
            </Field>
            <Field name="ingredients" errors={fieldErrors}>
              <label>
                Ingredients, one per line
                <Required />
                <textarea
                  className="code-input"
                  name="ingredients"
                  required
                  rows={6}
                  defaultValue={recipe?.ingredients
                    .map(
                      (i) =>
                        `${i.quantity} | ${i.unit} | ${i.name} | ${i.form} | ${i.preparation} | ${i.aisle}`,
                    )
                    .join("\n")}
                  placeholder={
                    "300 g chicken breast, diced\n1 tbsp olive oil\n½ tsp smoked paprika"
                  }
                  aria-invalid={ingredientErrors.length > 0 || undefined}
                  aria-describedby={[
                    "custom-ingredient-format",
                    ingredientErrors.length ? "custom-ingredient-errors" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                />
              </label>
            </Field>
            <p id="custom-ingredient-format" className="custom-hint">
              One ingredient per line, for example 200 g chicken breast, 2 tbsp
              olive oil, 1/2 tsp paprika, 3 eggs or pinch of salt. Units: g, kg,
              ml, L, tsp, tbsp, cup (250 ml), each. Advanced: quantity | unit |
              ingredient | form | preparation | supermarket section, for example
              300 | g | chicken breast | raw | diced | Meat &amp; seafood.
            </p>
            {ingredientErrors.length > 0 && (
              <div
                id="custom-ingredient-errors"
                className="field-error"
                role="alert"
              >
                <strong>Check your ingredient list</strong>
                <ul>
                  {ingredientErrors.map((error) => (
                    <li key={error}>{error}</li>
                  ))}
                </ul>
                <p>
                  Your recipe has not been saved. Your entries are still here.
                </p>
              </div>
            )}
            <Field name="steps" errors={fieldErrors}>
              <label>
                Method, one complete step per line
                <Required />
                <textarea
                  name="steps"
                  rows={6}
                  required
                  defaultValue={recipe?.steps.join("\n")}
                  placeholder="Include food size, arrangement, turning, doneness and safety checks."
                  {...describedBy("steps", fieldErrors)}
                />
              </label>
            </Field>
            <Field name="turn" errors={fieldErrors}>
              <label>
                When to shake or turn
                <Required />
                <input
                  name="turn"
                  required
                  defaultValue={recipe?.turn}
                  placeholder="e.g. Turn at 8 minutes"
                  {...describedBy("turn", fieldErrors)}
                />
              </label>
            </Field>
            <Field name="core" errors={fieldErrors}>
              <label>
                Required internal food temperature (°C)
                <input
                  name="core"
                  type="number"
                  min="0"
                  max="100"
                  defaultValue={recipe?.internalTempC ?? ""}
                  {...describedBy("core", fieldErrors, "custom-core-hint")}
                />
              </label>
              <p id="custom-core-hint" className="custom-hint">
                Different from the air-fryer setting. Poultry 74°C; mince, pork,
                egg or red meat 71°C; fish 63°C. Leave blank to use the minimum
                for this recipe.
              </p>
            </Field>
            <Field name="safety" errors={fieldErrors}>
              <label>
                Food safety notes
                <Required />
                <textarea
                  name="safety"
                  rows={3}
                  required
                  defaultValue={recipe?.safety.join(" ")}
                  placeholder="Use a clean thermometer, prevent cross-contamination, and follow accessory instructions."
                  {...describedBy("safety", fieldErrors)}
                />
              </label>
            </Field>
            <Field name="storage" errors={fieldErrors}>
              <label>
                Storage &amp; reheating
                <Required />
                <input
                  name="storage"
                  required
                  defaultValue={
                    recipe?.storage ||
                    "Eat immediately. Storage and reheating have not been validated for this custom recipe."
                  }
                  {...describedBy("storage", fieldErrors)}
                />
              </label>
            </Field>
            <fieldset>
              <legend>Contains these allergens (check every ingredient)</legend>
              <div className="checkbox-group">
                {[
                  "milk",
                  "egg",
                  "fish",
                  "crustacean",
                  "mollusc",
                  "peanut",
                  "tree-nut",
                  "sesame",
                  "soy",
                  "wheat",
                  "gluten",
                  "lupin",
                  "sulphites",
                ].map((a) => (
                  <label key={a}>
                    <input
                      type="checkbox"
                      name="allergens"
                      value={a}
                      defaultChecked={recipe?.allergens.includes(
                        a as Recipe["allergens"][number],
                      )}
                    />
                    {a}
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="check-label">
              <input
                name="oilFree"
                type="checkbox"
                defaultChecked={recipe?.oilFree}
              />
              No added oil required
            </label>
            <h3>Nutrition per serving</h3>
            <div className="form-grid">
              {(["protein", "calories", "carbs", "fat"] as const).map((n) => (
                <Field key={n} name={n} errors={fieldErrors}>
                  <label>
                    {n === "calories"
                      ? "Calories (kcal)"
                      : `${n[0].toUpperCase()}${n.slice(1)} (g)`}
                    <Required />
                    <input
                      name={n}
                      type="number"
                      min="0"
                      max="10000"
                      step="0.1"
                      required
                      defaultValue={recipe?.nutrition[n]}
                      {...describedBy(n, fieldErrors)}
                    />
                  </label>
                </Field>
              ))}
            </div>
            <Field name="nutritionSource" errors={fieldErrors}>
              <label>
                How did you estimate the nutrition?
                <Required />
                <textarea
                  name="nutritionSource"
                  rows={2}
                  required
                  defaultValue={recipe?.nutrition.reference}
                  placeholder="e.g. Sum of package-label nutrients for the measured edible ingredients, divided by 2 servings."
                  {...describedBy("nutritionSource", fieldErrors)}
                />
              </label>
            </Field>
            <Field name="source" errors={fieldErrors}>
              <label>
                Research/source link (optional HTTPS)
                <input
                  name="source"
                  type="url"
                  pattern="https://.*"
                  defaultValue={recipe?.sources[0]?.url}
                  placeholder="https://…"
                  {...describedBy("source", fieldErrors, "custom-source-hint")}
                />
              </label>
              <p id="custom-source-hint" className="custom-hint">
                Blank uses the NSW Food Authority food safety reference.
              </p>
            </Field>
            <p className="small muted">
              Custom recipes and their allergen/nutrition declarations are your
              own records. They are not independently verified. Custom recipes
              are excluded from recommendations whenever an allergen exclusion
              or dietary requirement is active.
            </p>
            {discardPrompt && (
              <div className="field-error" role="alert">
                <strong>Discard your changes?</strong>
                <p>Your recipe has not been saved.</p>
                <div className="dialog-actions">
                  <button
                    type="button"
                    className="button"
                    ref={keepEditing}
                    onClick={() => setDiscardPrompt(false)}
                  >
                    Keep editing
                  </button>
                  <button
                    type="button"
                    className="button danger"
                    onClick={closeEditor}
                  >
                    Discard changes
                  </button>
                </div>
              </div>
            )}
            <button className="button primary" disabled={busy}>
              {busy ? "Saving…" : "Save my recipe"}
            </button>
          </form>
        </Modal>
      )}
      {deleting && (
        <Modal
          title="Delete this custom recipe?"
          onClose={() => setDeleting(null)}
        >
          <p>
            {deleting.title} will be removed. Existing cooking memories and
            plans keep their IDs, but this recipe’s details will be unavailable
            unless restored from backup.
          </p>
          <div className="dialog-actions">
            <button className="button" onClick={() => setDeleting(null)}>
              Keep recipe
            </button>
            <button
              className="button danger"
              onClick={async () => {
                if (
                  await run(
                    () => actions.deleteCustomRecipe(deleting.id),
                    "Custom recipe deleted",
                  )
                )
                  setDeleting(null);
              }}
            >
              Delete recipe
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
