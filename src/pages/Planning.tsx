import { useRef, useState } from "react";
import {
  Plus,
  Trash2,
  ChevronLeft,
  ChevronRight,
  ShoppingBasket,
  Check,
  Pencil,
  Search,
  AlertTriangle,
} from "lucide-react";
import { useApp, formatQuantity, readableDate } from "../components/context";
import { Empty, Modal, PageHeading, SavedCheckbox } from "../components/UI";
import {
  actions,
  localDate,
  weekDates,
  plannedNutrition,
  buildShoppingList,
  filterRecipes,
  formatShoppingAmount,
} from "../lib";
import type {
  PantryItem,
  Preferences,
  PlanEntry,
  Recipe,
  ShoppingItem,
} from "../lib/schema";
const slots = ["breakfast", "lunch", "dinner", "snack"] as const;
function addDays(date: string, amount: number) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + amount);
  return d.toISOString().slice(0, 10);
}
function shiftWeek(date: string, amount: number) {
  return addDays(date, amount * 7);
}
// Reuses the recommendation filter one rule at a time, so each reason names the exact allergen or requirement.
function exclusionConflicts(
  recipe: Recipe,
  preferences: Pick<Preferences, "allergens" | "dietary">,
): string[] {
  const allergens = preferences.allergens
    .filter((allergen) => !filterRecipes([recipe], { excludeAllergens: [allergen] }).length)
    .map((allergen) => `Contains ${allergen}, now excluded`);
  const dietary = preferences.dietary
    .filter((claim) => !filterRecipes([recipe], { dietary: [claim] }).length)
    .map((claim) => `Not ${claim}, now required`);
  return [...allergens, ...dietary];
}
function dayName(day: string, options: Intl.DateTimeFormatOptions) {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("en-AU", {
    timeZone: "UTC",
    ...options,
  });
}
function WeekPicker({
  date,
  onChange,
}: {
  date: string;
  onChange: (value: string) => void;
}) {
  const week = weekDates(date);
  return (
    <div className="week-picker">
      <button
        className="icon-button"
        aria-label="Previous week"
        onClick={() => onChange(shiftWeek(date, -1))}
      >
        <ChevronLeft size={20} />
      </button>
      <label>
        <span>Week of {readableDate(week[0])}</span>
        <input
          type="date"
          aria-label="Choose planner week"
          value={date}
          onChange={(e) => {
            if (e.target.value) onChange(e.target.value);
          }}
        />
      </label>
      <button
        className="icon-button"
        aria-label="Next week"
        onClick={() => onChange(shiftWeek(date, 1))}
      >
        <ChevronRight size={20} />
      </button>
    </div>
  );
}
type FormErrors = Partial<Record<string, string>>;
// Inline message beside its control. It sits outside the <label> so it does not join the field's name.
function FieldError({ name, errors }: { name: string; errors: FormErrors }) {
  return errors[name] ? (
    <p id={`${name}-error`} className="planner-field-error">
      {errors[name]}
    </p>
  ) : null;
}
function invalidProps(name: string, errors: FormErrors, hint?: string) {
  const ids = [hint, errors[name] ? `${name}-error` : undefined]
    .filter(Boolean)
    .join(" ");
  return {
    "aria-invalid": errors[name] ? true : undefined,
    "aria-describedby": ids || undefined,
  } as const;
}
function focusFirstInvalid(form: HTMLFormElement, errors: FormErrors) {
  const first = Object.keys(errors).find((name) => errors[name]);
  if (first)
    (form.elements.namedItem(first) as HTMLElement | null)?.focus();
}
export function Planner() {
  const { data, recipes, run } = useApp();
  const [errors, setErrors] = useState<FormErrors>({});
  const today = localDate(new Date(), data.preferences.timezone);
  const [date, setDate] = useState(today);
  // Narrow screens show one day at a time; wide screens ignore this.
  const [selectedDay, setSelectedDay] = useState(today);
  const [adding, setAdding] = useState<
    | (Pick<PlanEntry, "date" | "slot"> &
        Partial<Pick<PlanEntry, "id" | "servings">>)
    | null
  >(null);
  const [search, setSearch] = useState("");
  const [recipeId, setRecipeId] = useState("");
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const week = weekDates(date);
  const plans = data.plans.filter((p) => week.includes(p.date));
  const totals = plannedNutrition(plans, recipes);
  // A new week opens on today when it is in view, otherwise on its first day.
  function changeWeek(value: string) {
    const nextWeek = weekDates(value);
    setDate(value);
    setSelectedDay(nextWeek.includes(today) ? today : nextWeek[0]);
  }
  function moveDay(amount: number) {
    const next = addDays(selectedDay, amount);
    setSelectedDay(next);
    if (!week.includes(next)) setDate(next);
  }
  const choices = filterRecipes(recipes, {
    query: search,
    excludeAllergens: data.preferences.allergens,
    dietary: data.preferences.dietary,
    avoidIngredients: data.preferences.avoidIngredients,
  });
  // An existing meal excluded by changed dietary settings must not silently
  // turn into the first allowed recipe when its editor opens.
  const selectedRecipe =
    choices.find((recipe) => recipe.id === recipeId) ||
    (search || !adding?.id ? choices[0] : undefined);
  return (
    <>
      <PageHeading
        title="A good week starts here"
        description="Make a little room for good food. We’ll take care of the shopping list."
        action={
          <a className="button" href="#/shopping">
            <ShoppingBasket size={18} />
            Shopping list
          </a>
        }
      />
      <div className="planner-toolbar">
        <WeekPicker date={date} onChange={changeWeek} />
        <div className="plan-totals">
          <strong>{plans.length} meals planned</strong>
          <span>
            ≈ {Math.round(totals.protein)}g protein ·{" "}
            {Math.round(totals.calories).toLocaleString()} kcal across all
            planned servings
          </span>
        </div>
      </div>
      {totals.missingRecipes > 0 && (
        <p className="notice">
          {totals.missingRecipes} planned recipes are missing. Restore their
          custom recipe backup or remove them.
        </p>
      )}
      <nav className="day-strip" aria-label="Days this week">
        {week.map((day) => {
          const count = plans.filter((p) => p.date === day).length;
          return (
            <button
              key={day}
              type="button"
              className={`day-chip ${day === today ? "today" : ""}`}
              aria-pressed={day === selectedDay}
              // The name starts with the visible "Mon 5" text (WCAG 2.5.3).
              aria-label={`${dayName(day, { weekday: "short" })} ${dayName(day, { day: "numeric" })}, ${dayName(day, { weekday: "long", day: "numeric", month: "long" })}, ${count} ${count === 1 ? "meal" : "meals"} planned`}
              onClick={() => setSelectedDay(day)}
            >
              <span>{dayName(day, { weekday: "short" })}</span>
              <strong>{dayName(day, { day: "numeric" })}</strong>
              {count > 0 && <i aria-hidden="true" />}
            </button>
          );
        })}
      </nav>
      <div className="day-nav">
        <button
          className="icon-button"
          aria-label="Previous day"
          onClick={() => moveDay(-1)}
        >
          <ChevronLeft size={20} />
        </button>
        <strong>
          {dayName(selectedDay, {
            weekday: "long",
            day: "numeric",
            month: "long",
          })}
        </strong>
        <button
          className="icon-button"
          aria-label="Next day"
          onClick={() => moveDay(1)}
        >
          <ChevronRight size={20} />
        </button>
      </div>
      <div className="week-grid">
        {week.map((day) => (
          <section
            key={day}
            data-selected={day === selectedDay}
            aria-labelledby={`day-long-${day}`}
            className={`day-panel ${day === today ? "today" : ""}`}
          >
            <header>
              <h2>
                {new Date(`${day}T12:00:00Z`).toLocaleDateString("en-AU", {
                  weekday: "short",
                  timeZone: "UTC",
                })}
              </h2>
              {/* Every panel is named by its full date, at all widths. */}
              <span id={`day-long-${day}`} className="sr-only">
                {dayName(day, { weekday: "long", day: "numeric", month: "long" })}
              </span>
              <span>
                {new Date(`${day}T12:00:00Z`).toLocaleDateString("en-AU", {
                  day: "numeric",
                  month: "short",
                  timeZone: "UTC",
                })}
              </span>
            </header>
            {slots.map((slot) => (
              <div className="meal-slot" key={slot}>
                <h3>{slot}</h3>
                {plans
                  .filter((p) => p.date === day && p.slot === slot)
                  .map((p) => {
                    const r = recipes.find((r) => r.id === p.recipeId);
                    const conflicts = r
                      ? exclusionConflicts(r, data.preferences)
                      : [];
                    return (
                      <article className="planned-meal" key={p.id}>
                        <a href={`#/recipe/${r?.slug || p.recipeId}`}>
                          {r?.title || "Recipe unavailable"}
                        </a>
                        <span>
                          {p.servings} servings
                          {r
                            ? ` · ${Math.round(r.nutrition.protein * p.servings)}g protein`
                            : ""}
                        </span>
                        {conflicts.length > 0 && (
                          <p className="planned-meal-conflict">
                            <AlertTriangle size={14} aria-hidden="true" />
                            <span>
                              Warning: {conflicts.join("; ")}. Keep it, or
                              change the meal.
                            </span>
                          </p>
                        )}
                        <div className="planned-meal-actions">
                          <button
                            className="icon-button"
                            aria-label={`Edit ${r?.title || "meal"} on ${day}`}
                            onClick={() => {
                              setAdding(p);
                              setSearch("");
                              setRecipeId(p.recipeId);
                            }}
                          >
                            <Pencil size={16} />
                          </button>
                          <button
                            className="icon-button"
                            aria-label={`Remove ${r?.title || "meal"} from ${day}`}
                            onClick={() =>
                              void run(
                                () => actions.deletePlan(p.id),
                                "Removed from meal plan",
                              )
                            }
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </article>
                    );
                  })}
                <button
                  className="add-meal"
                  aria-label={`Add meal to ${slot}, ${dayName(day, { weekday: "long", day: "numeric", month: "long" })}`}
                  onClick={() => {
                    setAdding({ date: day, slot });
                    setSearch("");
                    setRecipeId("");
                  }}
                >
                  <Plus size={16} />
                  Add meal
                </button>
              </div>
            ))}
          </section>
        ))}
      </div>
      <p className="small muted">
        Planned nutrition is an estimate for all servings prepared, not a record
        of what you ate. Use the cooking journal to log consumption.
      </p>
      {adding && (
        <Modal
          title={adding.id ? "Edit planned meal" : `Plan ${adding.slot}`}
          onClose={() => {
            setErrors({});
            setAdding(null);
          }}
        >
          <form
            className="stack-form"
            noValidate
            onSubmit={async (e) => {
              e.preventDefault();
              if (submitting.current) return;
              const f = new FormData(e.currentTarget);
              const date = String(f.get("date"));
              const servings = Number(f.get("servings"));
              const found: FormErrors = {};
              if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
                found.date = "Choose a day for this meal.";
              if (!selectedRecipe)
                found.recipe = "Choose a recipe before you save.";
              if (!Number.isFinite(servings) || servings < 0.5 || servings > 100)
                found.servings = "Enter servings from 0.5 to 100.";
              if (Object.keys(found).length) {
                setErrors(found);
                focusFirstInvalid(e.currentTarget, found);
                return;
              }
              if (!selectedRecipe) return;
              const recipe = selectedRecipe;
              setErrors({});
              submitting.current = true;
              setBusy(true);
              try {
                if (
                  await run(
                    () =>
                      actions.savePlan({
                        ...(adding.id ? { id: adding.id } : {}),
                        recipeId: recipe.id,
                        date,
                        slot: String(f.get("slot")) as PlanEntry["slot"],
                        servings,
                      }),
                    adding.id ? "Meal plan updated" : "Meal added",
                  )
                )
                  setAdding(null);
              } finally {
                submitting.current = false;
                setBusy(false);
              }
            }}
          >
            {Object.keys(errors).length > 0 && (
              <div className="field-error" role="alert">
                <strong>Check the details</strong>
              </div>
            )}
            <div className="form-grid">
              <div>
                <label>
                  Day
                  <input
                    name="date"
                    type="date"
                    required
                    defaultValue={adding.date}
                    {...invalidProps("date", errors)}
                  />
                </label>
                <FieldError name="date" errors={errors} />
              </div>
              <label>
                Meal
                <select name="slot" defaultValue={adding.slot}>
                  {slots.map((slot) => (
                    <option key={slot} value={slot}>
                      {slot.charAt(0).toUpperCase() + slot.slice(1)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label>
              Find a recipe
              <div className="search-box">
                <Search size={17} />
                <input
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setRecipeId("");
                  }}
                  placeholder="Chicken, tofu, breakfast…"
                />
              </div>
            </label>
            <div>
              <label>
                Recipe
                <select
                  name="recipe"
                  size={6}
                  value={selectedRecipe?.id || ""}
                  required
                  onChange={(e) => setRecipeId(e.target.value)}
                  {...invalidProps(
                    "recipe",
                    errors,
                    selectedRecipe ? undefined : "meal-recipe-hint",
                  )}
                >
                  {!selectedRecipe && (
                    <option value="" disabled>
                      Choose a recipe
                    </option>
                  )}
                  {choices.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.title} · {r.totalMinutes} min
                    </option>
                  ))}
                </select>
              </label>
              <FieldError name="recipe" errors={errors} />
            </div>
            {!selectedRecipe && (
              <p id="meal-recipe-hint" className="notice">
                Choose a recipe matching your search and saved dietary settings.
                Your existing plan stays unchanged until you save.
              </p>
            )}
            <div>
              <label>
                Servings
                <input
                  name="servings"
                  type="number"
                  min="0.5"
                  max="100"
                  step="0.5"
                  defaultValue={
                    adding.servings ?? data.preferences.defaultServings
                  }
                  required
                  {...invalidProps("servings", errors)}
                />
              </label>
              <FieldError name="servings" errors={errors} />
            </div>
            <button className="button primary" disabled={busy}>
              {busy ? "Saving…" : adding.id ? "Save meal changes" : "Add meal"}
            </button>
          </form>
        </Modal>
      )}
    </>
  );
}
export function Shopping() {
  const { data, recipes, run } = useApp();
  const [date, setDate] = useState(
    localDate(new Date(), data.preferences.timezone),
  );
  const [excludePantry, setExcludePantry] = useState(true);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<ShoppingItem | null>(null);
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [clearing, setClearing] = useState(false);
  const week = weekDates(date);
  const scope = `week-${week[0]}:`;
  const saved = data.shopping
    .filter((s) => s.manual || s.id.startsWith(scope))
    .map((s) => (s.manual ? s : { ...s, id: s.id.slice(scope.length) }));
  const rows = buildShoppingList(
    data.plans.filter((p) => week.includes(p.date)),
    recipes,
    excludePantry ? data.pantry : [],
    saved,
  );
  const aisles = [...new Set(rows.map((r) => r.aisle))];
  const conflictingMeals = data.plans
    .filter((p) => week.includes(p.date))
    .filter((p) => {
      const r = recipes.find((recipe) => recipe.id === p.recipeId);
      return r && exclusionConflicts(r, data.preferences).length > 0;
    }).length;
  const tickedRows = rows.filter((r) => r.checked);
  const checked = tickedRows.length;
  // Manual items are deleted; planned ingredients are only unticked, since they come from the meal plan.
  async function clearTicked() {
    setClearing(true);
    try {
      const okay = await run(
        // One transaction: a failure part-way leaves every tick as it was (ARCH-12).
        () => actions.clearTickedShopping(week[0]),
        `Cleared ${checked} ticked ${checked === 1 ? "item" : "items"}`,
      );
      if (okay) setConfirmingClear(false);
    } finally {
      setClearing(false);
    }
  }
  return (
    <>
      <PageHeading
        title="A simpler supermarket trip"
        description="Your planned meals, gathered into one useful list."
        action={
          <button className="button primary" onClick={() => setAdding(true)}>
            <Plus size={17} />
            Add an item
          </button>
        }
      />
      <div className="planner-toolbar">
        <WeekPicker date={date} onChange={setDate} />
        <label className="check-label">
          <input
            type="checkbox"
            checked={excludePantry}
            onChange={(e) => setExcludePantry(e.target.checked)}
          />
          Subtract matching pantry quantities
        </label>
      </div>
      {conflictingMeals > 0 && (
        <p className="notice shopping-conflict">
          <AlertTriangle size={16} aria-hidden="true" />
          <span>
            {conflictingMeals} planned{" "}
            {conflictingMeals === 1 ? "meal conflicts" : "meals conflict"} with
            your exclusions. They stay on this list until you change them.{" "}
            <a href="#/planner">Review your plan</a>
          </span>
        </p>
      )}
      <div className="shopping-progress">
        <strong>
          {checked} of {rows.length} items ticked off
        </strong>
        <progress
          aria-label="Shopping list completion"
          value={checked}
          max={rows.length || 1}
        />
        {checked > 0 && (
          <button
            className="button"
            onClick={() => setConfirmingClear(true)}
          >
            Clear ticked items
          </button>
        )}
      </div>
      {!rows.length && (
        <Empty title="Your basket is waiting">
          Add a few meals to your week, add a recipe’s ingredients or write your
          own items.
          <a className="button" href="#/planner">
            Plan a meal
          </a>
        </Empty>
      )}
      <div className="shopping-columns">
        {aisles.map((aisle) => (
          <section key={aisle} className="shopping-group">
            <h2>{aisle}</h2>
            {rows
              .filter((r) => r.aisle === aisle)
              .map((row) => (
                <div
                  className={`shopping-row ${row.checked ? "checked" : ""}`}
                  key={row.id}
                >
                  <label>
                    <SavedCheckbox
                      checked={row.checked}
                      onCheckedChange={(checked) =>
                        run(() =>
                          actions.saveShopping({
                            ...row,
                            id: row.manual ? row.id : `${scope}${row.id}`,
                            checked,
                          }),
                        )
                      }
                    />
                    <span>
                      <strong>{row.name}</strong>
                      <small>
                        {formatShoppingAmount(row.quantity, row.unit)} ·{" "}
                        {row.form}
                      </small>
                    </span>
                  </label>
                  {row.manual && (
                    <>
                      <button
                        className="icon-button"
                        aria-label={`Edit ${row.name}`}
                        onClick={() => setEditing(row)}
                      >
                        <Pencil size={15} />
                      </button>
                      <button
                        className="icon-button"
                        aria-label={`Remove ${row.name}`}
                        onClick={() =>
                          void run(
                            () => actions.deleteShopping(row.id),
                            "Item removed",
                          )
                        }
                      >
                        <Trash2 size={15} />
                      </button>
                    </>
                  )}
                </div>
              ))}
          </section>
        ))}
      </div>
      <div className="info-band">
        <Check size={18} />
        <p>
          Planned ingredients combine only when names, forms and units match.
          Raw rice stays separate from cooked rice. To change planned
          quantities, update your meal plan.
        </p>
      </div>
      {confirmingClear && (
        <Modal
          title="Clear ticked items?"
          onClose={() => setConfirmingClear(false)}
        >
          <div className="stack-form">
            <p>
              {checked} ticked {checked === 1 ? "item" : "items"} will be
              cleared. Manual items you ticked are deleted. Planned ingredients
              are unticked and stay on the list. Your meal plan is not changed.
            </p>
            <div className="confirm-actions">
              <button
                className="button"
                onClick={() => setConfirmingClear(false)}
                disabled={clearing}
              >
                Keep ticks
              </button>
              <button
                className="button danger"
                onClick={() => void clearTicked()}
                disabled={clearing}
              >
                {clearing ? "Clearing…" : "Clear ticked items"}
              </button>
            </div>
          </div>
        </Modal>
      )}
      {(adding || editing) && (
        <Modal
          title={editing ? "Edit shopping item" : "Add to your shopping list"}
          onClose={() => {
            setAdding(false);
            setEditing(null);
          }}
        >
          <ItemForm
            shopping
            item={editing || undefined}
            onDone={() => {
              setAdding(false);
              setEditing(null);
            }}
          />
        </Modal>
      )}
    </>
  );
}
function ItemForm({
  item,
  shopping = false,
  onDone,
}: {
  item?: PantryItem | ShoppingItem;
  shopping?: boolean;
  onDone: () => void;
}) {
  const { run, recipes } = useApp();
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<FormErrors>({});
  const submitting = useRef(false);
  const ingredientNames = [
    ...new Set(recipes.flatMap((r) => r.ingredients.map((i) => i.name))),
  ].sort();
  return (
    <form
      className="stack-form"
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        if (submitting.current) return;
        const f = new FormData(e.currentTarget);
        const name = String(f.get("name")).trim();
        // An empty box must not become 0 via Number("").
        const rawQuantity = String(f.get("quantity")).trim();
        const quantity = rawQuantity === "" ? NaN : Number(rawQuantity);
        const ingredientForm = String(f.get("form")).trim();
        const found: FormErrors = {};
        if (!name) found.name = "Enter an ingredient name.";
        else if (name.length > 300)
          found.name = "Use 300 characters or fewer.";
        if (!Number.isFinite(quantity) || quantity < 0 || quantity > 1000000)
          found.quantity = "Enter a quantity from 0 to 1,000,000.";
        if (!ingredientForm)
          found.form = "Enter the ingredient form, such as raw or fresh.";
        if (Object.keys(found).length) {
          setErrors(found);
          focusFirstInvalid(e.currentTarget, found);
          return;
        }
        setErrors({});
        submitting.current = true;
        setBusy(true);
        try {
          const input = {
            id: item?.id,
            name,
            quantity,
            unit: String(f.get("unit")) as "g",
            form: ingredientForm,
          };
          const okay = await run(
            () =>
              shopping
                ? actions.saveShopping({
                    ...input,
                    aisle: String(f.get("aisle")),
                    manual: true,
                    checked: item && "checked" in item ? item.checked : false,
                  })
                : actions.savePantry(input),
            shopping ? "Shopping item saved" : "Pantry item saved",
          );
          if (okay) onDone();
        } finally {
          submitting.current = false;
          setBusy(false);
        }
      }}
    >
      {Object.keys(errors).length > 0 && (
        <div className="field-error" role="alert">
          <strong>Check the details</strong>
        </div>
      )}
      <div>
        <label>
          Ingredient
          <input
            name="name"
            list="ingredient-names"
            required
            maxLength={300}
            defaultValue={item?.name || ""}
            placeholder="e.g. chicken breast"
            {...invalidProps("name", errors)}
          />
          <datalist id="ingredient-names">
            {ingredientNames.map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
        </label>
        <FieldError name="name" errors={errors} />
      </div>
      <div className="form-grid">
        <div>
          <label>
            Quantity
            <input
              name="quantity"
              type="number"
              min="0"
              max="1000000"
              step="0.1"
              required
              defaultValue={item?.quantity ?? 1}
              {...invalidProps("quantity", errors)}
            />
          </label>
          <FieldError name="quantity" errors={errors} />
        </div>
        <label>
          Unit
          <select name="unit" defaultValue={item?.unit || "g"}>
            {["g", "ml", "each", "tsp", "tbsp"].map((u) => (
              <option key={u}>{u}</option>
            ))}
          </select>
        </label>
        <div>
          <label>
            Ingredient form
            <input
              name="form"
              list="ingredient-forms"
              required
              defaultValue={item?.form || "raw"}
              {...invalidProps("form", errors)}
            />
            <datalist id="ingredient-forms">
              {[
                "raw",
                "cooked",
                "fresh",
                "dried",
                "frozen",
                "drained",
                "as sold",
              ].map((f) => (
                <option key={f}>{f}</option>
              ))}
            </datalist>
          </label>
          <FieldError name="form" errors={errors} />
        </div>
        {shopping && (
          <label>
            Supermarket section
            <select
              name="aisle"
              defaultValue={item && "aisle" in item ? item.aisle : "Other"}
            >
              {[
                "Produce",
                "Meat & seafood",
                "Dairy & eggs",
                "Bakery",
                "Pantry",
                "Frozen",
                "Other",
              ].map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </label>
        )}
      </div>
      <p className="small muted">
        Use the same ingredient name, form and unit as the recipe for an exact
        pantry match. Australian tablespoon = 20 ml; teaspoon = 5 ml.
      </p>
      <button className="button primary" disabled={busy}>
        {busy ? "Saving…" : "Save item"}
      </button>
    </form>
  );
}
export function Pantry() {
  const { data, run } = useApp();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<PantryItem | null>(null);
  return (
    <>
      <PageHeading
        title="What’s in your kitchen?"
        description="A little pantry knowledge makes dinner easier."
        action={
          <button className="button primary" onClick={() => setAdding(true)}>
            <Plus size={17} />
            Add ingredient
          </button>
        }
      />
      <div className="info-band">
        <ShoppingBasket size={22} />
        <p>
          Pantry ingredients help your recommendations and subtract matching
          quantities from your shopping list. Update quantities after cooking.
        </p>
      </div>
      {data.pantry.length ? (
        <div className="pantry-grid">
          {data.pantry.map((p) => (
            <article className="pantry-item" key={p.id}>
              <div>
                <h2>{p.name}</h2>
                <p>
                  {formatQuantity(p.quantity)} {p.unit} · {p.form}
                </p>
              </div>
              <button
                className="icon-button"
                aria-label={`Edit ${p.name}`}
                onClick={() => setEditing(p)}
              >
                <Pencil size={17} />
              </button>
              <button
                className="icon-button"
                aria-label={`Remove ${p.name}`}
                onClick={() =>
                  void run(
                    () => actions.deletePantry(p.id),
                    "Removed from pantry",
                  )
                }
              >
                <Trash2 size={17} />
              </button>
            </article>
          ))}
        </div>
      ) : (
        <Empty title="Let’s take a quick inventory">
          Start with the ingredients you cook with most. Nothing is added
          automatically.
          <button className="button" onClick={() => setAdding(true)}>
            Add your first ingredient
          </button>
        </Empty>
      )}
      {(adding || editing) && (
        <Modal
          title={
            editing ? "Update pantry ingredient" : "Add a pantry ingredient"
          }
          onClose={() => {
            setAdding(false);
            setEditing(null);
          }}
        >
          <ItemForm
            item={editing || undefined}
            onDone={() => {
              setAdding(false);
              setEditing(null);
            }}
          />
        </Modal>
      )}
    </>
  );
}
