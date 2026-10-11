import { useEffect, useRef, useState } from "react";
import {
  Download,
  Upload,
  ShieldCheck,
  Database,
  Trash2,
  BookOpen,
  ExternalLink,
} from "lucide-react";
import {
  actions,
  exportBackup,
  previewImport,
  importBackup,
  requestPersistentStorage,
  type ImportPreview,
} from "../lib";
import {
  allergenNames,
  defaultPreferences,
  type Preferences,
} from "../lib/schema";
import { useApp } from "../components/context";
import { PageHeading, Modal } from "../components/UI";
import { CloudSettings } from "../components/CloudSettings";
import { cloudConfigured, signOut, forgetCloudCache } from "../cloud";
import { clearRecipeNoteDrafts } from "../lib/noteDrafts";
function split(value: FormDataEntryValue | null) {
  return String(value || "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}
function validTimezone(value: string) {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}
function MultiCheck({
  values,
  name,
  selected,
}: {
  values: readonly string[];
  name: string;
  selected: string[];
}) {
  return (
    <div className="checkbox-group">
      {values.map((v) => (
        <label key={v}>
          <input
            type="checkbox"
            name={name}
            value={v}
            defaultChecked={selected.includes(v)}
          />
          {v}
        </label>
      ))}
    </div>
  );
}
export function SettingsPage() {
  const { data, run } = useApp();
  const [p, setFormPreferences] = useState(data.preferences);
  const [formRevision, setFormRevision] = useState(0);
  const [draftDirty, setDraftDirty] = useState(false);
  const draftDirtyRef = useRef(false);
  const draftRevision = useRef(0);
  const savingPreferences = useRef(false);
  const restoringBackup = useRef(false);
  const deletingData = useRef(false);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [importMode, setImportMode] = useState<"merge" | "replace">("merge");
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [importError, setImportError] = useState("");
  const [busy, setBusy] = useState(false);
  const [reset, setReset] = useState(false);
  const [resetText, setResetText] = useState("");
  const [resetError, setResetError] = useState("");
  const [storage, setStorage] = useState("");
  useEffect(() => {
    // Clean forms follow imported or cross-tab preferences. An open draft must
    // keep its original baseline until saved or deliberately discarded.
    if (!draftDirtyRef.current) setFormPreferences(data.preferences);
  }, [data.preferences]);
  // updatedAt is excluded: saving the theme alone must not look like an edit made elsewhere.
  const preferencesChangedElsewhere =
    draftDirty &&
    JSON.stringify({ ...p, updatedAt: 0 }) !==
      JSON.stringify({ ...data.preferences, updatedAt: 0 });
  async function changeTheme(theme: Preferences["theme"], select: HTMLSelectElement) {
    // Appearance applies and persists at once, independent of the rest of the form.
    const saved: { preferences?: Preferences } = {};
    const success = await run(async () => {
      saved.preferences = await actions.savePreferences({ theme });
    }, "Appearance updated");
    if (success && saved.preferences) {
      setFormPreferences((current) => ({ ...current, theme }));
    } else {
      select.value = data.preferences.theme;
    }
  }
  async function download() {
    await run(async () => {
      const json = await exportBackup();
      const url = URL.createObjectURL(
        new Blob([json], { type: "application/json" }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = `airfuel-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, "Backup file prepared. Keep it somewhere safe.");
  }
  return (
    <>
      <PageHeading
        title="Your kitchen, your way"
        description="Preferences, personal memory and a little peace of mind."
      />
      <form
        className="settings-form"
        key={`${p.updatedAt}-${formRevision}`}
        onChange={(event) => {
          const target = event.target as HTMLElement;
          if (target.matches('select[name="theme"]')) {
            const select = target as HTMLSelectElement;
            void changeTheme(select.value as Preferences["theme"], select);
            return;
          }
          draftDirtyRef.current = true;
          draftRevision.current += 1;
          setDraftDirty(true);
        }}
        onSubmit={async (e) => {
          e.preventDefault();
          if (savingPreferences.current) return;
          const f = new FormData(e.currentTarget);
          const submissionRevision = draftRevision.current;
          const values = {
            name: String(f.get("name")),
            location: String(f.get("location")),
            language: String(f.get("language")),
            timezone: String(f.get("timezone")),
            airFryerBrand: String(f.get("brand")),
            airFryerModel: String(f.get("model")),
            airFryerLitres: Number(f.get("capacity")),
            defaultServings: Number(f.get("servings")),
            minProtein: Number(f.get("protein")),
            maxMinutes: Number(f.get("time")),
            theme: String(f.get("theme")) as Preferences["theme"],
            preferredProteins: split(f.get("proteins")),
            favouriteIngredients: split(f.get("favourites")),
            dislikedIngredients: split(f.get("dislikes")),
            avoidIngredients: split(f.get("avoid")),
            cuisines: split(f.get("cuisines")),
            allergens: f.getAll("allergens") as Preferences["allergens"],
            dietary: f.getAll("dietary") as Preferences["dietary"],
            oilFree: f.get("oilFree") === "on",
          };
          // Merge only changed fields, so saving an older draft cannot overwrite
          // unrelated preferences another tab changed while the form was open.
          const patch = Object.fromEntries(
            Object.entries(values).filter(([key, value]) => {
              const baseline = p[key as keyof Preferences];
              // Checkbox order follows the form, while imported selections may
              // use a different order. Reordering a set is not a user edit.
              if (
                (key === "allergens" || key === "dietary") &&
                Array.isArray(value) &&
                Array.isArray(baseline)
              )
                return (
                  JSON.stringify([...value].sort()) !==
                  JSON.stringify([...baseline].sort())
                );
              return JSON.stringify(value) !== JSON.stringify(baseline);
            }),
          );
          savingPreferences.current = true;
          setBusy(true);
          const saved: { preferences?: Preferences } = {};
          try {
            const success = await run(async () => {
              try {
                saved.preferences = await actions.savePreferences(patch);
              } catch {
                // Schema errors are raw JSON; show a plain message instead.
                throw new Error(
                  "Some preferences could not be saved. Check the highlighted fields and try again.",
                );
              }
            }, "Your kitchen preferences are saved");
            if (
              success &&
              saved.preferences &&
              submissionRevision === draftRevision.current
            ) {
              draftDirtyRef.current = false;
              setDraftDirty(false);
              setFormPreferences(saved.preferences);
            }
          } finally {
            savingPreferences.current = false;
            setBusy(false);
          }
        }}
      >
        {preferencesChangedElsewhere && (
          <p className="notice" role="status">
            Preferences changed elsewhere. Your unsaved changes are kept. Saving
            updates only the fields you edited.
          </p>
        )}
        <section className="settings-section">
          <h2>A little about you</h2>
          <div className="form-grid">
            <label>
              Your name
              <input
                name="name"
                required
                maxLength={100}
                defaultValue={p.name}
              />
            </label>
            <label>
              Location
              <input
                name="location"
                required
                maxLength={200}
                defaultValue={p.location}
              />
            </label>
            <label>
              Language preference
              <input name="language" required defaultValue={p.language} />
              <small>
                Interface and recipes currently use Australian English.
              </small>
            </label>
            <label>
              Timezone
              <input
                name="timezone"
                required
                defaultValue={p.timezone}
                onChange={(e) =>
                  e.currentTarget.setCustomValidity(
                    validTimezone(e.currentTarget.value)
                      ? ""
                      : "Enter a timezone such as Australia/Sydney.",
                  )
                }
              />
            </label>
            <label>
              Usual servings
              <input
                name="servings"
                type="number"
                min="0.5"
                max="100"
                step="0.5"
                required
                defaultValue={p.defaultServings}
              />
            </label>
            <label>
              Appearance
              <select name="theme" defaultValue={p.theme}>
                <option value="system">Use device setting</option>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </select>
            </label>
          </div>
        </section>
        <section className="settings-section">
          <h2>Your air fryer</h2>
          <p className="muted">
            Capacity helps you plan batches. Always follow your actual appliance
            manual.
          </p>
          <div className="form-grid">
            <label>
              Brand
              <input name="brand" required defaultValue={p.airFryerBrand} />
            </label>
            <label>
              Basket capacity (litres)
              <input
                name="capacity"
                type="number"
                min="0.1"
                max="100"
                step="0.1"
                required
                defaultValue={p.airFryerLitres}
              />
            </label>
            <label>
              Model (optional)
              <input
                name="model"
                maxLength={100}
                defaultValue={p.airFryerModel}
                placeholder="No model assumed"
              />
            </label>
          </div>
        </section>
        <section className="settings-section">
          <h2>What sounds good?</h2>
          <div className="form-grid">
            <label>
              Preferred protein per meal (g)
              <input
                name="protein"
                type="number"
                min="0"
                max="300"
                required
                defaultValue={p.minProtein}
              />
            </label>
            <label>
              Usual maximum total time (min)
              <input
                name="time"
                type="number"
                min="1"
                max="1440"
                required
                defaultValue={p.maxMinutes}
              />
            </label>
            <label>
              Preferred proteins
              <input
                name="proteins"
                defaultValue={p.preferredProteins.join(", ")}
                placeholder="chicken, salmon, tofu"
              />
            </label>
            <label>
              Favourite ingredients
              <input
                name="favourites"
                defaultValue={p.favouriteIngredients.join(", ")}
                placeholder="lemon, broccoli, yoghurt"
              />
            </label>
            <label>
              Ingredients you dislike
              <input
                name="dislikes"
                defaultValue={p.dislikedIngredients.join(", ")}
                placeholder="coriander, mushroom"
              />
            </label>
            <label>
              Favourite cuisines
              <input
                name="cuisines"
                defaultValue={p.cuisines.join(", ")}
                placeholder="Mediterranean, Indian"
              />
            </label>
          </div>
          <p className="small muted">
            Separate preferences with commas. These help rank suggestions; they
            don’t change the recipes.
          </p>
          <label className="check-label">
            <input name="oilFree" type="checkbox" defaultChecked={p.oilFree} />
            Only recommend recipes with no added oil
          </label>
        </section>
        <section className="settings-section">
          <h2>Food that fits you</h2>
          <p>
            These exclusions are always applied to recommendations. Check
            ingredient labels, substitutions and cross-contamination risks
            yourself.
          </p>
          <fieldset>
            <legend>Allergens to exclude</legend>
            <MultiCheck
              values={allergenNames}
              name="allergens"
              selected={p.allergens}
            />
          </fieldset>
          <fieldset>
            <legend>Dietary requirements</legend>
            <MultiCheck
              values={["vegetarian", "vegan", "gluten-free", "dairy-free"]}
              name="dietary"
              selected={p.dietary}
            />
          </fieldset>
          <label>
            Other ingredients never to recommend
            <input
              name="avoid"
              defaultValue={p.avoidIngredients.join(", ")}
              placeholder="e.g. aubergine, capsicum"
            />
          </label>
        </section>
        <button className="button primary" disabled={busy}>
          {busy ? "Saving…" : "Save preferences"}
        </button>
        {draftDirty && (
          <>
            <p className="small muted">You have unsaved preferences.</p>
            <button
              className="button"
              type="button"
              disabled={busy}
              onClick={() => {
                draftDirtyRef.current = false;
                setDraftDirty(false);
                setFormPreferences(data.preferences);
                setFormRevision((revision) => revision + 1);
              }}
            >
              Discard unsaved changes
            </button>
          </>
        )}
      </form>
      <section className="settings-section backup-section">
        <h2>
          <Database size={23} />
          Your memories belong to you
        </h2>
        <p>
          Your cooking activity is saved in this browser’s IndexedDB. It remains
          after normal restarts, but clearing site data, private browsing or
          device loss can remove it. Export a backup regularly.
        </p>
        <div className="backup-actions">
          <button className="button primary" onClick={() => void download()}>
            <Download size={18} />
            Export backup
          </button>
          <label className="button file-button">
            <Upload size={18} />
            Import backup
            <input
              type="file"
              accept=".json,application/json"
              aria-label="Import backup file"
              disabled={busy}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                await run(async () => {
                  if (file.size > 10 * 1024 * 1024)
                    throw new Error("Backup files must be smaller than 10 MB.");
                  if (file.size === 0)
                    throw new Error(
                      "This file is empty. Choose a backup exported from Settings.",
                    );
                  setPreview(await previewImport(await file.text()));
                  setImportMode("merge");
                  setConfirmReplace(false);
                  setImportError("");
                });
              }}
            />
          </label>
          <button
            className="button"
            onClick={() =>
              void run(async () => {
                if (!navigator.storage?.persist)
                  throw new Error(
                    "Persistent storage is unavailable in this browser. Export backups instead.",
                  );
                const granted = await requestPersistentStorage();
                setStorage(
                  granted
                    ? "Persistent storage was granted. Clearing browser data can still remove your kitchen."
                    : "The browser did not grant persistent storage. Your data is still stored locally; keep backups.",
                );
              })
            }
          >
            <ShieldCheck size={18} />
            Protect local storage
          </button>
        </div>
        {storage && (
          <p className="notice" role="status">
            {storage}
          </p>
        )}
        <p className="small muted">
          Backup files include private notes, preferences and any custom
          recipes. Keep them private. Merge keeps the record with the newer
          saved timestamp; ties keep your current record.
        </p>
      </section>
      <section className="settings-section">
        <h2>Your recipes</h2>
        <p>
          Recipes you’ve written yourself live in Your recipes. They are included
          in backups and removed when you delete personal data.
        </p>
        <a className="button" href="#/custom">
          Open Your recipes
        </a>
      </section>
      <CloudSettings />
      <section className="settings-section danger-section">
        <h2>A fresh start</h2>
        <p>
          Delete all personal data on this device: cooking memories, ratings,
          notes, favourites, pantry, plans, custom recipes and preferences. The
          bundled catalogue remains.
        </p>
        <button
          className="button danger-outline"
          onClick={() => {
            setReset(true);
            setResetText("");
            setResetError("");
          }}
        >
          <Trash2 size={17} />
          Delete personal data
        </button>
      </section>
      {preview && (
        <Modal title="Review your backup" onClose={() => setPreview(null)}>
          <p>This is a valid AirFuel backup. Nothing has been changed yet.</p>
          {importError && (
            <p className="notice" role="alert">
              {importError}
            </p>
          )}
          <dl className="preview-counts">
            <div>
              <dt>New records</dt>
              <dd>{preview.added}</dd>
            </div>
            <div>
              <dt>Existing IDs</dt>
              <dd>{preview.duplicates}</dd>
            </div>
            <div>
              <dt>Different versions</dt>
              <dd>{preview.conflicts}</dd>
            </div>
            <div>
              <dt>Current records</dt>
              <dd>{preview.currentCount}</dd>
            </div>
          </dl>
          <label className="stack-label">
            How should this backup be restored?
            <select
              value={importMode}
              onChange={(e) => {
                setImportMode(e.target.value as typeof importMode);
                setConfirmReplace(false);
              }}
            >
              <option value="merge">Merge with current data</option>
              <option value="replace">Replace all current personal data</option>
            </select>
          </label>
          <p className="small muted">
            Merge resolves matching IDs by saved timestamp, preserving the local
            record on a tie. Replace removes records absent from this backup.
            Import cancels if another tab changes your data after this preview.
          </p>
          {importMode === "replace" && (
            <label className="check-label">
              <input
                type="checkbox"
                checked={confirmReplace}
                onChange={(e) => setConfirmReplace(e.target.checked)}
              />
              I understand this replaces all current personal data.
            </label>
          )}
          <div className="dialog-actions">
            <button className="button" onClick={() => setPreview(null)}>
              Cancel
            </button>
            <button
              className={`button ${importMode === "replace" ? "danger" : "primary"}`}
              disabled={busy || (importMode === "replace" && !confirmReplace)}
              onClick={async () => {
                if (restoringBackup.current) return;
                restoringBackup.current = true;
                setBusy(true);
                setImportError("");
                try {
                  if (
                    await run(async () => {
                      try {
                        await importBackup(preview, importMode);
                      } catch (error) {
                        setImportError(
                          error instanceof Error
                            ? error.message
                            : "The backup could not be restored. Please try again.",
                        );
                        throw error;
                      }
                    }, "Backup restored")
                  )
                    setPreview(null);
                } finally {
                  restoringBackup.current = false;
                  setBusy(false);
                }
              }}
            >
              Restore backup
            </button>
          </div>
        </Modal>
      )}
      {reset && (
        <Modal
          title="Delete all personal data?"
          onClose={() => setReset(false)}
        >
          <p>
            This cannot be undone without a backup. Export first if you want to
            keep your memories. Cloud sync will be signed out; remote data
            remain and may download if sync is enabled again.
          </p>
          {resetError && (
            <p className="notice" role="alert">
              {resetError}
            </p>
          )}
          <button className="button" onClick={() => void download()}>
            Export backup first
          </button>
          <label className="stack-label">
            Type DELETE to confirm
            <input
              value={resetText}
              onChange={(e) => setResetText(e.target.value)}
              autoComplete="off"
            />
          </label>
          <div className="dialog-actions">
            <button className="button" onClick={() => setReset(false)}>
              Keep my data
            </button>
            <button
              className="button danger"
              disabled={resetText !== "DELETE" || busy}
              onClick={async () => {
                if (deletingData.current) return;
                deletingData.current = true;
                setBusy(true);
                setResetError("");
                try {
                  if (
                    await run(async () => {
                      try {
                        if (cloudConfigured()) await signOut();
                        await forgetCloudCache();
                        await actions.clearUserData();
                        if (!clearRecipeNoteDrafts())
                          throw new Error(
                            "Saved personal data was deleted, but this browser could not clear temporary note drafts. Clear site data to remove them completely.",
                          );
                      } catch (error) {
                        setResetError(
                          error instanceof Error
                            ? error.message
                            : "Your data could not be deleted. Please try again.",
                        );
                        throw error;
                      }
                    }, "Personal data deleted from this device")
                  ) {
                    draftDirtyRef.current = false;
                    setDraftDirty(false);
                    setFormPreferences({ ...defaultPreferences });
                    setFormRevision((revision) => revision + 1);
                    setReset(false);
                  }
                } finally {
                  deletingData.current = false;
                  setBusy(false);
                }
              }}
            >
              Delete everything personal
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
export function Help() {
  const { recipes } = useApp();
  return (
    <>
      <PageHeading
        title="Welcome to your kitchen"
        description="A few good habits for easier, safer everyday cooking."
      />
      <div className="help-grid">
        <section className="surface">
          <BookOpen size={26} />
          <h2>Make yourself at home</h2>
          <ol>
            <li>
              Browse recipes or search for an ingredient. Check the ingredients,
              servings and safety notes.
            </li>
            <li>
              Start cooking to save your checklist and timer. Increasing
              servings can require extra batches.
            </li>
            <li>
              Mark a recipe tried when you’ve made it. Rate it and save your
              personal notes.
            </li>
            <li>
              Log a cooking session to record what you actually ate. Prepared
              servings and consumed servings are separate.
            </li>
            <li>
              Plan your week, check your pantry and take the shopping list with
              you.
            </li>
            <li>Export your memories regularly in Settings.</li>
          </ol>
        </section>
        <section className="surface">
          <ShieldCheck size={26} />
          <h2>Temperature, not just time</h2>
          <p>
            Air-fryer settings are not food core temperatures. Use a clean probe
            thermometer in the thickest part: poultry 74°C; mince and pork 71°C;
            fish 63°C. Egg dishes should reach 71°C. Follow the recipe’s
            guidance and relevant package instructions.
          </p>
          <p>
            Keep raw meat separate from ready-to-eat food. Wash hands, tools and
            surfaces. Don’t wash raw poultry.
          </p>
          <p>
            Never preheat with loose baking paper. Use heat-safe accessories
            approved by their manufacturer. Don’t block circulation or overcrowd
            the basket.
          </p>
          <p>
            <a
              href="https://www.foodauthority.nsw.gov.au/media/871"
              target="_blank"
              rel="noreferrer"
            >
              NSW Food Authority temperature guidance <ExternalLink size={14} />
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          </p>
        </section>
        <section className="surface">
          <h2>About the recipes</h2>
          <p>
            {recipes.length} recipes are available in this kitchen, including
            your custom recipes. Recipe pages link to the research sources and
            show the source-check date. Instructions are adapted for AirFuel.
            Source checks confirm the research sources, not that AirFuel’s
            adaptation has been kitchen-tested.
          </p>
          <p>
            The collection includes sides and sweets as well as protein-rich
            meals. The protein filters use the actual estimate per serving,
            never a label chosen to make the recipe qualify.
          </p>
          <p>
            Metric quantities refer to the stated ingredient form. Australian
            tablespoons are 20 ml and teaspoons are 5 ml. A raw weight is not
            interchangeable with a cooked weight.
          </p>
        </section>
        <section className="surface">
          <h2>Nutrition & food images</h2>
          <p>
            Nutrition is estimated per serving, usually based on a publisher’s
            declared calculation with equivalent ingredient proportions. The
            exact method and limitations appear on each recipe. Brands, cooking
            losses, optional sides and substitutions can change the result.
          </p>
          <p>
            Food pictures are AI-generated category illustrations, not
            photographs of these specific recipes. Always use the written
            ingredient list.
          </p>
          <p>
            Allergen tags support filtering but cannot establish a safe supply
            chain. Check package labels and your own preparation environment.
          </p>
        </section>
        <section className="surface">
          <h2>Offline and private by default</h2>
          <p>
            Visit while online once and let the app finish caching. Then you can
            reopen the saved app, browse recipes and keep cooking notes offline.
            Install it from your browser menu where supported.
          </p>
          <p>
            The timer remembers its finish time, but a sleeping or closed
            browser cannot guarantee an alarm. Check food independently.
          </p>
          <p>
            No advertising or analytics are included. Source links leave the app
            and need an internet connection.
          </p>
        </section>
        <section className="surface">
          <h2>Recommendations you can understand</h2>
          <p>
            Local rules score recipes using your preferences, ratings, pantry,
            recency and variety. Saved allergen and dietary exclusions are
            checked first. No paid AI model is used.
          </p>
          <p>
            Pantry matching uses names, forms and units. It suggests useful
            overlaps; it does not claim you have every ingredient or enough of
            each.
          </p>
          <a className="button" href="#/settings">
            Set up my kitchen
          </a>
        </section>
      </div>
    </>
  );
}
