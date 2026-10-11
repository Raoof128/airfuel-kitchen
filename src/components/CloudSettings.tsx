import { useCallback, useEffect, useState } from "react";
import {
  Cloud,
  CircleAlert,
  CircleCheck,
  Clock,
  GitCompareArrows,
  HardDrive,
  LogOut,
  RefreshCw,
  type LucideIcon,
} from "lucide-react";
import {
  cloudConfigured,
  useCloudStatus,
  signIn,
  signOut,
  enableSync,
  syncNow,
  syncDisplayState,
  listCloudConflicts,
  resolveCloudConflict,
  retryRejectedCloudRecords,
  type CloudStatus,
  type ConflictRecord,
  type Entity,
  type SyncDisplayState,
} from "../cloud";
import type { Recipe } from "../lib/schema";
import { useApp } from "./context";

const SYNC_STATE_ICONS: Record<SyncDisplayState, LucideIcon> = {
  "saved-locally": HardDrive,
  waiting: Clock,
  syncing: RefreshCw,
  synced: CircleCheck,
  failed: CircleAlert,
  conflict: GitCompareArrows,
};

export const SYNC_STATE_LABELS: Record<SyncDisplayState, string> = {
  "saved-locally": "Saved on this device",
  waiting: "Waiting to sync",
  syncing: "Syncing",
  synced: "Synced",
  failed: "Needs attention",
  conflict: "Conflict: choose a version",
};

// Plain-words names for each synced record type, shown in the conflict list.
export const ENTITY_LABELS: Record<Entity, string> = {
  recipeStates: "Recipe rating and notes",
  sessions: "Cooking log entry",
  plans: "Meal plan entry",
  pantry: "Pantry item",
  shopping: "Shopping list item",
  customRecipes: "Your own recipe",
  overrides: "Recipe edits",
  preferences: "Preferences",
  activeCooking: "Cooking in progress",
};

export const SYNC_RULE_COPY =
  "When two devices change the same item, the cloud keeps one whole version, chosen by edit order rather than device clock. Versions are not merged field by field. The version that loses is kept on the device where it was displaced and listed below for you to choose. A version replaced again before a device has seen it may not be kept. Deletions are kept so old devices cannot undo them.";

const PREFERENCE_LABELS: Record<string, string> = {
  name: "Name",
  location: "Location",
  language: "Language",
  timezone: "Time zone",
  airFryerBrand: "Air fryer brand",
  airFryerLitres: "Air fryer size (litres)",
  airFryerModel: "Air fryer model",
  defaultServings: "Default servings",
  minProtein: "Minimum protein (g)",
  maxMinutes: "Maximum minutes",
  preferredProteins: "Preferred proteins",
  favouriteIngredients: "Favourite ingredients",
  dislikedIngredients: "Disliked ingredients",
  avoidIngredients: "Ingredients to avoid",
  allergens: "Allergens",
  dietary: "Dietary choices",
  oilFree: "Oil-free cooking",
  cuisines: "Cuisines",
  theme: "Theme",
};

// Fields that change on every save and say nothing about what the owner chose.
const IGNORED_PREFERENCE_FIELDS = new Set(["id", "updatedAt"]);

type Row = Record<string, unknown>;

function asRow(value: unknown): Row | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Row)
    : null;
}

function plural(count: number, singular: string, pluralForm = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

// Notes can be long; the conflict list shows a readable excerpt, not the whole text.
export function excerpt(text: string, max = 240): string {
  const clean = text.trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}

export function syncStateLabel(state: SyncDisplayState): string {
  return SYNC_STATE_LABELS[state];
}

export function rejectedExplanation(count: number): string {
  return `${plural(count, "item")} could not be synced. The cloud refused the change, or the record is in a form this version of the app cannot read. Your copies stay on this device, and the item is not retried until you edit it again.`;
}

export function conflictExplanation(count: number): string {
  return `${plural(count, "item")} changed on two devices at the same time. The cloud kept one version and this device kept the other. Choose which version to keep for each item below.`;
}

function formatPreferenceValue(value: unknown): string {
  if (Array.isArray(value)) return value.length ? value.join(", ") : "None";
  if (typeof value === "boolean") return value ? "On" : "Off";
  if (value === null || value === undefined || value === "") return "Not set";
  return String(value);
}

// Only the preference fields that differ between the two versions, so the owner sees what changed.
export function changedPreferenceFields(
  local: unknown,
  remote: unknown,
): { label: string; local: string; remote: string }[] {
  const a = asRow(local);
  const b = asRow(remote);
  if (!a || !b) return [];
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys]
    .filter(
      (key) =>
        !IGNORED_PREFERENCE_FIELDS.has(key) &&
        JSON.stringify(a[key]) !== JSON.stringify(b[key]),
    )
    .map((key) => ({
      label: PREFERENCE_LABELS[key] ?? key,
      local: formatPreferenceValue(a[key]),
      remote: formatPreferenceValue(b[key]),
    }));
}

