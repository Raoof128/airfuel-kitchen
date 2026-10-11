import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { Search, SlidersHorizontal, Shuffle, Plus, X } from "lucide-react";
import { useApp } from "../components/context";
import { Empty, PageHeading, RecipeGrid } from "../components/UI";
import { filterRecipes, recommendRecipes } from "../lib";
import { allergenNames } from "../lib/schema";
import { catalogue, categoryLabels } from "../data/catalogue";
import { rememberExplore } from "../lib/navigation";
export function Explorer({
  query,
  favourites = false,
}: {
  query: string;
  favourites?: boolean;
}) {
  const { data, recipes, navigate } = useApp();
  const params = new URLSearchParams(query);
  const [search, setSearch] = useState(params.get("q") || "");
  // A hand-edited or stale link must not produce a hidden filter with no chip to clear.
  const [category, setCategory] = useState(() => {
    const value = params.get("category") || "";
    return value in categoryLabels ? value : "";
  });
  const [protein, setProtein] = useState(params.get("protein") || "");
  const [time, setTime] = useState(params.get("time") || "");
  const [calories, setCalories] = useState(params.get("calories") || "");
  const [dietary, setDietary] = useState(params.get("dietary") || "");
  const [allergens, setAllergens] = useState<string[]>(
    params
      .getAll("allergen")
      .filter((a) =>
        allergenNames.includes(a as (typeof allergenNames)[number]),
      ),
  );
  const [difficulty, setDifficulty] = useState(params.get("difficulty") || "");
  const [oilFree, setOilFree] = useState(params.get("oilFree") === "true");
  const [status, setStatus] = useState<
    "all" | "tried" | "untried" | "favourites"
  >(
    favourites
      ? "favourites"
      : (["tried", "untried", "favourites"] as const).find(
          (value) => value === params.get("status"),
        ) || "all",
  );
  const [sort, setSort] = useState<"relevance" | "time" | "protein" | "rating">(
    (["relevance", "time", "protein", "rating"] as const).find(
      (value) => value === params.get("sort"),
    ) || (params.get("q") ? "relevance" : "protein"),
  );
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [limit, setLimit] = useState(24);
  const resultsHeading = useRef<HTMLDivElement>(null);
  const previousCount = useRef<number | null>(null);
  useEffect(() => {
    const next = new URLSearchParams();
    Object.entries({
      q: search.trim(),
      category,
      protein,
      time,
      calories,
      dietary,
      difficulty,
      oilFree: oilFree ? "true" : "",
      status: status === "all" ? "" : status,
      sort,
    }).forEach(([key, value]) => {
      if (value) next.set(key, value);
    });
    allergens.forEach((allergen) => next.append("allergen", allergen));
    const hash = `#/${favourites ? "favourites" : "explore"}${next.size ? `?${next}` : ""}`;
    // Replace the current browsing entry without remounting the focused input.
    window.history.replaceState(window.history.state, "", hash);
    rememberExplore(hash);
  }, [
    search,
    category,
    protein,
    time,
    calories,
    dietary,
    difficulty,
    oilFree,
    status,
    sort,
    allergens,
    favourites,
  ]);
  // Typing stays responsive: the input updates at once, the list catches up.
  const deferredSearch = useDeferredValue(search);
  const results = useMemo(
    () =>
      filterRecipes(
        recipes,
        {
          query: deferredSearch,
          category: category || undefined,
          minProtein: protein ? Number(protein) : undefined,
          maxMinutes: time ? Number(time) : undefined,
          maxCalories: calories ? Number(calories) : undefined,
          dietary: [...data.preferences.dietary, ...(dietary ? [dietary] : [])],
          excludeAllergens: [...data.preferences.allergens, ...allergens],
          difficulty: difficulty || undefined,
          oilFree,
          status,
          sort,
        },
        data.recipeStates,
      ),
    [
      recipes,
      deferredSearch,
      category,
      protein,
      time,
      calories,
      dietary,
      difficulty,
      oilFree,
      status,
      sort,
      allergens,
      data.preferences.dietary,
      data.preferences.allergens,
      data.recipeStates,
    ],
  );
  // Removing a favourite on the favourites view unmounts the card that had focus.
  // Move focus to the results heading so keyboard users are not dropped to the top.
  useEffect(() => {
    const before = previousCount.current;
    previousCount.current = results.length;
    if (
      favourites &&
      before !== null &&
      results.length < before &&
      (!document.activeElement || document.activeElement === document.body)
    )
      resultsHeading.current?.focus();
  }, [results.length, favourites]);
  function reset() {
    setSearch("");
    setCategory("");
    setProtein("");
    setTime("");
    setCalories("");
    setDietary("");
    setAllergens([]);
    setDifficulty("");
    setOilFree(false);
    setStatus(favourites ? "favourites" : "all");
    setSort("protein");
  }
  // On the favourites view the collection is fixed, so it is not a filter the user chose.
  const collectionFiltered = !favourites && status !== "all";
  const activeFilters = [
    category,
    protein,
    time,
    calories,
    dietary,
    difficulty,
    oilFree,
    collectionFiltered,
    ...allergens,
  ].filter(Boolean).length;
  return (
    <>
      <PageHeading
        title={favourites ? "Your favourites" : "Explore the kitchen"}
        description={
          favourites
            ? "Recipes you have saved with the heart, ready when you are."
            : `${catalogue.length} source-checked recipes${data.customRecipes.length ? ` + ${data.customRecipes.length} of your own` : ""}. Your next good meal starts here.`
        }
        action={
          <a className="button" href="#/custom">
            <Plus size={17} />
            Your own recipes
          </a>
        }
      />
      <div className="explore-toolbar">
        <div className="search-box">
          <Search size={20} />
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setLimit(24);
            }}
            placeholder="Try “chicken breast” or “under 20 minutes”"
            aria-label="Search catalogue"
          />
          {search && (
            <button
              className="icon-button"
              aria-label="Clear search"
              onClick={() => setSearch("")}
            >
              <X size={16} />
            </button>
          )}
        </div>
        <button
          className={`button ${filtersOpen ? "selected" : ""}`}
          aria-expanded={filtersOpen}
          aria-controls="recipe-filters"
          onClick={() => setFiltersOpen(!filtersOpen)}
        >
          <SlidersHorizontal size={18} />
          Filters{activeFilters > 0 ? ` (${activeFilters})` : ""}
        </button>
        <button
          className="button"
          aria-label="Surprise me"
          onClick={() => {
            const safe = recommendRecipes(
              results,
              data,
              "surprise",
              results.length,
            );
            if (safe.length)
              navigate(
                `/recipe/${safe[Math.floor(Math.random() * safe.length)].recipe.slug}`,
              );
          }}
          disabled={!results.length}
        >
          <Shuffle size={17} />
          <span className="hide-mobile">Surprise me</span>
        </button>
      </div>
      <div
        className="quick-filters"
        role="group"
        aria-label="Quick recipe filters"
      >
        <button
          className={`chip ${protein === "30" ? "selected" : ""}`}
          aria-pressed={protein === "30"}
          onClick={() => setProtein(protein === "30" ? "" : "30")}
        >
          30g+ protein
        </button>
        <button
          className={`chip ${time === "19" ? "selected" : ""}`}
          aria-pressed={time === "19"}
          onClick={() => setTime(time === "19" ? "" : "19")}
        >
          Under 20 minutes
        </button>
        <button
          className={`chip ${oilFree ? "selected" : ""}`}
          aria-pressed={oilFree}
          onClick={() => setOilFree(!oilFree)}
        >
          No added oil
        </button>
      </div>
      <label className="mobile-category-select">
        Recipe category
        <select
          value={category}
          onChange={(event) => {
            setCategory(event.target.value);
            setLimit(24);
          }}
        >
          <option value="">All recipes</option>
          {Object.entries(categoryLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <div className="category-tabs" role="group" aria-label="Recipe category">
        <button
          className={`chip ${!category ? "selected" : ""}`}
          aria-pressed={!category}
          onClick={() => setCategory("")}
        >
          All recipes
        </button>
        {Object.entries(categoryLabels).map(([value, label]) => (
          <button
            key={value}
            className={`chip ${category === value ? "selected" : ""}`}
            aria-pressed={category === value}
            onClick={() => {
              setCategory(value);
              setLimit(24);
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {activeFilters > 0 && (
        <div className="active-filters" aria-label="Active filters">
          {(
            [
              [
                category &&
                  (categoryLabels[category as keyof typeof categoryLabels] ||
                    category),
                () => setCategory(""),
              ],
              [protein && `${protein}g+ protein`, () => setProtein("")],
              [time && `Up to ${time} min`, () => setTime("")],
              [calories && `Up to ${calories} kcal`, () => setCalories("")],
              [dietary, () => setDietary("")],
              [difficulty, () => setDifficulty("")],
              [oilFree && "No added oil", () => setOilFree(false)],
              [
                collectionFiltered && status,
                () => setStatus("all"),
              ],
              ...allergens.map((a) => [
                `Without ${a}`,
                () => setAllergens(allergens.filter((v) => v !== a)),
              ]),
            ] as [string | false, () => void][]
          )
            .filter(([label]) => label)
            .map(([label, remove]) => (
              <button
                key={String(label)}
                className="filter-token"
                aria-label={`Remove filter: ${label}`}
                onClick={remove}
              >
                {label}
                <X size={14} />
              </button>
            ))}
          <button className="text-button" onClick={reset}>
            Clear all filters
          </button>
        </div>
      )}
      {filtersOpen && (
        <section
          id="recipe-filters"
          className="filter-panel"
          aria-label="Recipe filters"
        >
          <div className="form-grid">
            <label>
              Minimum protein (g)
              <input
                type="number"
                min="0"
                max="300"
                value={protein}
                onChange={(e) => setProtein(e.target.value)}
                placeholder="Any"
              />
            </label>
            <label>
              Maximum total time (min)
              <input
                type="number"
                min="1"
                max="1440"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                placeholder="Any"
              />
            </label>
            <label>
              Maximum calories (kcal)
              <input
                type="number"
                min="1"
                value={calories}
                onChange={(e) => setCalories(e.target.value)}
                placeholder="Any"
              />
            </label>
            <label>
              Dietary preference
              <select
                value={dietary}
                onChange={(e) => setDietary(e.target.value)}
              >
                <option value="">Any</option>
                {["vegetarian", "vegan", "gluten-free", "dairy-free"].map(
                  (d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ),
                )}
              </select>
            </label>
            <label>
              Difficulty
              <select
                value={difficulty}
                onChange={(e) => setDifficulty(e.target.value)}
              >
                <option value="">Any</option>
                <option>Easy</option>
                <option>Moderate</option>
              </select>
            </label>
            {!favourites && (
              <label>
                My collection
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as typeof status)}
                >
                  <option value="all">All recipes</option>
                  <option value="tried">Tried</option>
                  <option value="untried">Untried</option>
                  <option value="favourites">Favourites</option>
                </select>
              </label>
            )}
          </div>
          <fieldset>
            <legend>Exclude allergens</legend>
            <div className="checkbox-group">
              {allergenNames.map((a) => (
                <label key={a}>
                  <input
                    type="checkbox"
                    checked={
                      allergens.includes(a) ||
                      data.preferences.allergens.includes(a)
                    }
                    disabled={data.preferences.allergens.includes(a)}
                    onChange={(e) =>
                      setAllergens(
                        e.target.checked
                          ? [...allergens, a]
                          : allergens.filter((v) => v !== a),
                      )
                    }
                  />
                  {a}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="filter-bottom">
            <label className="check-label">
              <input
                type="checkbox"
                checked={oilFree}
                onChange={(e) => setOilFree(e.target.checked)}
              />
              No added oil
            </label>
            <div className="filter-actions">
              <button className="text-button" onClick={reset}>
                Reset filters
              </button>
              <button
                className="button primary"
                onClick={() => {
                  setFiltersOpen(false);
                  resultsHeading.current?.focus();
                }}
              >
                Show {results.length} {results.length === 1 ? "recipe" : "recipes"}
              </button>
            </div>
          </div>
        </section>
      )}
      {(data.preferences.allergens.length > 0 ||
        data.preferences.dietary.length > 0) && (
        <p className="muted small">
          Your saved allergen and dietary exclusions are always applied.{" "}
          <a href="#/settings">Edit in Settings</a>.
        </p>
      )}
      <div className="results-heading" ref={resultsHeading} tabIndex={-1}>
        <p aria-live="polite" aria-atomic="true">
          <strong>{results.length}</strong>{" "}
          {results.length === 1 ? "recipe" : "recipes"} to discover
        </p>
        <label>
          Sort by
          <select
            aria-label="Sort recipes"
            value={sort}
            onChange={(e) => setSort(e.target.value as typeof sort)}
          >
            <option value="relevance">Relevance</option>
            <option value="time">Quickest first</option>
            <option value="protein">Most protein</option>
            <option value="rating">My highest rated</option>
          </select>
        </label>
      </div>
      {results.length ? (
        <>
          <h2 className="sr-only">Recipe results</h2>
          <RecipeGrid recipes={results.slice(0, limit)} />
          {results.length > limit && (
            <div className="load-more">
              <button className="button" onClick={() => setLimit(limit + 24)}>
                Show more recipes ({results.length - limit} remaining)
              </button>
            </div>
          )}
        </>
      ) : favourites &&
        activeFilters === 0 &&
        !search.trim() &&
        !data.recipeStates.some((state) => state.favourite) ? (
        <Empty
          title="No favourites yet"
          action={
            <a className="button primary" href="#/explore">
              Explore recipes
            </a>
          }
        >
          Tap the heart on any recipe to keep it here.
        </Empty>
      ) : (
        <Empty
          title="No recipes on this shelf"
          action={
            <button className="button primary" onClick={reset}>
              Reset search & filters
            </button>
          }
        >
          Try another ingredient or loosen a filter. Your saved allergen
          exclusions will stay in place.
        </Empty>
      )}
    </>
  );
}
