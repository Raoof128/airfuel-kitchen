# Architecture

AirFuel is a static React/TypeScript application built by Vite. The existing stack was retained for the upgrade. Local cooking does not require a server account, API key or network connection after the production build is cached.

## Boundaries and flow

`src/data/catalogue.ts` validates the two immutable 150-recipe JSON catalogues. `effectiveRecipes` combines those records with validated personal recipes and conservative overrides. Canonical files never receive user writes.

`src/lib/schema.ts` owns runtime contracts. `src/lib/db.ts` owns Dexie transactions, the version 1→2 migration, backups and guarded mutations. `useKitchen` exposes a consistent database snapshot and observes other tabs. Components call these actions through `run`, which reports persistence failures and tracks pending writes.

`src/lib/engine.ts` provides pure search, recommendation, scaling, planning and shopping calculations. Recipes, ingredient forms and servings remain explicit; preparation and tried status never imply consumed nutrition.

`src/App.tsx` owns hash navigation, the application shell, appearance, update prompts and storage feedback. Filter changes replace the current URL without remounting inputs; actual hash navigation increments a route revision. Mobile navigation uses the shared native-dialog component with explicit keyboard wrapping and focus restoration.

`CookMode.tsx` and `CookingTimer.tsx` reuse `activeCooking`; there is no second cooking-state store. Checklists update membership against the latest transaction state. Recipe switches compare the expected active recipe before replacing it. Absolute deadlines survive reload and background throttling; interval ticks only redraw. Timer completion is a reminder, not a food-safety measurement or a closed-app alarm. Optional wake locks release on exit or when the cook ends elsewhere.

## Temporary versus saved state

Saved memories live in IndexedDB and versioned exports. Unsubmitted recipe-note drafts are bounded plain text in sessionStorage for the current tab. They are explicitly labelled unsaved and excluded from backups. Saving commits to IndexedDB and removes the draft. Confirmed personal-data deletion clears drafts in current/open tabs using BroadcastChannel with a storage-event fallback. A content-free reset marker invalidates suspended tabs' older drafts when they return.

Settings preserve dirty values when another tab writes preferences. Saving applies only fields changed from the draft's baseline, preserving unrelated updates. A discard control restores the latest saved settings. Concurrent edits to the same field use the last committed explicit change; no collaborative text merge is claimed.

## Assets, offline and presentation

All category illustrations and fonts are local. The Vite PWA plugin precaches built assets and presents an update prompt. Development and production previews are separate origins and therefore separate personal-data stores. Use exports to transfer data deliberately.

`styles/tokens.css` holds semantic light/dark design tokens. `styles.css` supplies shared and page foundations; `styles/kitchen.css` implements the editorial upgrade and responsive composition; `styles/cook-mode.css` scopes focused cooking. Reusable cards, images, dialogs, empty states and checkboxes are in `components/UI.tsx`.

## Security and limits

Imported records are validated before any transaction; backup previews are bound to both the content and current database state. Source URLs are HTTPS and images use allowed local paths. Notes remain React text, never interpreted HTML. Different active recipes cannot be silently replaced by stale timer/checklist calls. There is no analytics collector or client secret.

Guards compare recipe identity, not a new session-generation identifier. They prevent different-recipe corruption; the data model does not provide distributed locking of every edit within consecutive cooks of the same recipe. Browser storage and the system clock remain environmental dependencies.

The optional Supabase module is separate, opt-in and unconfigured. Its mock queue and SQL boundary checks do not prove live authentication or isolation. See [CLOUD.md](CLOUD.md) for the required live qualification, and [DATA-AND-MEMORY.md](DATA-AND-MEMORY.md) for the full schema, migration, backup and calculation contracts.
