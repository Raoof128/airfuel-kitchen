import { useState } from "react";
import {
  ArrowRight,
  Search,
  Shuffle,
  ChevronRight,
  Leaf,
  Timer,
  Flame,
  CalendarDays,
  BookOpen,
} from "lucide-react";
import { useApp } from "../components/context";
import { FoodImage, RecipeGrid, SectionHeading, Empty } from "../components/UI";
import {
  recommendRecipes,
  localDate,
  weekDates,
  consumedNutrition,
} from "../lib";
const collections = [
  ["All recipes", ""],
  ["30g+ protein", "protein=30"],
  ["Under 20 minutes", "time=19"],
  ["Something new", "status=untried"],
  ["Vegetarian protein", "dietary=vegetarian&protein=15"],
  ["Chicken favourites", "category=chicken-turkey&status=favourites"],
  ["Egg breakfasts", "category=breakfast&q=egg"],
  ["Budget-friendly", "q=budget"],
];
export function Dashboard() {
  const { data, recipes, navigate } = useApp();
  const [search, setSearch] = useState("");
  const [mode, setMode] = useState<
    "tonight" | "new" | "favourites" | "pantry" | "fast" | "surprise"
  >("tonight");
  const [randomIndex, setRandomIndex] = useState(0);
  const feature = recommendRecipes(recipes, data, "tonight", 1)[0];
  const newRecipes = recommendRecipes(recipes, data, "new", 5)
    .filter((r) => r.recipe.id !== feature?.recipe.id)
    .slice(0, 3)
    .map((r) => r.recipe);
  const recommended = recommendRecipes(recipes, data, mode, 30);
  const more =
    mode === "tonight" || mode === "new"
      ? recommended.filter(
          (r) =>
            r.recipe.id !== feature?.recipe.id &&
            !newRecipes.some((n) => n.id === r.recipe.id),
        )
      : recommended;
  const displayed =
    mode === "surprise" && more.length
      ? [
          ...more.slice(randomIndex % more.length),
          ...more.slice(0, randomIndex % more.length),
        ]
      : more;
  const hours = Number(
    new Intl.DateTimeFormat("en-AU", {
      hour: "numeric",
      hourCycle: "h23",
      timeZone: data.preferences.timezone,
    }).format(new Date()),
  );
  const greeting =
    hours < 12 ? "morning" : hours < 17 ? "afternoon" : "evening";
  const ids = new Set(recipes.map((r) => r.id));
  const states = data.recipeStates.filter((s) => ids.has(s.id));
  const tried = states.filter((s) => s.tried).length;
  const favs = states.filter((s) => s.favourite).length;
  const week = weekDates(localDate(new Date(), data.preferences.timezone));
  const sessions = data.sessions.filter((s) => week.includes(s.date));
  const consumed = consumedNutrition(sessions, recipes);
  const ratings = states.filter((s) => s.rating !== null);
  const average = ratings.length
    ? (
        ratings.reduce((n, s) => n + (s.rating || 0), 0) / ratings.length
      ).toFixed(1)
    : "—";
  const recent = [...states]
    .filter((s) => s.viewedAt)
    .sort((a, b) => (b.viewedAt || 0) - (a.viewedAt || 0))
    .slice(0, 3)
    .flatMap((s) => recipes.find((r) => r.id === s.id) || []);
  const recentlyCooked = [
    ...new Set(
      [...data.sessions]
        .sort(
          (a, b) => b.date.localeCompare(a.date) || b.updatedAt - a.updatedAt,
        )
        .map((s) => s.recipeId),
    ),
  ]
    .slice(0, 3)
    .flatMap((id) => recipes.find((r) => r.id === id) || []);
  const activeRecipe = recipes.find(
    (r) => r.id === data.activeCooking?.recipeId,
  );
  const todayPlans = data.plans.filter(
    (p) => p.date === localDate(new Date(), data.preferences.timezone),
  );
  return (
    <>
      <div className="dashboard-top">
        <p>
          Good {greeting}, {data.preferences.name}
        </p>
        <form
          className="search-box top-search"
          onSubmit={(e) => {
            e.preventDefault();
            navigate(`/explore?q=${encodeURIComponent(search)}`);
          }}
        >
          <Search size={19} />
          <input
            aria-label="Search recipes"
            placeholder="Find a recipe or ingredient…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </form>
      </div>
      <header className="dashboard-heading">
        <span className="eyebrow">YOUR EVERYDAY KITCHEN</span>
        <h1>What’s cooking today?</h1>
        <p>A good meal. A little less effort.</p>
      </header>
      {data.activeCooking && (
        <a
          className="continue-bar"
          href={`#/cook/${activeRecipe?.slug || data.activeCooking.recipeId}`}
        >
          <Timer size={19} />
          Continue cooking:{" "}
          {recipes.find((r) => r.id === data.activeCooking?.recipeId)?.title ||
            "your saved recipe"}
          <ChevronRight size={18} />
        </a>
      )}
      <div className="dashboard-feature">
        {feature ? (
          <section className="hero">
            <div className="hero-copy">
              <span className="eyebrow">ON THE MENU TONIGHT</span>
              <h2>{feature.recipe.title}</h2>
              <p>{feature.reasons.slice(0, 2).join(". ")}.</p>
              <div className="hero-facts">
                <span>
                  <strong>
                    {Math.round(feature.recipe.nutrition.protein)}g
                  </strong>
                  protein / serving
                </span>
                <span>
                  <strong>
                    {feature.recipe.totalMinutes}
                    <small> min</small>
                  </strong>
                  total time
                </span>
              </div>
              <a
                className="button primary"
                href={`#/recipe/${feature.recipe.slug}`}
              >
                See the recipe
                <ArrowRight size={18} />
              </a>
            </div>
            <FoodImage recipe={feature.recipe} hero />
          </section>
        ) : (
          <Empty title="Let’s find food that fits">
            No recipes match your saved restrictions. You can review your
            preferences or add your own recipe.
            <a className="button" href="#/settings">
              Review preferences
            </a>
          </Empty>
        )}
        <aside className="today-note" aria-label="Your daily plan">
          <CalendarDays size={25} strokeWidth={1.4} />
          <span className="eyebrow">A LITTLE PLANNING</span>
          <h2>
            Make room for
            <br />
            something good.
          </h2>
          {todayPlans.length ? (
            <>
              <p>
                {todayPlans.length} {todayPlans.length === 1 ? "meal" : "meals"}{" "}
                planned for today.
              </p>
              <ul>
                {todayPlans.slice(0, 2).map((p) => {
                  const r = recipes.find((item) => item.id === p.recipeId);
                  return r ? (
                    <li key={p.id}>
                      <span>{p.slot}</span>
                      <a href={`#/recipe/${r.slug}`}>{r.title}</a>
                    </li>
                  ) : null;
                })}
              </ul>
            </>
          ) : (
            <p>
              Pick a meal, plan your week and turn the ingredients into a
              shopping list.
            </p>
          )}
          <a className="text-link" href="#/planner">
            Open your meal plan <ArrowRight size={17} />
          </a>
        </aside>
      </div>
      <div className="stats-rail">
        {[
          [recipes.length, "Recipes to explore"],
          [tried, "Recipes tried"],
          [favs, "Favourites"],
          [sessions.length, "Meals logged this week"],
        ].map(([value, label]) => (
          <div key={String(label)}>
            <strong>{value}</strong>
            <span>{label}</span>
          </div>
        ))}
      </div>
      <div className="progress-row">
        <div>
          <span>
            {tried} of {recipes.length} recipes tried · {recipes.length - tried}{" "}
            waiting to be discovered
          </span>
          <progress
            value={tried}
            max={recipes.length || 1}
            aria-label="Recipe exploration progress"
          />
        </div>
        <span>
          {average} / 5 average rating
          <br />
          {Math.round(consumed.protein)}g protein logged this week
        </span>
      </div>
      <section>
        <SectionHeading
          title="Find your next favourite"
          href="#/explore"
          link="Explore the kitchen"
        />
        <div className="collection-chips">
          {collections.map(([label, query]) => (
            <a
              className="chip"
              key={label}
              href={`#/explore${query ? `?${query}` : ""}`}
            >
              {label}
            </a>
          ))}
        </div>
        <RecipeGrid recipes={newRecipes} />
      </section>
      {recentlyCooked.length > 0 && (
        <section>
          <SectionHeading
            title="Fresh from your kitchen"
            href="#/journal"
            link="Cooking journal"
          />
          <p className="section-intro">
            Meals you’ve actually cooked, with your notes for next time.
          </p>
          <RecipeGrid recipes={recentlyCooked} />
        </section>
      )}
      {favs > 0 && (
        <a className="saved-collection" href="#/favourites">
          <BookOpen size={25} />
          <span>
            <strong>Your personal cookbook</strong>
            <small>
              {favs} saved {favs === 1 ? "favourite" : "favourites"}, ready when
              you are.
            </small>
          </span>
          <ArrowRight size={21} />
        </a>
      )}
      <section className="recommend-section">
        <SectionHeading title="A little more you" />
        <p className="section-intro">
          Suggestions based on your preferences and cooking history. No AI
          account needed.
        </p>
        <div className="collection-chips">
          {(
            [
              ["tonight", "Recommended tonight"],
              ["new", "Something new"],
              ["favourites", "Cook a favourite again"],
              ["pantry", "Use what I have"],
              ["fast", "Fast dinner"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              className={`chip ${mode === key ? "selected" : ""}`}
              aria-pressed={mode === key}
              onClick={() => {
                setMode(key);
                setRandomIndex(0);
              }}
            >
              {label}
            </button>
          ))}
          <button
            className={`chip ${mode === "surprise" ? "selected" : ""}`}
            aria-pressed={mode === "surprise"}
            onClick={() => {
              setMode("surprise");
              setRandomIndex(Math.floor(Math.random() * 1000));
            }}
          >
            <Shuffle size={16} />
            Surprise me
          </button>
        </div>
        <RecipeGrid recipes={displayed.slice(0, 3).map((r) => r.recipe)} />
        {!recommended.length && (
          <Empty
            title={
              mode === "favourites"
                ? "Your favourites start with a heart"
                : "Nothing here just yet"
            }
            action={
              <a
                className="button"
                href={mode === "pantry" ? "#/pantry" : "#/explore"}
              >
                {mode === "pantry"
                  ? "Add pantry ingredients"
                  : "Find a recipe to save"}
              </a>
            }
          >
            {mode === "favourites"
              ? "Tap the heart on a recipe you’d love to make. Your saved meals will appear here."
              : "Try another collection or review your saved dietary preferences."}
          </Empty>
        )}
      </section>
      <div className="collection-tiles">
        <a href="#/explore?protein=40">
          <Flame />
          <h3>A little extra protein</h3>
          <p>40g+ per serving</p>
          <ArrowRight />
        </a>
        <a href="#/explore?oilFree=true">
          <Leaf />
          <h3>Keep it light</h3>
          <p>Recipes with no added oil</p>
          <ArrowRight />
        </a>
        <a href="#/explore?category=breakfast">
          <Timer />
          <h3>A better breakfast</h3>
          <p>Start the day in your air fryer</p>
          <ArrowRight />
        </a>
      </div>
      {recent.length > 0 && (
        <section>
          <SectionHeading title="Recently opened" />
          <RecipeGrid recipes={recent} />
        </section>
      )}
    </>
  );
}
