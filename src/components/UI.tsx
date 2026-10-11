import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowRight, Clock3, Heart, X, Flame, ChefHat } from "lucide-react";
import type { Recipe } from "../lib/schema";
import { actions } from "../lib";
import { useApp } from "./context";
import { categoryLabels } from "../data/catalogue";
export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    const trigger =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    el?.showModal();
    return () => {
      el?.close();
      document.body.style.overflow = previousOverflow;
      // React may remove the dialog before the browser's native focus restoration.
      if (trigger?.isConnected) trigger.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="modal"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      aria-labelledby="modal-title"
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const controls = Array.from(
          event.currentTarget.querySelectorAll<HTMLElement>(
            'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
          ),
        ).filter((element) => element.getClientRects().length > 0);
        const first = controls[0];
        const last = controls.at(-1);
        // Keep the native modal's keyboard cycle inside its controls instead
        // of handing focus to browser chrome at the end of the tab sequence.
        if (event.shiftKey && document.activeElement === first && last) {
          event.preventDefault();
          last.focus();
        } else if (
          !event.shiftKey &&
          document.activeElement === last &&
          first
        ) {
          event.preventDefault();
          first.focus();
        }
      }}
    >
      <div className="modal-heading">
        <h2 id="modal-title">{title}</h2>
        <button
          className="icon-button"
          onClick={onClose}
          aria-label="Close dialog"
        >
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function Empty({
  title,
  children,
  action,
  level = 2,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  // A page's only heading is h1 (the 404 has no PageHeading to provide one).
  level?: 1 | 2;
}) {
  const Heading = level === 1 ? "h1" : "h2";
  return (
    <div className="empty">
      <ChefHat size={36} strokeWidth={1.4} />
      <Heading>{title}</Heading>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}
export function FoodImage({
  recipe,
  hero = false,
}: {
  recipe: Recipe;
  hero?: boolean;
}) {
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const failed = failedSource === recipe.image.src;
  return (
    <div className={`food-image ${hero ? "hero-image" : ""}`}>
      {failed ? (
        <div
          className="food-image-fallback"
          role="img"
          aria-label={`${categoryLabels[recipe.category]} recipe illustration unavailable`}
        >
          <ChefHat size={44} strokeWidth={1.2} />
          <span>{categoryLabels[recipe.category]}</span>
          <small>Good food starts here</small>
        </div>
      ) : (
        <img
          src={recipe.image.src}
          alt={recipe.image.alt}
          // Intrinsic 3:2 size reserves the box before the file loads (CSS still sizes it).
          width={1200}
          height={800}
          loading={hero ? "eager" : "lazy"}
          decoding="async"
          onError={() => setFailedSource(recipe.image.src)}
        />
      )}
      {!failed && (
        <span className="image-disclosure">Category illustration</span>
      )}
    </div>
  );
}
export function RecipeCard({ recipe }: { recipe: Recipe }) {
  const { data, run } = useApp();
  const state = data.recipeStates.find((s) => s.id === recipe.id);
  return (
    <article className="recipe-card">
      <a href={`#/recipe/${recipe.slug}`} tabIndex={-1} aria-hidden="true">
        <FoodImage recipe={recipe} />
      </a>
      <button
        className={`heart-button ${state?.favourite ? "is-favourite" : ""}`}
        aria-label={`Save ${recipe.title} to favourites`}
        aria-pressed={state?.favourite || false}
        onClick={() =>
          void run(
            () => actions.toggleRecipeState(recipe.id, "favourite"),
            "Favourites updated",
          )
        }
      >
        <Heart size={19} fill={state?.favourite ? "currentColor" : "none"} />
      </button>
      <div className="recipe-card-body">
        <span className="category-label">
          {categoryLabels[recipe.category]}
          {state?.tried ? " · Tried ✓" : ""}
        </span>
        <h3>
          <a href={`#/recipe/${recipe.slug}`}>{recipe.title}</a>
        </h3>
        <div className="recipe-meta">
          <span>
            <Flame size={15} />
            {Math.round(recipe.nutrition.protein)}g protein
          </span>
          <span>
            <Clock3 size={15} />
            {recipe.totalMinutes} min
          </span>
        </div>
        <p>{recipe.description}</p>
      </div>
    </article>
  );
}
export function RecipeGrid({ recipes }: { recipes: Recipe[] }) {
  return (
    <div className="recipe-grid">
      {recipes.map((r) => (
        <RecipeCard key={r.id} recipe={r} />
      ))}
    </div>
  );
}
export function PageHeading({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <header className="page-heading">
      <div>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {action}
    </header>
  );
}
export function SectionHeading({
  title,
  href,
  link = "View all",
}: {
  title: string;
  href?: string;
  link?: string;
}) {
  return (
    <div className="section-heading">
      <h2>{title}</h2>
      {href && (
        <a className="text-link" href={href}>
          {link}
          <ArrowRight size={17} />
        </a>
      )}
    </div>
  );
}
export function Pill({ children }: { children: ReactNode }) {
  return <span className="pill">{children}</span>;
}

// Reflect a click immediately while IndexedDB commits; roll back visibly on storage failure.
export function SavedCheckbox({
  checked,
  onCheckedChange,
  label,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => Promise<boolean>;
  label?: string;
}) {
  const [value, setValue] = useState(checked);
  const saving = useRef(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setValue(checked);
  }, [checked]);
  return (
    <input
      type="checkbox"
      aria-label={label}
      checked={value}
      // aria-busy, not disabled: disabling the focused input drops keyboard focus,
      // but assistive tech (and tests) still need to know a save is in flight.
      aria-busy={busy || undefined}
      onChange={async (e) => {
        if (saving.current) return;
        const next = e.target.checked;
        setValue(next);
        saving.current = true;
        setBusy(true);
        try {
          if (!(await onCheckedChange(next))) setValue(checked);
        } finally {
          saving.current = false;
          setBusy(false);
        }
      }}
    />
  );
}
