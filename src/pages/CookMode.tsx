import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChefHat,
  ChevronDown,
  Flame,
  ListChecks,
  Minus,
  Monitor,
  Plus,
  ShieldCheck,
  Thermometer,
} from "lucide-react";
import { CookingTimer } from "../components/CookingTimer";
import { SessionForm } from "../components/SessionForm";
import { Empty, Modal, SavedCheckbox } from "../components/UI";
import {
  formatAmount,
  formatQuantity,
  ingredientDetails,
  useApp,
} from "../components/context";
import { actions, scaleIngredients } from "../lib";
import "../styles/cook-mode.css";

export function CookMode({
  slug,
  initialServings,
}: {
  slug: string;
  initialServings?: number;
}) {
  const { data, recipes, run, navigate } = useApp();
  const recipe = recipes.find((item) => item.slug === slug);
  const active =
    data.activeCooking?.recipeId === recipe?.id
      ? data.activeCooking
      : undefined;
  const [servings, setServings] = useState(
    active?.servings ??
      (initialServings !== undefined &&
      Number.isFinite(initialServings) &&
      initialServings >= 0.5 &&
      initialServings <= 100
        ? initialServings
        : data.preferences.defaultServings),
  );
  const [selectedStep, setSelectedStep] = useState<number | null>(null);
  const [finish, setFinish] = useState(false);
  const [replacement, setReplacement] = useState<{
    id: string;
    title: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  // Typing stays local until the field is committed, so the input keeps focus
  // and a half-typed value (for example "1." or "") is never saved.
  const [servingsDraft, setServingsDraft] = useState<string | null>(null);
  const [startError, setStartError] = useState("");
  const submitting = useRef(false);
  // A servings save and a step toggle guard only their own re-entry. The step
  // toggle waits for the latest save, so a click that blurs the servings field
  // is queued after the commit instead of being dropped.
  const savingServings = useRef(false);
  const servingsSave = useRef<Promise<void>>(Promise.resolve());
  const togglingStep = useRef(false);
  const stepHeading = useRef<HTMLHeadingElement>(null);
  const wakeLock = useRef<WakeLockSentinel | null>(null);
  const changingWakeLock = useRef(false);
  const wakeLockScope = useRef(0);
  const hasActiveCook = Boolean(active);
  const mounted = useRef(true);
  const [wakeState, setWakeState] = useState<
    "off" | "on" | "busy" | "released" | "unavailable"
  >("off");

  useEffect(() => {
    if (active?.servings !== undefined) setServings(active.servings);
  }, [active?.servings]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      const lock = wakeLock.current;
      wakeLock.current = null;
      if (lock) void lock.release().catch(() => undefined);
    };
  }, []);
  useEffect(() => {
    if (hasActiveCook) return;
    // A cook can finish or be replaced in another tab while this route stays
    // mounted. Release its lock, including any request that resolves later.
    wakeLockScope.current += 1;
    const lock = wakeLock.current;
    wakeLock.current = null;
    if (lock) void lock.release().catch(() => undefined);
    setWakeState("off");
  }, [hasActiveCook]);

  if (!recipe)
    return (
      <Empty
        title="Recipe not found"
        action={
          <a className="button" href="#/explore">
            Explore recipes
          </a>
        }
      >
        This recipe may be saved on another device.
      </Empty>
    );

  const firstIncomplete = recipe.steps.findIndex(
    (_, index) => !active?.checkedSteps.includes(index),
  );
  const currentStep = Math.min(
    selectedStep ??
      (firstIncomplete >= 0 ? firstIncomplete : recipe.steps.length - 1),
    recipe.steps.length - 1,
  );
  const completedCount = recipe.steps.filter((_, index) =>
    active?.checkedSteps.includes(index),
  ).length;
  const currentComplete = active?.checkedSteps.includes(currentStep) ?? false;
  const scaled = scaleIngredients(recipe, servings);
  const otherRecipe = recipes.find(
    (item) => item.id === data.activeCooking?.recipeId,
  );

  async function start(expectedId: string | null) {
    if (!recipe || submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setStartError("");
    let failure = "";
    try {
      const okay = await run(async () => {
        try {
          await actions.startCooking(recipe.id, servings, expectedId);
        } catch (error) {
          failure =
            error instanceof Error
              ? error.message.slice(0, 350)
              : "Could not start cooking. Please try again.";
          throw error;
        }
      });
      if (okay) {
        setReplacement(null);
        setSelectedStep(null);
      } else
        setStartError(failure || "Could not start cooking. Please try again.");
    } catch (error) {
      setStartError(
        error instanceof Error
          ? error.message.slice(0, 350)
          : "Could not start cooking. Please try again.",
      );
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  async function setPortions(value: number) {
    if (
      !recipe ||
      savingServings.current ||
      !Number.isFinite(value) ||
      value < 0.5 ||
      value > 100
    )
      return;
    setServingsDraft(null);
    if (!active) {
      setServings(value);
      return;
    }
    savingServings.current = true;
    setBusy(true);
    const save = (async () => {
      try {
        const okay = await run(() =>
          actions.patchActiveCooking(
            recipe.id,
            { servings: value },
            servings,
            recipe.id,
          ),
        );
        if (okay) setServings(value);
      } finally {
        savingServings.current = false;
        setBusy(false);
      }
    })();
    servingsSave.current = save;
    await save;
  }

  function commitServingsDraft() {
    if (servingsDraft === null) return;
    const value = Number(servingsDraft);
    if (servingsDraft.trim() === "" || value === servings) {
      setServingsDraft(null);
      return;
    }
    // Invalid or out-of-range input reverts to the saved portions.
    if (value < 0.5 || value > 100) {
      setServingsDraft(null);
      return;
    }
    void setPortions(value);
  }

  function showStep(index: number) {
    setSelectedStep(index);
    // Focus carries the newly selected step to keyboard and screen-reader users.
    window.requestAnimationFrame(() =>
      stepHeading.current?.focus({ preventScroll: true }),
    );
  }

  async function toggleCurrentStep() {
    if (!recipe || !active || togglingStep.current) return;
    togglingStep.current = true;
    setBusy(true);
    try {
      await servingsSave.current;
      const okay = await run(() =>
        actions.setCookingCheck(
          recipe.id,
          "step",
          currentStep,
          !currentComplete,
          servings,
          recipe.id,
        ),
      );
      if (okay) {
        const next = recipe.steps.findIndex(
          (_, index) =>
            index > currentStep && !active.checkedSteps.includes(index),
        );
        showStep(!currentComplete && next >= 0 ? next : currentStep);
      }
    } finally {
      togglingStep.current = false;
      setBusy(false);
    }
  }

  async function toggleWakeLock() {
    if (!("wakeLock" in navigator) || changingWakeLock.current) return;
    changingWakeLock.current = true;
    const scope = wakeLockScope.current;
    setWakeState("busy");
    try {
      if (wakeLock.current) {
        await wakeLock.current.release();
        wakeLock.current = null;
        if (mounted.current) setWakeState("off");
      } else {
        const lock = await navigator.wakeLock.request("screen");
        if (!mounted.current || scope !== wakeLockScope.current) {
          await lock.release();
          return;
        }
        wakeLock.current = lock;
        setWakeState("on");
        lock.addEventListener(
          "release",
          () => {
            if (wakeLock.current === lock) {
              wakeLock.current = null;
              if (mounted.current) setWakeState("released");
            }
          },
          { once: true },
        );
      }
    } catch {
      wakeLock.current = null;
      if (mounted.current) setWakeState("unavailable");
    } finally {
      changingWakeLock.current = false;
    }
  }

  return (
    <div className="cook-mode">
      <div className="cook-topline">
        <a className="back-link" href={`#/recipe/${recipe.slug}`}>
          <ArrowLeft size={17} /> Back to recipe
        </a>
        <span className="cook-eyebrow">
          <ChefHat size={17} /> Cook mode
        </span>
      </div>
      <header className="cook-heading">
        <div>
          <span className="cook-eyebrow">One step at a time</span>
          <h1>{recipe.title}</h1>
        </div>
        <div className="cook-portions">
          <span>Servings</span>
          <div className="cook-portion-controls">
            {/* aria-disabled keeps focus on the control while a save runs. */}
            <button
              type="button"
              aria-label="Fewer servings"
              aria-disabled={busy || servings <= 0.5 || undefined}
              onClick={() => void setPortions(servings - 0.5)}
            >
              <Minus size={18} />
            </button>
            <input
              aria-label="Servings"
              type="number"
              inputMode="decimal"
              step="0.5"
              min="0.5"
              max="100"
              value={servingsDraft ?? servings}
              onChange={(event) => setServingsDraft(event.target.value)}
              onBlur={commitServingsDraft}
              onKeyDown={(event) => {
                if (event.key === "Enter") commitServingsDraft();
              }}
            />
            <button
              type="button"
              aria-label="More servings"
              aria-disabled={busy || servings >= 100 || undefined}
              onClick={() => void setPortions(servings + 0.5)}
            >
              <Plus size={18} />
            </button>
          </div>
        </div>
      </header>

      <section
        className="cook-temperature-strip"
        aria-label="Cooking temperatures"
      >
        <div>
          <Flame size={22} />
          <span>
            Air-fryer setting<strong>{recipe.temperatureC}°C</strong>
          </span>
        </div>
        <div>
          <Thermometer size={22} />
          <span>
            Food core target
            <strong>
              {recipe.internalTempC !== null
                ? `${recipe.internalTempC}°C`
                : "See safety notes"}
            </strong>
          </span>
        </div>
        <a
          href="#cook-safety"
          onClick={(event) => {
            event.preventDefault();
            const details = document.getElementById(
              "cook-safety",
            ) as HTMLDetailsElement | null;
            if (details) {
              details.open = true;
              details.scrollIntoView({ behavior: "auto", block: "start" });
              details.querySelector("summary")?.focus();
            }
          }}
        >
          <ShieldCheck size={18} /> Safety notes
        </a>
      </section>

      {!active ? (
        <section className="cook-start-panel">
          <span className="cook-start-icon">
            <ChefHat size={34} strokeWidth={1.4} />
          </span>
          <div>
            <h2>Ready when you are.</h2>
            <p>
              Set out your ingredients, check the equipment and make room in the
              basket. Your checklist, portions and timer will be remembered.
            </p>
            {data.activeCooking && (
              <p className="cook-existing-note">
                You have a cook in progress:{" "}
                <strong>{otherRecipe?.title ?? "another recipe"}</strong>. Its
                progress is kept until you choose to replace it.
              </p>
            )}
            <div className="cook-start-actions">
              <button
                className="button primary"
                disabled={busy}
                onClick={() => {
                  setStartError("");
                  if (data.activeCooking)
                    setReplacement({
                      id: data.activeCooking.recipeId,
                      title: otherRecipe?.title ?? "your other recipe",
                    });
                  else void start(null);
                }}
              >
                <ChefHat size={19} /> {busy ? "Starting…" : "Begin cooking"}
              </button>
              {data.activeCooking && otherRecipe && (
                <button
                  className="button"
                  onClick={() => navigate(`/cook/${otherRecipe.slug}`)}
                >
                  Continue other recipe
                </button>
              )}
            </div>
            {startError && !replacement && (
              <p className="field-error" role="alert">
                {startError}
              </p>
            )}
          </div>
        </section>
      ) : (
        <div className="cook-workspace">
          <section
            className="cook-step-panel"
            aria-label="Current cooking step"
          >
            <div className="cook-step-meta">
              <span className="cook-eyebrow">
                Step {currentStep + 1} of {recipe.steps.length}
              </span>
              <span>
                {completedCount} of {recipe.steps.length} complete
              </span>
            </div>
            <progress
              aria-label="Cooking steps completed"
              max={recipe.steps.length}
              value={completedCount}
            />
            <div className="cook-step-copy">
              <span className="cook-step-numeral" aria-hidden="true">
                {String(currentStep + 1).padStart(2, "0")}
              </span>
              <div>
                <h2 ref={stepHeading} tabIndex={-1}>
                  Step {currentStep + 1}
                  {currentComplete && (
                    <span className="cook-done-label">
                      <Check size={16} /> Done
                    </span>
                  )}
                </h2>
                <p>{recipe.steps[currentStep]}</p>
              </div>
            </div>
            <button
              type="button"
              className={`button cook-complete-button ${currentComplete ? "selected" : "primary"}`}
              aria-disabled={busy || undefined}
              onClick={() => void toggleCurrentStep()}
            >
              <Check size={20} />
              {currentComplete ? "Mark step as unfinished" : "Done, next step"}
            </button>
            <nav className="cook-step-navigation" aria-label="Cooking steps">
              <button
                type="button"
                className="button"
                disabled={currentStep === 0 || busy}
                onClick={() => showStep(currentStep - 1)}
              >
                <ArrowLeft size={18} /> Previous
              </button>
              <span>
                {currentStep + 1} / {recipe.steps.length}
              </span>
              <button
                type="button"
                className="button"
                disabled={currentStep === recipe.steps.length - 1 || busy}
                onClick={() => showStep(currentStep + 1)}
              >
                Next <ArrowRight size={18} />
              </button>
            </nav>
            <p className="cook-progress-note">
              Progress saves automatically. Leave this page and pick up from
              your first unfinished step.
            </p>
          </section>
          <aside className="cook-tools">
            <CookingTimer recipe={recipe} servings={servings} />
            <div className="cook-batch-note">
              <ListChecks size={20} />
              <p>
                Cook in a single layer. Larger portions may need batches; the
                cooking time is per batch.
              </p>
            </div>
          </aside>
        </div>
      )}

      <div className="cook-reference-grid">
        <details className="cook-reference" open={!active}>
          <summary>
            <span>
              <ListChecks size={20} /> Ingredients{" "}
              <small>{formatQuantity(servings)} servings</small>
            </span>
            <ChevronDown size={18} />
          </summary>
          <div className="cook-reference-body">
            <p className="small muted">
              {recipe.portion.replace(/\.\s*$/, "")}. Check off ingredients as
              you prepare them.
            </p>
            <ul className="ingredient-list">
              {scaled.map((ingredient, index) => (
                <li key={index}>
                  <label>
                    {active ? (
                      <SavedCheckbox
                        label={`Prepared ${ingredient.name}`}
                        checked={active.checkedIngredients.includes(index)}
                        onCheckedChange={(checked) =>
                          run(() =>
                            actions.setCookingCheck(
                              recipe.id,
                              "ingredient",
                              index,
                              checked,
                              servings,
                              recipe.id,
                            ),
                          )
                        }
                      />
                    ) : (
                      <span
                        className="cook-ingredient-dot"
                        aria-hidden="true"
                      />
                    )}
                    <span>
                      <strong>
                        {formatAmount(ingredient.quantity, ingredient.unit)}{" "}
                        {ingredient.unit === "each" ? "" : ingredient.unit}
                      </strong>{" "}
                      {ingredient.name}
                      <small>
                        {ingredientDetails(
                          ingredient.preparation,
                          ingredient.form,
                        )}
                      </small>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
            <p>
              <strong>Equipment:</strong> {recipe.equipment.join(", ")}
            </p>
          </div>
        </details>
        <details className="cook-reference" id="cook-safety">
          <summary>
            <span>
              <ShieldCheck size={20} /> Safety & setup
            </span>
            <ChevronDown size={18} />
          </summary>
          <div className="cook-reference-body">
            {recipe.internalTempC !== null && (
              <p>
                <strong>Food core target: {recipe.internalTempC}°C.</strong>{" "}
                Check with a clean food thermometer. This is different from the
                air-fryer setting.
              </p>
            )}
            <p>
              {recipe.preheat
                ? `Preheat for ${recipe.preheatMinutes} minutes at ${recipe.temperatureC}°C.`
                : "No preheating required unless your appliance instructions specify it."}
            </p>
            <p>{recipe.turn}</p>
            {recipe.safety.map((note, index) => (
              <p key={index}>{note}</p>
            ))}
            <p>
              Never preheat with loose baking paper. Check appliance and
              accessory instructions, keep vents clear and avoid overcrowding.
            </p>
            <p>
              <strong>Allergens:</strong>{" "}
              {recipe.allergens.length
                ? recipe.allergens.join(", ")
                : "No listed major allergens; check every package."}
            </p>
          </div>
        </details>
      </div>

      {active && (
        <details className="cook-reference cook-all-steps">
          <summary>
            <span>
              <ListChecks size={20} /> All steps{" "}
              <small>{recipe.steps.length} in total</small>
            </span>
            <ChevronDown size={18} />
          </summary>
          <ol>
            {recipe.steps.map((step, index) => (
              <li key={index}>
                <button
                  type="button"
                  aria-current={index === currentStep ? "step" : undefined}
                  onClick={() => {
                    showStep(index);
                    stepHeading.current?.scrollIntoView({
                      behavior: "auto",
                      block: "center",
                    });
                  }}
                >
                  <span
                    className={
                      active.checkedSteps.includes(index)
                        ? "cook-step-dot is-complete"
                        : "cook-step-dot"
                    }
                  >
                    {active.checkedSteps.includes(index) ? (
                      <Check size={17} />
                    ) : (
                      index + 1
                    )}
                  </span>
                  <span>{step}</span>
                  <ArrowRight size={17} />
                </button>
              </li>
            ))}
          </ol>
        </details>
      )}

      {active && (
        <footer className="cook-footer">
          <div className="cook-wake-lock">
            {"wakeLock" in navigator && (
              <button
                type="button"
                className="text-button"
                aria-pressed={wakeState === "on"}
                aria-disabled={wakeState === "busy" || undefined}
                onClick={() => void toggleWakeLock()}
              >
                <Monitor size={18} /> Keep screen awake
                {/* aria-pressed carries the state; the pill is a visual cue only. */}
                <span className="cook-wake-state" aria-hidden="true">
                  {wakeState === "on" && <Check size={14} />}
                  {wakeState === "on" ? "On" : "Off"}
                </span>
              </button>
            )}
            <p role="status">
              {wakeState === "released"
                ? "Screen lock released. Tap again to keep it awake."
                : wakeState === "unavailable"
                  ? "Your device couldn’t keep the screen awake. Cooking progress is still saved."
                  : wakeState === "on"
                    ? "While this page is visible. Turn it off at any time."
                    : ""}
            </p>
          </div>
          <div className="cook-finish">
            <p>
              {completedCount === recipe.steps.length
                ? "All steps checked. Ready to save your cooking notes?"
                : "Finished your cook? Record what you actually prepared."}
            </p>
            <button
              className="button primary"
              disabled={busy}
              onClick={() => setFinish(true)}
            >
              <Check size={19} /> Finish & save
            </button>
          </div>
        </footer>
      )}

      {replacement && (
        <Modal
          title="Start a different recipe?"
          onClose={() => setReplacement(null)}
        >
          <p>
            Your checklist and timer for <strong>{replacement.title}</strong>{" "}
            will be replaced. Your saved cooking journal will stay.
          </p>
          <p>
            Only replace this cook if you are ready to stop using its checklist
            and timer.
          </p>
          {startError && (
            <div className="field-error" role="alert">
              <p>{startError}</p>
              <p>
                Close this dialog to review the current cook before trying
                again.
              </p>
            </div>
          )}
          <div className="cook-dialog-actions">
            <button
              className="button"
              disabled={busy}
              onClick={() => setReplacement(null)}
            >
              Keep current cook
            </button>
            <button
              className="button primary"
              disabled={busy}
              onClick={() => void start(replacement.id)}
            >
              {busy ? "Starting…" : "Replace & begin"}
            </button>
          </div>
        </Modal>
      )}
      {finish && (
        <Modal title="How did your cook go?" onClose={() => setFinish(false)}>
          <p className="small muted">
            Save what you prepared and ate. Saving marks this recipe as tried
            and clears its active checklist and timer; it does not verify food
            safety.
          </p>
          <SessionForm
            recipe={recipe}
            completeCooking
            initialServings={servings}
            onDone={() => {
              setFinish(false);
              navigate(`/recipe/${recipe.slug}`);
            }}
          />
        </Modal>
      )}
    </div>
  );
}
