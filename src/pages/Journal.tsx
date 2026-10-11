import { useState } from "react";
import { Plus, Pencil, Trash2, Star } from "lucide-react";
import { actions, consumedNutrition } from "../lib";
import type { CookingSession } from "../lib/schema";
import { useApp, readableDate } from "../components/context";
import { Empty, Modal, PageHeading } from "../components/UI";
import { SessionForm } from "../components/SessionForm";
export function Journal() {
  const { data, recipes, run } = useApp();
  const [session, setSession] = useState<CookingSession | null>(null);
  const [adding, setAdding] = useState(false);
  const [recipeId, setRecipeId] = useState("");
  const [recipeSearch, setRecipeSearch] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);
  const sessions = [...data.sessions].sort(
    (a, b) => b.date.localeCompare(a.date) || b.updatedAt - a.updatedAt,
  );
  const totals = consumedNutrition(sessions, recipes);
  const recipe = recipes.find((r) => r.id === (session?.recipeId || recipeId));
  const searchWords = recipeSearch
    .toLocaleLowerCase("en-AU")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const matchingRecipes = recipes
    .filter((item) => {
      const searchable =
        `${item.title} ${item.tags.join(" ")} ${item.ingredients.map((ingredient) => ingredient.name).join(" ")}`.toLocaleLowerCase(
          "en-AU",
        );
      return searchWords.every((word) => searchable.includes(word));
    })
    .sort((a, b) => a.title.localeCompare(b.title, "en-AU"));
  const selectedOutsideSearch =
    recipe && !matchingRecipes.some((item) => item.id === recipe.id);
  return (
    <>
      <PageHeading
        title="Every meal has a memory"
        description="The keepers, the little tweaks, the things you’ll cook again."
        action={
          <button
            className="button primary"
            onClick={() => {
              setAdding(true);
              setRecipeId(recipes[0]?.id || "");
              setRecipeSearch("");
            }}
          >
            <Plus size={17} />
            Log a cook
          </button>
        }
      />
      <div className="journal-summary">
        <div>
          <strong>{sessions.length}</strong>
          <span>cooking memories</span>
        </div>
        <div>
          <strong>{Math.round(totals.protein)}g</strong>
          <span>protein explicitly logged as eaten</span>
        </div>
        <div>
          <strong>{new Set(sessions.map((s) => s.recipeId)).size}</strong>
          <span>different recipes cooked</span>
        </div>
      </div>
      {sessions.length ? (
        <div className="journal-list">
          {sessions.map((s) => {
            const r = recipes.find((r) => r.id === s.recipeId);
            return (
              <article key={s.id} className="journal-entry">
                <div className="journal-date">
                  <strong>
                    {new Date(`${s.date}T12:00:00Z`).toLocaleDateString(
                      "en-AU",
                      { day: "numeric", timeZone: "UTC" },
                    )}
                  </strong>
                  <span>
                    {new Date(`${s.date}T12:00:00Z`).toLocaleDateString(
                      "en-AU",
                      { month: "short", year: "numeric", timeZone: "UTC" },
                    )}
                  </span>
                </div>
                <div className="journal-content">
                  <h2>
                    <a href={`#/recipe/${s.recipeId}`}>
                      {r?.title || "Recipe unavailable on this device"}
                    </a>
                  </h2>
                  <div className="recipe-meta">
                    {s.rating && (
                      <span>
                        <Star size={15} />
                        {s.rating}/5
                      </span>
                    )}
                    <span>
                      {s.servingsPrepared} prepared · {s.servingsConsumed} eaten
                    </span>
                    {s.actualMinutes !== null && (
                      <span>{s.actualMinutes} minutes</span>
                    )}
                  </div>
                  {!r && (
                    <p className="small muted">
                      Recipe not on this device. Import a backup to edit this
                      memory. You can still delete it.
                    </p>
                  )}
                  {s.notes && <p>{s.notes}</p>}
                  {s.ingredientChanges && (
                    <p>
                      <strong>Ingredient changes:</strong> {s.ingredientChanges}
                    </p>
                  )}
                  {s.timeChanges && (
                    <p>
                      <strong>Timing:</strong> {s.timeChanges}
                    </p>
                  )}
                  {s.temperatureC && (
                    <span className="muted small">
                      {s.temperatureC}°C air-fryer setting ·{" "}
                    </span>
                  )}
                  <span className="muted small">
                    {s.wouldCookAgain === true
                      ? "Would cook again"
                      : s.wouldCookAgain === false
                        ? "Not one to repeat"
                        : "No repeat preference saved"}
                  </span>
                  {r && (
                    <p className="journal-again">
                      <a
                        className="button"
                        href={`#/cook/${r.slug}`}
                        aria-label={`Cook again: ${r.title}`}
                      >
                        Cook again
                      </a>
                    </p>
                  )}
                </div>
                <div className="journal-actions">
                  {r && (
                    <button
                      className="icon-button"
                      aria-label={`Edit cooking session from ${readableDate(s.date)}`}
                      onClick={() => setSession(s)}
                    >
                      <Pencil size={17} />
                    </button>
                  )}
                  <button
                    className="icon-button"
                    aria-label={`Delete cooking session from ${readableDate(s.date)}`}
                    onClick={() => setDeleting(s.id)}
                  >
                    <Trash2 size={17} />
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <Empty title="Your story starts with dinner">
          After cooking, log a session with your rating and notes. Marking a
          recipe tried alone won’t log a meal.
          <a className="button" href="#/explore">
            Find something delicious
          </a>
        </Empty>
      )}
      {(session || adding) && (
        <Modal
          title={session ? "Edit cooking memory" : "Log a cooking memory"}
          onClose={() => {
            setSession(null);
            setAdding(false);
          }}
        >
          {!session && (
            <div>
              <label className="recipe-select">
                Find a recipe
                <input
                  type="search"
                  placeholder="Search by name or ingredient"
                  value={recipeSearch}
                  onChange={(event) => setRecipeSearch(event.target.value)}
                  aria-describedby="journal-recipe-matches"
                />
              </label>
              <p
                id="journal-recipe-matches"
                className="small muted"
                role="status"
              >
                {matchingRecipes.length
                  ? `${matchingRecipes.length} ${matchingRecipes.length === 1 ? "recipe" : "recipes"} found. Choose a recipe below.`
                  : "No recipes match. Try another name or ingredient."}
                {selectedOutsideSearch
                  ? " Your selected recipe and draft are kept until you choose another."
                  : ""}
              </p>
              <label className="recipe-select">
                Recipe
                <select
                  value={recipeId}
                  onChange={(e) => setRecipeId(e.target.value)}
                >
                  {selectedOutsideSearch && (
                    <optgroup label="Selected recipe">
                      <option value={recipe.id}>{recipe.title}</option>
                    </optgroup>
                  )}
                  {matchingRecipes.map((r) => (
                    <option value={r.id} key={r.id}>
                      {r.title}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}
          {recipe && (
            <SessionForm
              key={recipe.id}
              recipe={recipe}
              session={session || undefined}
              showRecipeTitle={Boolean(session)}
              onDone={() => {
                setSession(null);
                setAdding(false);
              }}
            />
          )}
        </Modal>
      )}
      {deleting && (
        <Modal
          title="Delete this cooking memory?"
          onClose={() => setDeleting(null)}
        >
          <p>
            This removes the session and its logged nutrition. The recipe’s
            separate tried flag, rating and notes stay as they are.
          </p>
          <div className="dialog-actions">
            <button className="button" onClick={() => setDeleting(null)}>
              Keep memory
            </button>
            <button
              className="button danger"
              onClick={async () => {
                if (
                  await run(
                    () => actions.deleteSession(deleting),
                    "Cooking memory deleted",
                  )
                )
                  setDeleting(null);
              }}
            >
              Delete memory
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
