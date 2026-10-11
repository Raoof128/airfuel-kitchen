import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Recipe, CookingSession } from "../lib/schema";
import { actions, localDate } from "../lib";
import { useApp } from "./context";
type FieldErrors = Partial<Record<SessionField, string>>;
type SessionField = "date" | "prepared" | "consumed" | "actual" | "temp";
// Same bounds as the inputs. The form uses noValidate so each message sits
// next to its field instead of in the browser's bubble.
const numberBounds: Record<
  Exclude<SessionField, "date">,
  [min: number, max: number, unit: string]
> = {
  prepared: [0.5, 100, "servings"],
  consumed: [0, 100, "servings"],
  actual: [0, 1440, "minutes"],
  temp: [40, 260, "°C"],
};
function validate(form: FormData): FieldErrors {
  const errors: FieldErrors = {};
  if (!String(form.get("date") ?? "").trim())
    errors.date = "Choose the date you cooked.";
  for (const name of Object.keys(numberBounds) as Exclude<
    SessionField,
    "date"
  >[]) {
    const value = String(form.get(name) ?? "").trim();
    // Actual minutes and air-fryer setting are optional.
    if (!value && (name === "actual" || name === "temp")) continue;
    const [min, max, unit] = numberBounds[name];
    const number = Number(value);
    if (!value || Number.isNaN(number)) {
      errors[name] =
        name === "prepared"
          ? "Enter the servings you prepared."
          : name === "consumed"
            ? "Enter the servings you ate. Use 0 if you didn’t eat any."
            : `Enter a number from ${min} to ${max}.`;
      continue;
    }
    if (number < min || number > max)
      errors[name] = `Enter a number from ${min} to ${max}${unit === "°C" ? "°C" : ` ${unit}`}.`;
    else if ((name === "prepared" || name === "consumed") && (number * 2) % 1 !== 0)
      errors[name] = "Use whole servings or halves, like 1.5.";
  }
  return errors;
}
// Label and its message are siblings, so the message does not join the
// field's accessible name.
function SessionField({
  name,
  errors,
  children,
}: {
  name: SessionField;
  errors: FieldErrors;
  children: ReactNode;
}) {
  return (
    <div className="session-field">
      {children}
      {errors[name] && (
        <p id={`session-${name}-error`} className="session-field-error">
          {errors[name]}
        </p>
      )}
    </div>
  );
}
function describedBy(name: SessionField, errors: FieldErrors, hint?: string) {
  const ids = [hint, errors[name] ? `session-${name}-error` : undefined]
    .filter(Boolean)
    .join(" ");
  return {
    "aria-invalid": errors[name] ? true : undefined,
    "aria-describedby": ids || undefined,
  } as const;
}
export function SessionForm({
  recipe,
  session,
  completeCooking = false,
  initialServings,
  showRecipeTitle = true,
  onDone,
}: {
  recipe: Recipe;
  session?: CookingSession;
  completeCooking?: boolean;
  initialServings?: number;
  showRecipeTitle?: boolean;
  onDone: () => void;
}) {
  const { data, run } = useApp();
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const formRef = useRef<HTMLFormElement>(null);
  const focusFirstError = useRef(false);
  const submitting = useRef(false);
  useEffect(() => {
    if (!focusFirstError.current) return;
    focusFirstError.current = false;
    formRef.current
      ?.querySelector<HTMLElement>('[aria-invalid="true"]')
      ?.focus();
  });
  return (
    <form
      ref={formRef}
      className="stack-form session-form"
      aria-label={`Cooking session for ${recipe.title}`}
      noValidate
      onChange={(e) => {
        const name = (e.target as HTMLElement).getAttribute("name") as
          | SessionField
          | null;
        if (name && fieldErrors[name])
          setFieldErrors((current) => {
            const next = { ...current };
            delete next[name];
            return next;
          });
      }}
      onSubmit={async (e) => {
        e.preventDefault();
        if (submitting.current) return;
        const form = new FormData(e.currentTarget);
        const errors = validate(form);
        if (Object.keys(errors).length) {
          setFieldErrors(errors);
          setSaveError("");
          focusFirstError.current = true;
          return;
        }
        setFieldErrors({});
        submitting.current = true;
        setBusy(true);
        setSaveError("");
        let failure = "";
        try {
          const okay = await run(
            async () => {
              try {
                await actions.saveCookingSession(
                  {
                    id: session?.id,
                    recipeId: recipe.id,
                    date: String(form.get("date")),
                    servingsPrepared: Number(form.get("prepared")),
                    servingsConsumed: Number(form.get("consumed")),
                    rating: form.get("rating")
                      ? Number(form.get("rating"))
                      : null,
                    actualMinutes: form.get("actual")
                      ? Number(form.get("actual"))
                      : null,
                    ingredientChanges: String(form.get("changes") || ""),
                    temperatureC: form.get("temp")
                      ? Number(form.get("temp"))
                      : null,
                    timeChanges: String(form.get("timeChanges") || ""),
                    notes: String(form.get("notes") || ""),
                    wouldCookAgain:
                      form.get("again") === "yes"
                        ? true
                        : form.get("again") === "no"
                          ? false
                          : null,
                  },
                  completeCooking,
                );
              } catch (error) {
                failure =
                  error instanceof Error
                    ? error.message.slice(0, 350)
                    : "Could not save this cooking session. Please try again.";
                throw error;
              }
            },
            session ? "Cooking session updated" : "Cooking memory saved",
          );
          if (okay) onDone();
          else
            setSaveError(
              failure ||
                "Could not save this cooking session. Please try again.",
            );
        } catch (error) {
          setSaveError(
            error instanceof Error
              ? error.message.slice(0, 350)
              : "Could not save this cooking session. Please try again.",
          );
        } finally {
          setBusy(false);
          submitting.current = false;
        }
      }}
    >
      {showRecipeTitle && <p className="muted">{recipe.title}</p>}
      <div className="form-grid">
        <SessionField name="date" errors={fieldErrors}>
          <label>
            Date cooked
            <input
              required
              type="date"
              name="date"
              {...describedBy("date", fieldErrors)}
              defaultValue={
                session?.date ||
                localDate(new Date(), data.preferences.timezone)
              }
            />
          </label>
        </SessionField>
        <label>
          Rating
          <select
            name="rating"
            aria-label="Rating"
            defaultValue={session?.rating || ""}
          >
            <option value="">Not rated</option>
            {[5, 4, 3, 2, 1].map((n) => (
              <option key={n} value={n}>
                {n} / 5
              </option>
            ))}
          </select>
        </label>
        <SessionField name="prepared" errors={fieldErrors}>
          <label>
            Servings prepared
            <input
              name="prepared"
              type="number"
              step="0.5"
              min="0.5"
              max="100"
              required
              {...describedBy("prepared", fieldErrors)}
              defaultValue={
                session?.servingsPrepared ??
                initialServings ??
                data.preferences.defaultServings
              }
            />
          </label>
        </SessionField>
        <SessionField name="consumed" errors={fieldErrors}>
          <label>
            Servings you ate
            <input
              name="consumed"
              type="number"
              step="0.5"
              min="0"
              max="100"
              required
              {...describedBy(
                "consumed",
                fieldErrors,
                "session-consumed-hint",
              )}
              defaultValue={session?.servingsConsumed ?? 0}
            />
            <small id="session-consumed-hint">
              Only these count towards your logged protein.
            </small>
          </label>
        </SessionField>
        <SessionField name="actual" errors={fieldErrors}>
          <label>
            Actual total minutes
            <input
              name="actual"
              type="number"
              min="0"
              max="1440"
              {...describedBy("actual", fieldErrors)}
              defaultValue={session?.actualMinutes ?? ""}
            />
          </label>
        </SessionField>
        <SessionField name="temp" errors={fieldErrors}>
          <label>
            Actual air-fryer setting (°C)
            <input
              name="temp"
              type="number"
              min="40"
              max="260"
              {...describedBy("temp", fieldErrors)}
              defaultValue={session?.temperatureC ?? recipe.temperatureC}
            />
          </label>
        </SessionField>
      </div>
      <label>
        Ingredient changes
        <input
          name="changes"
          maxLength={2000}
          placeholder="e.g. Added paprika; used Greek yoghurt"
          defaultValue={session?.ingredientChanges || ""}
        />
      </label>
      <label>
        Timing changes
        <input
          name="timeChanges"
          maxLength={2000}
          placeholder="e.g. Two minutes less next time"
          defaultValue={session?.timeChanges || ""}
        />
      </label>
      <label>
        Cooking notes
        <textarea
          name="notes"
          aria-label="Cooking notes"
          maxLength={10000}
          rows={3}
          placeholder="What worked? What would you change?"
          defaultValue={session?.notes || ""}
        />
      </label>
      <label>
        Would you cook it again?
        <select
          name="again"
          defaultValue={
            session?.wouldCookAgain === true
              ? "yes"
              : session?.wouldCookAgain === false
                ? "no"
                : ""
          }
        >
          <option value="">Not sure yet</option>
          <option value="yes">Yes, definitely</option>
          <option value="no">Probably not</option>
        </select>
      </label>
      <p className="small muted">
        Nutrition uses the original recipe estimate. Ingredient changes aren’t
        included in your logged macros.
      </p>
      {saveError && (
        <div className="field-error" role="alert">
          <p>{saveError}</p>
          <p>Your entries are still here. Review them and try saving again.</p>
        </div>
      )}
      <button className="button primary" disabled={busy}>
        {busy ? "Saving…" : "Save cooking session"}
      </button>
    </form>
  );
}