const RECIPE_LINKED: Entity[] = ["recipeStates", "overrides", "customRecipes"];
const SESSION_LINKED: Entity[] = ["sessions", "plans"];

// The recipe a conflicting record belongs to, if any. Titles come from the app's recipe list.
function linkedRecipeId(conflict: ConflictRecord): string | undefined {
  if (RECIPE_LINKED.includes(conflict.entity)) return conflict.recordId;
  if (SESSION_LINKED.includes(conflict.entity)) {
    const value = asRow(conflict.local) ?? asRow(conflict.remote);
    return typeof value?.recipeId === "string" ? value.recipeId : undefined;
  }
  return undefined;
}

export function conflictTitle(
  conflict: ConflictRecord,
  recipes: readonly Pick<Recipe, "id" | "title">[],
): string {
  const label = ENTITY_LABELS[conflict.entity];
  const recipeId = linkedRecipeId(conflict);
  if (recipeId) {
    const payloadRecipe =
      asRow(asRow(conflict.local)?.recipe) ??
      asRow(asRow(conflict.remote)?.recipe);
    const title =
      recipes.find((recipe) => recipe.id === recipeId)?.title ??
      (typeof payloadRecipe?.title === "string"
        ? payloadRecipe.title
        : recipeId);
    return `${label}: ${title}`;
  }
  const value = asRow(conflict.local) ?? asRow(conflict.remote);
  if (typeof value?.name === "string") return `${label}: ${value.name}`;
  return label;
}

// Readable lines describing one side of a conflict. Raw JSON is never shown.
export function conflictLines(
  conflict: ConflictRecord,
  side: "local" | "remote",
): string[] {
  const value = side === "local" ? conflict.local : conflict.remote;
  const other = side === "local" ? conflict.remote : conflict.local;
  const row = asRow(value);
  if (!row)
    return [
      side === "local" ? "Deleted on this device" : "Deleted in the cloud",
    ];

  switch (conflict.entity) {
    case "preferences": {
      const changed = changedPreferenceFields(
        side === "local" ? value : other,
        side === "local" ? other : value,
      );
      return changed.length
        ? changed.map(
            (field) =>
              `${field.label}: ${side === "local" ? field.local : field.remote}`,
          )
        : ["No differences in the preference fields"];
    }
    case "recipeStates": {
      const lines: string[] = [];
      lines.push(
        typeof row.rating === "number"
          ? `Rating: ${row.rating} of 5`
          : "No rating",
      );
      lines.push(
        typeof row.notes === "string" && row.notes.trim()
          ? `Notes: ${excerpt(row.notes)}`
          : "No notes",
      );
      if (row.favourite === true) lines.push("Marked as a favourite");
      if (row.tried === true) lines.push("Marked as tried");
      return lines;
    }
    case "sessions": {
      const lines: string[] = [];
      if (typeof row.date === "string") lines.push(`Cooked on ${row.date}`);
      lines.push(
        typeof row.rating === "number"
          ? `Rating: ${row.rating} of 5`
          : "No rating",
      );
      lines.push(
        typeof row.notes === "string" && row.notes.trim()
          ? `Notes: ${excerpt(row.notes)}`
          : "No notes",
      );
      return lines;
    }
    case "plans":
      return [
        [
          row.date,
          row.slot,
          typeof row.servings === "number" ? `${row.servings} servings` : null,
        ]
          .filter(Boolean)
          .join(" · "),
      ];
    case "pantry":
    case "shopping": {
      const lines = [
        [row.name, row.quantity, row.unit]
          .filter((part) => part !== undefined && part !== "")
          .join(" "),
      ];
      if (conflict.entity === "shopping")
        lines.push(row.checked === true ? "Ticked off" : "Not ticked off");
      return lines;
    }
    case "customRecipes":
    case "overrides": {
      const recipe = asRow(row.recipe);
      const lines: string[] = [];
      if (typeof recipe?.description === "string")
        lines.push(excerpt(recipe.description, 160));
      if (!lines.length) lines.push("Recipe details");
      return lines;
    }
    case "activeCooking": {
      const steps = Array.isArray(row.checkedSteps)
        ? row.checkedSteps.length
        : 0;
      const ingredients = Array.isArray(row.checkedIngredients)
        ? row.checkedIngredients.length
        : 0;
      return [
        `${plural(ingredients, "ingredient")} ticked`,
        `${plural(steps, "step")} ticked`,
      ];
    }
    default:
      return ["Saved record"];
  }
}

