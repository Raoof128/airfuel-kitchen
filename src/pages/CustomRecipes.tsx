import { useEffect, useRef, useState, type ReactNode } from "react";
import { Plus, Trash2, Pencil } from "lucide-react";
import {
  actions,
  coreTemperatureRequirement,
  localDate,
  parseCustomIngredients,
  recipeSchema,
  type Recipe,
} from "../lib";
import { useApp } from "../components/context";
import { Empty, Modal, PageHeading } from "../components/UI";
import { categoryLabels } from "../data/catalogue";

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
