import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Heart,
  CalendarPlus,
  ShoppingBasket,
  Check,
  Star,
  Play,
  Printer,
  Share2,
  ShieldCheck,
  Clock3,
  Thermometer,
  Minus,
  Plus,
  Pencil,
} from "lucide-react";
import {
  useApp,
  formatAmount,
  formatQuantity,
  ingredientDetails,
  readableDate,
} from "../components/context";
import { Modal, FoodImage, Empty, Pill, SavedCheckbox } from "../components/UI";
import { CookingTimer } from "../components/CookingTimer";
import {
  readRecipeNoteDraft,
  writeRecipeNoteDraft,
  removeRecipeNoteDraft,
  subscribeToDraftReset,
} from "../lib/noteDrafts";
import { exploreReturnLocation } from "../lib/navigation";
import { SessionForm } from "../components/SessionForm";
import { actions, localDate, scaleIngredients } from "../lib";
import type { Recipe, ActiveCooking } from "../lib/schema";
export function PlanForm({
  recipe,
  initialServings,
  onDone,
}: {
  recipe: Recipe;
  initialServings?: number;
  onDone: () => void;
}) {
  const { data, run } = useApp();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submitting = useRef(false);
  const [fieldErrors, setFieldErrors] = useState<{
    date?: string;
    servings?: string;
  }>({});
  return (
    <form
      className="stack-form"
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        if (submitting.current) return;
        const form = e.currentTarget;
        const dateInput = form.elements.namedItem("date") as HTMLInputElement;
        const servingsInput = form.elements.namedItem(
          "servings",
        ) as HTMLInputElement;
        const errors: typeof fieldErrors = {};
        if (!dateInput.value) errors.date = "Choose a day for this meal.";
        if (!servingsInput.checkValidity())
          errors.servings = "Enter servings between 0.5 and 100.";
        setFieldErrors(errors);
        if (errors.date || errors.servings) {
          (errors.date ? dateInput : servingsInput).focus();
          return;
        }
        submitting.current = true;
        const f = new FormData(form);
        setBusy(true);
        setError("");
        const okay = await run(
          () =>
            actions.savePlan({
              recipeId: recipe.id,
              date: String(f.get("date")),
              slot: String(f.get("slot")) as "dinner",
              servings: Number(f.get("servings")),
            }),
          "Added to your meal plan",
        );
        setBusy(false);
        submitting.current = false;
        if (okay) onDone();
        else
          setError(
            "This meal could not be saved. Your entries are kept; check the values and try again.",
          );
      }}
    >
      <p>{recipe.title}</p>
      <label>
        Day
        <input
          name="date"
          type="date"
          required
          aria-invalid={Boolean(fieldErrors.date) || undefined}
          aria-describedby={fieldErrors.date ? "plan-date-error" : undefined}
          defaultValue={localDate(new Date(), data.preferences.timezone)}
        />
        {fieldErrors.date && (
          <span id="plan-date-error" className="field-error">
            {fieldErrors.date}
          </span>
        )}
      </label>
      <div className="form-grid">
        <label>
          Meal
          <select name="slot" defaultValue="dinner">
            <option value="breakfast">Breakfast</option>
            <option value="lunch">Lunch</option>
            <option value="dinner">Dinner</option>
            <option value="snack">Snack</option>
          </select>
        </label>
        <label>
          Servings
          <input
            name="servings"
            type="number"
            step="0.5"
            min="0.5"
            max="100"
            required
            aria-invalid={Boolean(fieldErrors.servings) || undefined}
            aria-describedby={
              fieldErrors.servings ? "plan-servings-error" : undefined
            }
            onChange={() =>
              fieldErrors.servings &&
              setFieldErrors({ ...fieldErrors, servings: undefined })
            }
            defaultValue={initialServings || data.preferences.defaultServings}
          />
          {fieldErrors.servings && (
            <span id="plan-servings-error" className="field-error">
              {fieldErrors.servings}
            </span>
          )}
        </label>
      </div>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      <button className="button primary" disabled={busy}>
        Add to meal plan
      </button>
    </form>
  );
}
export function RecipeDetail({ slug }: { slug: string }) {
  const { data, recipes, run, navigate } = useApp();
  const recipe = recipes.find((r) => r.slug === slug);
  const [servings, setServings] = useState(
    data.activeCooking?.recipeId === recipe?.id
      ? (data.activeCooking?.servings ?? data.preferences.defaultServings)
      : data.preferences.defaultServings,
  );
  const [modal, setModal] = useState<
    "plan" | "session" | "finish" | "adjust" | null
  >(null);
  const [note, setNote] = useState(
    readRecipeNoteDraft(recipe?.id) ??
      data.recipeStates.find((s) => s.id === recipe?.id)?.notes ??
      "",
  );
  // The notes this tab last loaded or saved; a save is rejected if another tab changed them since.
  const [savedNotes, setSavedNotes] = useState(
    data.recipeStates.find((s) => s.id === recipe?.id)?.notes ?? "",
  );
  const noteDirty = useRef(readRecipeNoteDraft(recipe?.id) !== null);
  const [draftStored, setDraftStored] = useState(true);
  useEffect(
    () =>
      subscribeToDraftReset(() => {
        noteDirty.current = false;
        noteRevision.current += 1;
        setNote("");
        setDraftStored(true);
      }),
    [],
  );
  const noteRevision = useRef(0);
  const savingNotes = useRef(false);
  const [notesBusy, setNotesBusy] = useState(false);
  const [adjustError, setAdjustError] = useState("");
  const [adjustErrors, setAdjustErrors] = useState<{
    temp?: string;
    cook?: string;
    steps?: string;
  }>({});
  const [servingsDraft, setServingsDraft] = useState<string | null>(null);
  const state = data.recipeStates.find((s) => s.id === recipe?.id);
  const active =
    data.activeCooking?.recipeId === recipe?.id
      ? data.activeCooking
      : undefined;
  useEffect(() => {
    if (recipe)
      void run(() =>
        actions.patchRecipeState(recipe.id, { viewedAt: Date.now() }),
      );
    // Record one view per recipe id: `recipe` is a new object on every data change,
    // and `run` is stable. Viewing is deliberately independent of tried status.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recipe?.id]);
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (noteDirty.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, []);
  useEffect(() => {
    // While this tab has unsaved edits, keep the baseline it loaded so a save can detect the other tab's change.
    if (noteDirty.current) return;
    setNote(state?.notes || "");
    setSavedNotes(state?.notes || "");
  }, [state?.notes]);
  useEffect(() => {
    if (active?.servings !== undefined) setServings(active.servings);
  }, [active?.servings]);
  if (!recipe)
    return (
      <Empty title="Recipe not found">
        This link may refer to a custom recipe saved on another device.
        <a className="button" href="#/explore">
          Explore recipes
        </a>
      </Empty>
    );
  const history = data.sessions
    .filter((s) => s.recipeId === recipe.id)
    .sort((a, b) => b.date.localeCompare(a.date) || b.updatedAt - a.updatedAt);
  const updateActive = (
    patch: Partial<Omit<ActiveCooking, "id" | "recipeId" | "updatedAt">>,
  ) =>
    run(() =>
      actions.patchActiveCooking(
        recipe.id,
        patch,
        servings,
        data.activeCooking?.recipeId ?? null,
      ),
    );
  const scaled = scaleIngredients(recipe, servings);
  async function addShopping() {
    // Ids are stable per recipe and position, so adding again replaces these rows
    // instead of duplicating them; keep any ticks already set on them. One
    // transaction: either every ingredient is added or none is (ARCH-12).
    const rows = scaled.map((item, index) => {
      const id = `direct-${recipe!.id}-${index}`;
      return {
        id,
        name: item.name,
        quantity: item.quantity,
        unit: item.unit,
        form: item.form,
        aisle: item.aisle,
        checked: data.shopping.find((s) => s.id === id)?.checked ?? false,
        manual: true,
      };
    });
    await run(
      () => actions.saveShoppingBatch(rows),
      "Ingredients added to your shopping list",
    );
  }
  // While this recipe is the active cook, the checklist is the cook's; otherwise
  // ticks are the recipe's own and never start a cook or block another recipe.
  function isChecked(kind: "ingredient" | "step", index: number) {
    if (active)
      return (
        kind === "ingredient" ? active.checkedIngredients : active.checkedSteps
      ).includes(index);
    const checks = state?.checks;
    return (
      (kind === "ingredient" ? checks?.ingredients : checks?.steps)?.includes(
        index,
      ) ?? false
    );
  }
  function setCheck(
    kind: "ingredient" | "step",
    index: number,
    checked: boolean,
  ) {
    return run(() =>
      active
        ? actions.setCookingCheck(
            recipe!.id,
            kind,
            index,
            checked,
            servings,
            recipe!.id,
          )
        : actions.setRecipeCheck(
            recipe!.id,
            kind,
            index,
            checked,
            kind === "ingredient" ? scaled.length : recipe!.steps.length,
          ),
    );
  }
  return (
    <>
      <a className="back-link" href={exploreReturnLocation()}>
        <ArrowLeft size={17} />
        Back to the kitchen
      </a>
      <div className="recipe-detail-heading">
        <div>
          <div className="tag-row">
            {recipe.tags.slice(0, 3).map((t) => (
              <Pill key={t}>{t}</Pill>
            ))}
          </div>
          <h1>{recipe.title}</h1>
          <p>{recipe.description}</p>
        </div>
        <button
          className={`button ${state?.favourite ? "selected" : ""}`}
          aria-pressed={state?.favourite || false}
          onClick={() =>
            void run(
              () => actions.toggleRecipeState(recipe.id, "favourite"),
              "Favourites updated",
            )
          }
        >
          <Heart size={18} fill={state?.favourite ? "currentColor" : "none"} />
          Save recipe
        </button>
      </div>
      <a
        className="recipe-cook-shortcut button primary"
        href={`#/cook/${recipe.slug}?servings=${servings}`}
      >
        <Play size={18} />
        {active ? "Return to Cook Mode" : "Cook this recipe"}
      </a>
      <div className="recipe-hero-layout">
        <FoodImage recipe={recipe} hero />
        <div className="recipe-summary">
          <span className="muted small">ESTIMATED PER SERVING</span>
          <div className="nutrition-primary">
            <strong>
              {Math.round(recipe.nutrition.protein)}
              <small>g</small>
            </strong>
            <span>protein</span>
          </div>
          <div className="macro-row">
            <span>
              <b>{Math.round(recipe.nutrition.calories)}</b>kcal
            </span>
            <span>
              <b>{Math.round(recipe.nutrition.carbs)}g</b>carbs
            </span>
            <span>
              <b>{Math.round(recipe.nutrition.fat)}g</b>fat
            </span>
          </div>
          <hr />
          <dl className="timing-list">
            <div>
              <dt>
                <Clock3 size={17} />
                Total time
              </dt>
              <dd>{recipe.totalMinutes} min</dd>
            </div>
            <div>
              <dt>Preparation</dt>
              <dd>{recipe.prepMinutes} min</dd>
            </div>
            <div>
              <dt>Air frying</dt>
              <dd>{recipe.cookMinutes} min</dd>
            </div>
            <div>
              <dt>
                <Thermometer size={17} />
                Air-fryer setting
              </dt>
              <dd>{recipe.temperatureC}°C</dd>
            </div>
          </dl>
          <button
            className="button primary"
            onClick={() =>
              navigate(`/cook/${recipe.slug}?servings=${servings}`)
            }
          >
            <Play size={18} />
            {active ? "Continue cooking" : "Start cooking"}
          </button>
        </div>
      </div>
      <div className="recipe-action-bar">
        <button className="button" onClick={() => setModal("plan")}>
          <CalendarPlus size={18} />
          Add to meal plan
        </button>
        <button className="button" onClick={() => void addShopping()}>
          <ShoppingBasket size={18} />
          Add ingredients
        </button>
        <button
          className={`button ${state?.tried ? "selected" : ""}`}
          aria-pressed={state?.tried || false}
          onClick={() =>
            void run(
              () => actions.toggleRecipeState(recipe.id, "tried"),
              "Tried status updated. You can undo this any time.",
            )
          }
        >
          <Check size={18} />
          Mark as tried
        </button>
        <button
          className="icon-button"
          aria-label="Print recipe"
          onClick={() => window.print()}
        >
          <Printer size={19} />
        </button>
        <button
          className="icon-button"
          aria-label="Copy recipe link"
          onClick={() =>
            void run(
              () => navigator.clipboard.writeText(location.href),
              "Recipe link copied. Custom recipes need a backup on the other device.",
            )
          }
        >
          <Share2 size={19} />
        </button>
      </div>
      {history.length > 0 && (
        <div className="last-time">
          <h3>A note from last time</h3>
          <p>
            {history[0].notes ||
              history[0].ingredientChanges ||
              "You’ve cooked this before. Your full history is below."}
          </p>
          <span>
            {readableDate(history[0].date)}
            {history[0].temperatureC
              ? ` · ${history[0].temperatureC}°C air-fryer setting`
              : ""}
            {history[0].timeChanges ? ` · ${history[0].timeChanges}` : ""}
          </span>
        </div>
      )}
      <div className="cooking-layout">
        <section className="ingredients-panel">
          <div className="section-heading">
            <h2>Ingredients</h2>
            <div className="serving-control">
              <button
                aria-label="Fewer servings"
                disabled={servings <= 0.5}
                onClick={() => {
                  setServings(Math.max(0.5, servings - 0.5));
                  if (active)
                    void updateActive({
                      servings: Math.max(0.5, servings - 0.5),
                    });
                }}
              >
                <Minus size={15} />
              </button>
              <label>
                <span className="sr-only">Servings</span>
                <input
                  type="number"
                  min="0.5"
                  max="100"
                  step="0.5"
                  value={servingsDraft ?? servings}
                  onChange={(e) => {
                    const text = e.target.value;
                    const v = Number(text);
                    // Keep the typed text while it is incomplete (empty, "0", "0.");
                    // only valid values change the scaled ingredients.
                    setServingsDraft(text);
                    if (text.trim() !== "" && v >= 0.5 && v <= 100) {
                      setServings(v);
                      if (active) void updateActive({ servings: v });
                    }
                  }}
                  onBlur={() => setServingsDraft(null)}
                />
              </label>
              <button
                aria-label="More servings"
                disabled={servings >= 100}
                onClick={() => {
                  setServings(servings + 0.5);
                  if (active) void updateActive({ servings: servings + 0.5 });
                }}
              >
                <Plus size={15} />
              </button>
            </div>
          </div>
          <p className="muted small">
            For {formatQuantity(servings)} servings · {recipe.portion}
          </p>
          <p className="small muted">
            Larger portions may need batches. Keep a single layer; cooking time
            is per batch.
          </p>
          <ul className="ingredient-list">
            {scaled.map((ing, i) => (
              <li key={i}>
                <label>
                  <SavedCheckbox
                    checked={isChecked("ingredient", i)}
                    onCheckedChange={(checked) =>
                      setCheck("ingredient", i, checked)
                    }
                  />
                  <span>
                    <strong>
                      {formatAmount(ing.quantity, ing.unit)}{" "}
                      {ing.unit === "each" ? "" : ing.unit}
                    </strong>{" "}
                    {ing.name}
                    <small>
                      {ingredientDetails(ing.preparation, ing.form)}
                    </small>
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <div className="ingredient-notes">
            <h3>Good to know</h3>
            <p>
              {recipe.preheat
                ? `Preheat for ${recipe.preheatMinutes} minutes at ${recipe.temperatureC}°C.`
                : "No preheating required unless your appliance instructions specify it."}
            </p>
            <p>{recipe.turn}</p>
            <p>
              <strong>Equipment:</strong> {recipe.equipment.join(", ")}
            </p>
            <p>
              <strong>Allergens:</strong>{" "}
              {recipe.allergens.length
                ? recipe.allergens.join(", ")
                : "No listed major allergens; check every package."}
            </p>
          </div>
        </section>
        <section id="method" className="method-panel">
          <div className="section-heading">
            <h2>Let’s get cooking</h2>
            <button
              className="text-button"
              onClick={() => {
                setAdjustError("");
                setModal("adjust");
              }}
            >
              <Pencil size={15} />
              My adjustments
            </button>
          </div>
          <CookingTimer recipe={recipe} servings={servings} />
          <ol className="method-list">
            {recipe.steps.map((step, i) => (
              <li
                key={i}
                className={isChecked("step", i) ? "step-complete" : ""}
              >
                <label>
                  <SavedCheckbox
                    checked={isChecked("step", i)}
                    onCheckedChange={(checked) => setCheck("step", i, checked)}
                  />
                  <span className="step-number">{i + 1}</span>
                  <span>{step}</span>
                </label>
              </li>
            ))}
          </ol>
          <div className="safety-note">
            <h3>
              <ShieldCheck size={20} />
              Cook with confidence
            </h3>
            {recipe.internalTempC !== null && (
              <p>
                <strong>
                  Food core temperature: {recipe.internalTempC}°C.
                </strong>{" "}
                Measure with a clean food thermometer; this is different from
                the air-fryer setting.
              </p>
            )}
            {recipe.safety.map((note, i) => (
              <p key={i}>{note}</p>
            ))}
            <p>
              Never preheat with loose baking paper. Check your appliance and
              accessory instructions, keep vents clear and avoid overcrowding.
            </p>
          </div>
          <button className="button primary" onClick={() => setModal("finish")}>
            Finished? Save a cooking memory
            <Check size={18} />
          </button>
          {active && (
            <button
              className="text-button"
              onClick={() =>
                void run(
                  () => actions.stopCooking(recipe.id),
                  "Cooking checklist closed",
                )
              }
            >
              Close cooking checklist
            </button>
          )}
        </section>
      </div>
      <div className="recipe-extras">
        <section className="surface">
          <h2>Make it your own</h2>
          {recipe.substitutions.map((s, i) => (
            <p key={i}>{s}</p>
          ))}
          <h3>Storage & reheating</h3>
          <p>{recipe.storage}</p>
        </section>
        <section className="surface">
          <h2>Your recipe notes</h2>
          <div
            className="rating-control"
            role="group"
            aria-label="Your recipe rating"
          >
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                aria-label={`Rate ${n} stars`}
                aria-pressed={state?.rating === n}
                onClick={() =>
                  void run(
                    () => actions.patchRecipeState(recipe.id, { rating: n }),
                    "Rating saved",
                  )
                }
              >
                <Star
                  size={25}
                  fill={(state?.rating || 0) >= n ? "currentColor" : "none"}
                />
              </button>
            ))}
            {state?.rating && (
              <button
                className="text-button"
                aria-label="Clear rating"
                onClick={() =>
                  void run(() =>
                    actions.patchRecipeState(recipe.id, { rating: null }),
                  )
                }
              >
                Clear
              </button>
            )}
          </div>
          <label className="sr-only" htmlFor="recipe-notes">
            Personal recipe notes
          </label>
          <textarea
            id="recipe-notes"
            rows={4}
            maxLength={10000}
            value={note}
            onChange={(e) => {
              setNote(e.target.value);
              noteDirty.current = true;
              noteRevision.current += 1;
              setDraftStored(writeRecipeNoteDraft(recipe.id, e.target.value));
            }}
            placeholder="Your tweaks, tips and next-time ideas…"
          />
          <p className="note-draft-status small" aria-live="polite">
            {noteDirty.current
              ? draftStored
                ? "Unsaved draft kept in this tab. Save notes to keep it in your kitchen and backups."
                : "Unsaved changes. Draft storage is unavailable; save before leaving this page."
              : "Saved notes stay in your kitchen and backups."}
          </p>
          <button
            className="button"
            disabled={notesBusy}
            onClick={async () => {
              if (savingNotes.current) return;
              savingNotes.current = true;
              setNotesBusy(true);
              const submittedRevision = noteRevision.current;
              const saved = await run(
                () => actions.saveRecipeNotes(recipe.id, note, savedNotes),
                "Recipe notes saved",
              );
              if (saved) setSavedNotes(note);
              // Keep edits made while the previous revision was being persisted.
              if (saved && submittedRevision === noteRevision.current) {
                noteDirty.current = false;
                removeRecipeNoteDraft(recipe.id);
              }
              savingNotes.current = false;
              setNotesBusy(false);
            }}
          >
            Save notes
          </button>
          {state?.triedAt && (
            <p className="small muted">
              Marked tried {new Date(state.triedAt).toLocaleDateString("en-AU")}
            </p>
          )}
        </section>
      </div>
      <section className="history-section">
        <div className="section-heading">
          <h2>Your cooking history</h2>
          <button className="text-button" onClick={() => setModal("session")}>
            Log another cook
          </button>
        </div>
        {history.length ? (
          history.map((s) => (
            <article className="history-row" key={s.id}>
              <div>
                <strong>{readableDate(s.date)}</strong>
                <span>
                  {s.rating ? `${s.rating}/5 stars · ` : ""}
                  {s.servingsPrepared} prepared · {s.servingsConsumed} eaten
                </span>
              </div>
              <p>{s.notes || "No notes for this session."}</p>
              <a href="#/journal">
                Edit in journal
                <ArrowLeft className="rotate" size={15} />
              </a>
            </article>
          ))
        ) : (
          <p className="muted">Your first cooking memory starts here.</p>
        )}
      </section>
      <details className="provenance">
        <summary>Recipe research, nutrition & image credits</summary>
        <h3>Source-checked, written for this kitchen</h3>
        {recipe.sources.map((s) => (
          <p key={s.url}>
            <a href={s.url} target="_blank" rel="noreferrer">
              {s.title}
            </a>{" "}
            ·{" "}
            {recipe.id.startsWith("custom-")
              ? "Reference added (not independently checked)"
              : "Checked"}{" "}
            {readableDate(s.verifiedAt)}
          </p>
        ))}
        <p>{recipe.nutrition.method}</p>
        <p>{recipe.nutrition.reference}</p>
        <p>
          Values are estimates per serving, not laboratory measurements. Brand,
          edible weights, cooking loss and ingredient substitutions change the
          result. Fibre:{" "}
          {recipe.nutrition.fibre === null
            ? "not available"
            : `${Math.round(recipe.nutrition.fibre)}g per serving`}
          .
        </p>
        <p>
          Image: {recipe.image.credit}. {recipe.image.licence}. The visual
          represents a food category and may show ingredients not in this
          recipe.
        </p>
        <p>
          Original cooking instructions; source research does not mean this
          adaptation has been kitchen-tested.
        </p>
      </details>
      {modal === "plan" && (
        <Modal title="Make room in your week" onClose={() => setModal(null)}>
          <PlanForm
            recipe={recipe}
            initialServings={servings}
            onDone={() => setModal(null)}
          />
        </Modal>
      )}
      {(modal === "session" || modal === "finish") && (
        <Modal title="A cooking memory" onClose={() => setModal(null)}>
          <SessionForm
            recipe={recipe}
            initialServings={servings}
            completeCooking={modal === "finish"}
            onDone={() => setModal(null)}
          />
        </Modal>
      )}
      {modal === "adjust" && (
        <Modal title="Your cooking adjustments" onClose={() => setModal(null)}>
          <form
            className="stack-form"
            noValidate
            onSubmit={async (e) => {
              e.preventDefault();
              const form = e.currentTarget;
              const f = new FormData(form);
              const cook = Number(f.get("cook"));
              const temp = Number(f.get("temp"));
              const steps = String(f.get("steps"))
                .split("\n")
                .filter((s) => s.trim());
              const errors: typeof adjustErrors = {};
              const tempInput = form.elements.namedItem(
                "temp",
              ) as HTMLInputElement;
              const cookInput = form.elements.namedItem(
                "cook",
              ) as HTMLInputElement;
              if (!tempInput.checkValidity())
                errors.temp = "Enter an air-fryer setting from 40 to 260 °C.";
              if (!cookInput.checkValidity())
                errors.cook = "Enter air-frying minutes from 1 to 600.";
              if (!steps.length) errors.steps = "Add at least one method step.";
              else if (
                (temp !== recipe.temperatureC || cook !== recipe.cookMinutes) &&
                steps.join("\n") === recipe.steps.join("\n")
              )
                errors.steps =
                  "Update the method steps to match your changed cooking temperature or time.";
              setAdjustError("");
              setAdjustErrors(errors);
              if (Object.keys(errors).length) {
                const firstInvalid = errors.temp
                  ? tempInput
                  : errors.cook
                    ? cookInput
                    : (form.elements.namedItem("steps") as HTMLElement);
                firstInvalid.focus();
                return;
              }
              if (
                await run(async () => {
                  return actions.saveOverride(
                    recipe.id,
                    {
                      temperatureC: temp,
                      cookMinutes: cook,
                      totalMinutes:
                        recipe.totalMinutes - recipe.cookMinutes + cook,
                      steps,
                    },
                    recipe,
                  );
                }, "Personal recipe adjustment saved")
              )
                setModal(null);
              else
                setAdjustError(
                  "Your adjustments could not be saved. Check the values and try again; your entries are kept.",
                );
            }}
          >
            <p>
              Saved only for you. Safety temperatures still apply. Timing
              depends on thickness and your appliance.
            </p>
            <label>
              Air-fryer setting (°C)
              <input
                name="temp"
                type="number"
                min="40"
                max="260"
                required
                aria-invalid={Boolean(adjustErrors.temp) || undefined}
                aria-describedby={
                  adjustErrors.temp ? "adjust-temp-error" : undefined
                }
                defaultValue={recipe.temperatureC}
              />
              {adjustErrors.temp && (
                <span id="adjust-temp-error" className="field-error">
                  {adjustErrors.temp}
                </span>
              )}
            </label>
            <label>
              Air-frying minutes
              <input
                name="cook"
                type="number"
                min="1"
                max="600"
                required
                aria-invalid={Boolean(adjustErrors.cook) || undefined}
                aria-describedby={
                  adjustErrors.cook ? "adjust-cook-error" : undefined
                }
                defaultValue={recipe.cookMinutes}
              />
              {adjustErrors.cook && (
                <span id="adjust-cook-error" className="field-error">
                  {adjustErrors.cook}
                </span>
              )}
            </label>
            <label>
              My method steps
              <textarea
                name="steps"
                aria-invalid={Boolean(adjustErrors.steps) || undefined}
                aria-describedby={
                  adjustErrors.steps ? "adjust-steps-error" : undefined
                }
                required
                rows={7}
                defaultValue={recipe.steps.join("\n")}
              />
              <small>
                One step per line. Review all temperatures and timings to match
                your adjustments. The original safety requirements still apply.
              </small>
            </label>
            {adjustErrors.steps && (
              <span id="adjust-steps-error" className="field-error">
                {adjustErrors.steps}
              </span>
            )}
            {adjustError && (
              <p id="adjust-error" className="field-error" role="alert">
                {adjustError}
              </p>
            )}
            <button className="button primary">Save my adjustments</button>
            <button
              type="button"
              className="text-button"
              onClick={async () => {
                if (
                  await run(
                    () => actions.deleteOverride(recipe.id),
                    "Original recipe restored",
                  )
                )
                  setModal(null);
              }}
            >
              Restore original recipe
            </button>
          </form>
        </Modal>
      )}
    </>
  );
}