function SyncStatusLine({ status }: { status: CloudStatus }) {
  const state = syncDisplayState(status);
  const Icon = SYNC_STATE_ICONS[state];
  return (
    <div className="cloud-status" role="status">
      <span
        className={`cloud-status-icon cloud-status-${state}${state === "syncing" ? " is-spinning" : ""}`}
        aria-hidden="true"
      >
        <Icon size={20} />
      </span>
      <div className="cloud-status-text">
        <p className="cloud-status-label">
          {syncStateLabel(state)}
          {status.email ? ` · ${status.email}` : ""}
        </p>
        <p className="cloud-status-message">{status.message}</p>
      </div>
    </div>
  );
}

type ConflictLoad =
  | { state: "loading" }
  | { state: "ready"; rows: ConflictRecord[] }
  | { state: "failed" };

export function CloudSettings() {
  const { run, recipes } = useApp();
  const status = useCloudStatus();
  const [busy, setBusy] = useState(false);
  const [consent, setConsent] = useState(false);
  const [conflictLoad, setConflictLoad] = useState<ConflictLoad>({
    state: "loading",
  });
  const configured = cloudConfigured();

  const refreshConflicts = useCallback(async () => {
    try {
      setConflictLoad({ state: "ready", rows: await listCloudConflicts() });
    } catch {
      setConflictLoad({ state: "failed" });
    }
  }, []);

  useEffect(() => {
    if (configured) void refreshConflicts();
  }, [configured, refreshConflicts, status.conflicts]);

  async function resolve(conflict: ConflictRecord, side: "local" | "remote") {
    setBusy(true);
    try {
      const title = conflictTitle(conflict, recipes);
      const kept =
        side === "local" ? "this device's version" : "the cloud version";
      await run(
        () => resolveCloudConflict(conflict.key, side),
        `Kept ${kept} of ${title}. It will sync on the next pass.`,
      );
      await refreshConflicts();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="settings-section cloud-section">
      <h2>
        <Cloud size={23} />
        Cross-device sync
      </h2>
      {!configured ? (
        <>
          <p>
            This kitchen works fully on this device without an account. Optional
            Supabase sync is not configured. Setup and live verification
            requirements are documented in the application source.
          </p>
          <span className="status-badge">
            Local only · no data sent to a server
          </span>
        </>
      ) : (
        <>
          <p>
            Sync sends your recipe ratings and notes, cooking log, meal plans,
            pantry, shopping list, your own recipes, recipe edits, preferences
            and cooking in progress to your configured Supabase project. Export
            a backup first.
          </p>
          <p className="cloud-rule">{SYNC_RULE_COPY}</p>

          <SyncStatusLine status={status} />

          <p className="small muted cloud-counts">
            {status.lastSyncedAt
              ? `Last synced ${new Date(status.lastSyncedAt).toLocaleString("en-AU")}. `
              : ""}
            {plural(status.pending, "change")} queued.
          </p>

          {status.rejected > 0 && (
            <div className="cloud-count cloud-count-failed">
              <CircleAlert size={18} aria-hidden="true" />
              <p>{rejectedExplanation(status.rejected)}</p>
              <button
                className="button"
                type="button"
                disabled={busy || status.phase === "syncing"}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await run(
                      () => retryRejectedCloudRecords(),
                      "Refused records were re-queued for the next sync.",
                    );
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Retry refused records
              </button>
            </div>
          )}

          {status.conflicts > 0 && (
            <section
              className="cloud-conflicts"
              aria-labelledby="cloud-conflicts-heading"
            >
              <h3 id="cloud-conflicts-heading">Conflicts to review</h3>
              <p>{conflictExplanation(status.conflicts)}</p>
              {conflictLoad.state === "loading" && (
                <p className="small muted">Loading conflicts…</p>
              )}
              {conflictLoad.state === "failed" && (
                <p className="small muted">
                  The conflict list could not be loaded on this device. Reopen
                  Settings to try again.
                </p>
              )}
              {conflictLoad.state === "ready" && (
                <ul className="cloud-conflict-list">
                  {conflictLoad.rows.map((conflict) => {
                    const title = conflictTitle(conflict, recipes);
                    return (
                      <li className="cloud-conflict" key={conflict.key}>
                        <h4>{title}</h4>
                        <div className="cloud-conflict-versions">
                          <div className="cloud-conflict-side">
                            <h5>This device</h5>
                            <ul>
                              {conflictLines(conflict, "local").map(
                                (line, index) => (
                                  <li key={index}>{line}</li>
                                ),
                              )}
                            </ul>
                          </div>
                          <div className="cloud-conflict-side">
                            <h5>Cloud</h5>
                            <ul>
                              {conflictLines(conflict, "remote").map(
                                (line, index) => (
                                  <li key={index}>{line}</li>
                                ),
                              )}
                            </ul>
                          </div>
                        </div>
                        <div className="button-row cloud-conflict-actions">
                          <button
                            className="button"
                            type="button"
                            disabled={busy || status.phase === "syncing"}
                            aria-label={`Keep this device's version of ${title}`}
                            onClick={() => void resolve(conflict, "local")}
                          >
                            {"Keep this device's version"}
                          </button>
                          <button
                            className="button"
                            type="button"
                            disabled={busy || status.phase === "syncing"}
                            aria-label={`Keep the cloud version of ${title}`}
                            onClick={() => void resolve(conflict, "remote")}
                          >
                            {"Keep the cloud version"}
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          )}

          <p className="small muted cloud-counts">
            Not yet tested against a live Supabase project in this build.
          </p>

          {!status.email && (
            <form
              className="stack-form"
              onSubmit={async (e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                const password = String(f.get("password"));
                const email = String(f.get("email"));
                e.currentTarget.reset();
                setBusy(true);
                await run(
                  () => signIn(email, password),
                  "Signed in. Enable sync below when you’re ready.",
                );
                setBusy(false);
              }}
            >
              <label>
                Email
                <input
                  name="email"
                  type="email"
                  autoComplete="username"
                  required
                  maxLength={320}
                />
              </label>
              <label>
                Password
                <input
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  maxLength={256}
                />
              </label>
              <button className="button" disabled={busy}>
                Sign in to an existing account
              </button>
            </form>
          )}
          {!status.enabled && (
            <>
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                />
                I want to sync this device’s personal data with my account.
              </label>
              <button
                className="button primary"
                disabled={!consent || busy}
                onClick={async () => {
                  setBusy(true);
                  await run(() => enableSync(), "Sync enabled");
                  setBusy(false);
                }}
              >
                Enable sync / reuse saved session
              </button>
            </>
          )}
          {status.enabled && (
            <div className="button-row">
              <button
                className="button"
                disabled={busy || status.phase === "syncing"}
                onClick={async () => {
                  setBusy(true);
                  await run(() => syncNow(), "Sync completed");
                  setBusy(false);
                }}
              >
                <RefreshCw size={17} />
                Sync now
              </button>
            </div>
          )}
          {(status.email || status.enabled) && (
            <button
              className="text-button"
              disabled={busy || status.phase === "syncing"}
              onClick={async () => {
                setBusy(true);
                await run(
                  () => signOut(),
                  "Signed out. Data stays on this device.",
                );
                setBusy(false);
                setConsent(false);
              }}
            >
              <LogOut size={16} />
              Sign out
            </button>
          )}
          <p className="small muted">
            Sync must be enabled again after reopening the app. Deletions
            propagate while sync is enabled. A device-only reset signs out first
            and leaves remote data intact.
          </p>
        </>
      )}
    </section>
  );
}
