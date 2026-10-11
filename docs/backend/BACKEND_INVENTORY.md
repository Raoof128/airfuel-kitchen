# Backend inventory

Owner: inventory agent. Baseline: HEAD `3dea492`. Line numbers are HEAD unless marked (WT). Findings are in `findings/inventory.md` (prefix ARCH); per-function dispositions are in `FUNCTION_AUDIT.md`.

AirFuel Kitchen is local-first. There is no application server. The backend is the browser IndexedDB store (Dexie), the domain engine, and an optional Supabase sync path that is not configured.

## A. Module table

| Module | File path | Responsibility | Dependencies | Risk | Audit | Tests |
| --- | --- | --- | --- | --- | --- | --- |
| Dexie database and schema | `src/lib/db.ts:32-88` | `KitchenDB` with 9 tables, schema v1 and v2, v2 upgrade (`servingsConsumed` default, preference defaults) | dexie, `schema.ts`, `engine.localDate` | P1 (persistence) | ARCH-9 | `db`, `upgrade-interactions`, `backend-storage-migration` |
| Write actions API | `src/lib/db.ts:183-522` (`createActions`), `:523` (`actions`) | 24 members that validate with zod and write in one IndexedDB transaction each; cross-tab guards on cooking | zod, Dexie | P1 | FUNCTION_AUDIT | `db`, `notes-concurrency`, `write-errors`, `integration-hardening`, `session-rating`, `shopping-*`, `upgrade-interactions`, `backup-*`, `backend-storage-*` |
| Live read and full snapshot | `src/lib/db.ts:101-121` (`readKitchen`, `useKitchen`) | Reads all 9 tables in one `r` transaction; `useKitchen` re-runs it on every change | `dexie-react-hooks` | P3 (full-table reads per change) | ARCH-15 | indirect |
| Generated shopping retention | `src/lib/db.ts:127-149` | Deletes generated shopping ticks for weeks older than 28 days | Dexie `startsWith` on primary key | P3 | RT-3 | `shopping-prune` |
| Write error normalisation | `src/lib/db.ts:150-182` | Maps zod and quota errors to readable messages; wraps every action | zod | P2 (raw cloud text is not normalised; ARCH-13) | ARCH-13 | `write-errors` |
| Backup export | `src/lib/db.ts:524-538` | Serialises all 9 tables into `format: airfuel-kitchen, version: 2` | `backupSchema` | P2 | FUNCTION_AUDIT | `backup-*`, `db`, `backend-storage-backup`, `backend-security-integrity` |
| Backup preview | `src/lib/db.ts:539-627` | Size cap 20 MB, JSON and schema checks, duplicate-ID check, added/duplicate/conflict counts, fingerprint | `backupSchema`, `TextEncoder` | P2 | FUNCTION_AUDIT | `backup-preview-conflicts`, `backup-schema-errors`, `backend-security-input` |
| Backup import | `src/lib/db.ts:628-665` | Merge (newer `updatedAt` wins per row) or replace (clear and put, one transaction); preview must match the current fingerprint | `backupSchema`, fingerprint | P1 (restore path; merge can stop an active cook, ARCH-4) | ARCH-4 | `backup-all-tables`, `backup-preview-conflicts`, `backend-storage-backup`, `backend-security-integrity` |
| Persistent storage request | `src/lib/db.ts:666-669` | `navigator.storage.persist()` | browser API | P3 | FUNCTION_AUDIT | none (called once from Settings) |
| Schema and validation | `src/lib/schema.ts` (312 lines) | zod v4 schemas for all 9 tables, recipe, ingredient, nutrition, backup; limits; timezone check; `strict()` objects | zod | P2 (limits differ from server payload bound, ARCH-6) | ARCH-6 | 12 importers of `schema.ts` across unit tests |
| Domain engine | `src/lib/engine.ts` | Overrides merge (`effectiveRecipes`), filters, recommendations, scaling, nutrition sums, shopping aggregation and display, dates | `schema.ts`, `Intl` | P2 (override snapshot freezes non-safety fields, ARCH-9) | FUNCTION_AUDIT | `engine`, `search-words`, `shopping-amounts`, `format-amount`, `integration-hardening`, `backend-engine-*`, `backend-storage-invariants`, `backend-security-*` |
| Note drafts | `src/lib/noteDrafts.ts` | Per-tab unsaved note drafts in `sessionStorage`; cross-tab "clear drafts" via `localStorage` marker and `BroadcastChannel` | browser storage APIs | P3 | FUNCTION_AUDIT | `note-drafts` |
| Navigation memory | `src/lib/navigation.ts` | Remembers the last Explore or Favourites hash in `sessionStorage`, restricted to two route patterns | browser storage | P3 | FUNCTION_AUDIT | none |
| Lib barrel | `src/lib/index.ts` | Re-exports `schema`, `db`, `engine`; used by App and pages | - | P3 | - | - |
| Catalogue loader | `src/data/catalogue.ts` | Eager `import.meta.glob` of two JSON files, validates each with `recipeSchema`, checks duplicate IDs | Vite `import.meta.glob` | P2 (whole catalogue validated before first paint; PERF-2) | PERF-2 | `catalogue` data tests (2 files) |
| Recipe data | `src/data/recipes-savoury.json`, `src/data/recipes-plant.json` (300 recipes), `research/` | Canonical catalogue and source evidence | `scripts/validate-data.ts` | P2 (data, not edited by sweep) | - | `npm run validate:data` |
| Cloud sync core | `src/cloud/core.ts` | `validateWire`, `stableStringify`, `compareVersion`, `SyncDB`, `SyncEngine` (`bind`, `scanLocal`, `acceptRemote`, `run`, write-ahead receipts) | Dexie, zod, `db.ts` | P1 (poison pill, ARCH-1; baseline reset, ARCH-2; permanent block, ARCH-23) | ARCH-1, ARCH-2, ARCH-23 | `cloud`, `backend-sync-engine` |
| Supabase adapter | `src/cloud/supabase.ts` | `parseCloudConfig` (https, publishable or anon-role JWT only), `createCloudClient` (20 s fetch timeout), `createSupabaseAdapter` `apply` (RPC) and `readAll` (paged) | `@supabase/supabase-js`, `core.ts` | P2 (ARCH-6, pagination under concurrent writes) | ARCH-6 | `cloud`, `backend-sync-rls` |
| Cloud orchestration and status | `src/cloud/index.ts` | `cloudConfigured`, `useCloudStatus`, `signIn`, `enableSync`, `syncNow` (Web Locks, backoff, online retry), `signOut`, `forgetCloudCache` | `core.ts`, `supabase.ts`, `db.ts`, `zod` | P1 (forget path, ARCH-2; account-switch message, ARCH-7) | ARCH-2, ARCH-7, ARCH-19 | `backend-sync-transport.test.ts` (WT): `forgetCloudCache`, `syncDisplayState` only |
| Cloud UI | `src/components/CloudSettings.tsx`, `src/pages/Settings.tsx` (cloud section) | Sign-in form, enable and sync buttons, status copy | `cloud/index.ts` | P2 | - | e2e only |
| Supabase SQL | `supabase/migrations/202610110001_airfuel_sync.sql` | Table `airfuel_user_records`, RLS, RPC `airfuel_apply_change`, grants | Supabase auth schema | P1 (latent; depends on owner `BYPASSRLS`, ARCH-5) | ARCH-5 | PGlite checks (inventory scripts); `backend-sync-rls` |
| Service worker and PWA | `vite.config.ts:4-50` (`VitePWA`) | `registerType: prompt`, precache globs (js, css, html, svg, webp, png, woff2, json), 8 MB per-file cap, `navigateFallback`, `cleanupOutdatedCaches` | `vite-plugin-pwa`, workbox | P2 (3.25 MB precache including all recipe JSON; PERF-6) | PERF-6 | e2e (offline unverified; RT-7) |
| Build chunking | `vite.config.ts:52-68` | Splits recipes, Supabase and vendor chunks | Rolldown | P3 | PERF-5 | none |
| Environment | `.env.example`, `src/cloud/index.ts:12-18` | `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, legacy `VITE_SUPABASE_ANON_KEY` | Vite env | P2 (checked in `parseCloudConfig`) | - | `cloud` |
| Theme bootstrap | `index.html` inline script, `src/App.tsx:73,166` | Reads `airfuel-theme` from `localStorage` before paint; App writes it | browser storage | P3 | SHELL-1 | e2e |
| Page-level logic (leakage) | `src/pages/CustomRecipes.tsx`, `CookMode.tsx`, `Planning.tsx`, `RecipeDetail.tsx`, `Settings.tsx`; `src/components/CookingTimer.tsx`, `SessionForm.tsx` | Core-temperature rule, ingredient parser, timer transitions, shopping row building, multi-row writes, validation | `db.ts` actions, engine | P2 (ARCH-3, ARCH-8, ARCH-12) | ARCH-3, ARCH-8, ARCH-12 | `custom-ingredients`, `cook-mode-logic` import pages or components directly |

Dependency direction check: no page or component imports Dexie tables directly. All writes go through `actions`, `exportBackup`, `previewImport`, `importBackup`, or `requestPersistentStorage`. The only direct Dexie use outside `db.ts` is `src/cloud/core.ts` (`SyncDB`, `this.local.transaction`), which is intended. Circular imports: none (`madge`).

## B. Dexie tables and indexes

| Table | Primary key | Declared indexes | Indexes used by a query | Validated by | In backup | In sync |
| --- | --- | --- | --- | --- | --- | --- |
| `recipeStates` | `id` (recipe id) | `updatedAt` | none | `recipeStateSchema` | yes | yes (`viewedAt` included) |
| `sessions` | `id` | `recipeId`, `date`, `updatedAt` | none | `sessionSchema` | yes | yes |
| `plans` | `id` | `date`, `recipeId`, `updatedAt` | none | `planSchema` | yes | yes |
| `pantry` | `id` | `updatedAt` | none | `pantrySchema` | yes | yes |
| `shopping` | `id` | `updatedAt` | primary-key `startsWith("week-")` in `pruneStaleGeneratedShopping` | `shoppingSchema` | yes | yes |
| `customRecipes` | `id` (`custom-*`) | `updatedAt` | none | `customRecipeSchema` | yes | yes |
| `overrides` | `id` (recipe id) | `updatedAt` | none | `overrideSchema` | yes | yes |
| `preferences` | `id` = `"preferences"` | none | key lookup | `preferenceSchema` | yes | yes |
| `activeCooking` | `id` = `"active"` | none | key lookup | `activeCookingSchema` | yes | yes |

Secondary indexes on `sessions`, `plans`, and every `updatedAt` are maintained on every write but no query uses them (`grep .where(` finds one use, on the primary key). Removing them needs a Dexie version bump, so it is recorded as ARCH-15 and not changed.

Sync metadata (`airfuel-kitchen-sync`): `records` (key `JSON.stringify([entity, recordId])`; fields `entity, recordId, fingerprint, revision, operationId, pending?, incoming?`) and `meta` (key `binding`, value `"<url>|<userId>"`).

## C. Write actions API (`createActions`, HEAD `db.ts:183-522`)

Every member except the two `readKitchen`-style helpers is wrapped by `withUserErrors` (`db.ts:165-181`). External reference counts are from `src/` excluding `db.ts`.

| Action | Table(s) | Validation | Transaction | External refs | Tests (unit) |
| --- | --- | --- | --- | --- | --- |
| `patchRecipeState(recipeId, patch)` | recipeStates | zod `pick().partial()` | rw recipeStates; sets `triedAt`; bumps `updatedAt` only for memory edits, not `viewedAt` alone | 3 | many (db, notes-concurrency, backend-storage-*) |
| `saveRecipeNotes(recipeId, notes, expected)` | recipeStates | notes and expected max 10000 | rw; compare-and-set on notes | 1 (RecipeDetail) | notes-concurrency, backend-storage-invariants, backend-security-input |
| `toggleRecipeState(recipeId, field)` | recipeStates | enum `favourite \| tried` | rw; inverts inside transaction | 3 | upgrade-interactions, write-errors, backend-storage-invariants |
| `deleteRecipeState(recipeId)` | recipeStates | none | none (single delete) | **0** | backend-sync-engine, cloud (sync path only) |
| `saveSession(input)` | sessions | `sessionSchema` | single put | **0** (used only inside `saveCookingSession`) | backup-all-tables, backend-storage-* |
| `saveCookingSession(input, complete)` | sessions, recipeStates, activeCooking | `sessionSchema`; boolean | rw on three tables; sets `tried`; optional `rating`; clears active cook for same recipe | 1 (SessionForm) | session-rating, upgrade-interactions, integration-hardening |
| `deleteSession(id)` | sessions | none | none | 1 (Journal) | backend-storage-invariants |
| `savePlan(input)` | plans | `planSchema` | single put via `save` | 2 | backup-all-tables, backend-storage-* |
| `deletePlan(id)` | plans | none | none | 1 (Planning) | **none** |
| `savePantry(input)` | pantry | `pantrySchema` | single put | 1 (Planning) | shopping-tick-persistence, backup-all-tables, backend-storage-* |
| `deletePantry(id)` | pantry | none | none | 1 (Planning) | **none** |
| `saveShopping(input)` | shopping (+ prune) | `shoppingSchema`; clears `checked` when a manual row's name, quantity, unit or form changes | rw; runs `pruneStaleGeneratedShopping` on every save | 4 (RecipeDetail, Planning) | shopping-tick-persistence, shopping-prune, integration-hardening, write-errors, backup-all-tables |
| `deleteShopping(id)` | shopping | none | none | 2 (Planning) | **none** |
| `savePreferences(patch)` | preferences | `preferenceSchema` partial; timezone checked by `Intl` | rw | 2 (Settings) | db, backup-all-tables |
| `saveCustomRecipe(recipe)` | customRecipes | `customRecipeSchema` (custom- prefix, id match) | single put | 1 (CustomRecipes) | backend-storage-*, backup-all-tables |
| `deleteCustomRecipe(id)` | customRecipes | none | none | 1 (CustomRecipes) | backend-storage-invariants |
| `saveOverride(recipeId, patch, base?)` | overrides | `recipeSchema` on merged value; `overrideSchema` | rw; merges against prior or base recipe (full snapshot) | 1 (RecipeDetail) | backup-all-tables, backend-storage-* |
| `deleteOverride(id)` | overrides | none | none | 1 (RecipeDetail) | **none** |
| `startCooking(recipeId, servings, expected)` | activeCooking | `activeCookingSchema` fields; expected nullable | rw; conditional on expected active recipe | 1 (CookMode) | upgrade-interactions, write-errors, backend-storage-backup |
| `stopCooking(expected)` | activeCooking | expected must be a recipe id | rw; conditional delete | 1 (RecipeDetail) | upgrade-interactions, write-errors |
| `patchActiveCooking(recipeId, patch, defaultServings, expected)` | activeCooking | partial `activeCookingSchema` | rw; throws when another recipe is cooking; **creates a row when none exists** (ARCH-3) | 3 (CookingTimer, RecipeDetail, CookMode) | upgrade-interactions, write-errors, integration-hardening |
| `setCookingCheck(recipeId, kind, index, checked, defaultServings, expected)` | activeCooking | enum, int 0-99, boolean | rw; delegates to `patchActiveCooking` | 4 (RecipeDetail, CookMode) | upgrade-interactions, integration-hardening |
| `saveActiveCooking(input \| null)` | activeCooking | `activeCookingSchema` | unconditional put or delete, **no cross-tab guard** | **0** | backup-all-tables only |
| `clearUserData()` | all 9 | none | rw on all tables | 1 (Settings delete flow) | backup-all-tables, db |

## D. Engine exports (`src/lib/engine.ts`, HEAD)

| Export | Line | Used by | Unit tests |
| --- | ---: | --- | --- |
| `effectiveRecipes(catalogue, data)` | 28 | App.tsx | engine, integration-hardening, backend-storage-invariants, backend-engine-safety, backend-security-integrity |
| `filterRecipes(recipes, filters, states)` | 76 | Explorer, Planning | engine, search-words, backend-engine-search, backend-engine-safety |
| `recommendRecipes(recipes, data, mode)` | 152 | Dashboard, Explorer | engine, backend-engine-safety, backend-engine-scenarios |
| `scaleIngredients(recipe, servings)` | 306 | RecipeDetail, CookMode; also inside `buildShoppingList` | engine, integration-hardening |
| `plannedNutrition(plans, recipes)` | 349 | Planning | engine, backend-storage-invariants |
| `consumedNutrition(sessions, recipes)` | 358 | Journal, Dashboard | engine, backend-engine-scenarios, backend-storage-invariants |
| `ingredientKey(item)` | 383 | `buildShoppingList` only | none direct |
| `buildShoppingList(plans, recipes, pantry, saved)` | 390 | Planning | shopping-tick-persistence, engine, integration-hardening, backend-storage-invariants |
| `formatShoppingAmount(qty, unit)` | 477 | Planning | shopping-amounts |
| `localDate(date?, tz?)` | 495 | 15 call sites | engine |
| `weekDates(date?)` | 508 | Dashboard, Planning | engine |

Non-exported helpers that matter for review: `allergenClosure` (gluten and wheat are closed together), `mentions` (multi-word whole-word match), `sumNutrition` (missing recipes counted, not zero), `baseUnit` (tsp = 5 ml, tbsp = 20 ml).

## E. Other exports

| Module | Exports | Consumers |
| --- | --- | --- |
| `noteDrafts.ts` | `readRecipeNoteDraft`, `writeRecipeNoteDraft`, `removeRecipeNoteDraft`, `clearRecipeNoteDrafts`, `subscribeToDraftReset` | RecipeDetail, Settings (delete flow), App |
| `navigation.ts` | `rememberExplore`, `exploreReturnLocation` | Explorer, RecipeDetail |
| `cloud/core.ts` | `Entity`, `WireRecord`, `validateWire`, `stableStringify`, `compareVersion`, `SyncDB`, `CloudAdapter`, `SyncEngine` | cloud/index, cloud/supabase, tests |
| `cloud/supabase.ts` | `CloudConfig`, `parseCloudConfig`, `createCloudClient`, `createSupabaseAdapter` | cloud/index, tests |
| `cloud/index.ts` | `cloudConfigured`, `CloudStatus`, `useCloudStatus`, `signIn`, `enableSync`, `syncNow`, `signOut`, `forgetCloudCache` | CloudSettings, Settings |

## F. Import and export

- Export: `exportBackup` (`db.ts:534`) serialises all 9 tables with `backupSchema.parse`; the Settings page downloads it as JSON. Schema is strict and `version: 2`.
- Import preview: `previewImport` (`db.ts:562`). Enforces a 20 MB cap, valid JSON, `backupSchema`, unique IDs per table, then counts added, duplicate and conflicting rows. Conflicts ignore `viewedAt`.
- Import apply: `importBackup` (`db.ts:628`). Requires the same preview object and a matching fingerprint of current data. Replace clears and puts every table in one transaction. Merge puts a row only when it is new or has a greater `updatedAt`.
- Backup format is shared with the cloud path only indirectly (the cloud uses per-record wire records, not backups).

## G. Service worker and PWA (`vite.config.ts`)

- `registerType: "prompt"`: the user is asked before the new worker takes over.
- Precache globs: `**/*.{js,css,html,svg,webp,png,woff2,json}`. This includes both recipe JSON files and all images. Per-file cap 8 MB.
- `navigateFallback: "/index.html"`. No `runtimeCaching`. No API responses are cached, so Supabase traffic and user data never enter Cache Storage.
- Manifest: name "AirFuel Kitchen", standalone display, icons from `public/`.
- Offline behaviour is covered only by the e2e suite and is listed as unverified in RT-7.

## H. Browser storage keys

| Store | Key | Written by | Contents | Cleared by |
| --- | --- | --- | --- | --- |
| IndexedDB `airfuel-kitchen` | 9 tables | `db.ts` actions | All user data | `clearUserData`, replace import |
| IndexedDB `airfuel-kitchen-sync` | `records`, `meta` | `cloud/core.ts`, `cloud/index.ts` | Per-record fingerprints, pending and incoming wire records (duplicates personal content), binding | `forgetCloudCache` clears `records`; `binding` is kept |
| localStorage | `airfuel-theme` | App (`App.tsx:166`) | `light`, `dark` or `system` | not cleared by delete flow |
| localStorage | `airfuel-note-draft-reset` | `noteDrafts.ts` | JSON `{type, version, id}` with no note text | never |
| localStorage | `airfuel-supabase-auth:<host>` | Supabase SDK (persisted when not using a passed token) | Session | `signOut` (scope local) |
| sessionStorage | `airfuel-note-draft:<recipeId>` | `noteDrafts.ts` | Unsaved note text | `clearRecipeNoteDrafts`, reset broadcast |
| sessionStorage | `airfuel-note-draft-reset-seen` | `noteDrafts.ts` | Last reset ID seen by this tab | with drafts |
| sessionStorage | `airfuel-explore-location` | `navigation.ts` | Hash of Explore or Favourites | not cleared by delete flow |
| BroadcastChannel | `airfuel-note-drafts` | `noteDrafts.ts` | Reset message (ID only) | n/a |
| Web Locks | `airfuel-cloud-sync` | `cloud/index.ts` | Mutual exclusion for sync passes | n/a |
| Cache Storage | Workbox precache | service worker | Built app shell and recipe JSON | service worker cleanup |

The first localStorage key is read by an inline script in `index.html` before first paint.

## I. External integrations

| Integration | Where | Data sent | Status |
| --- | --- | --- | --- |
| Supabase (Auth and PostgREST and RPC) | `cloud/supabase.ts`, `cloud/index.ts` | Email and password at sign-in; per-record wire payloads for sync (notes, preferences, cooking activity, `viewedAt`) | Optional. Not configured. |
| NSW Food Authority | `src/pages/Settings.tsx:774` and `src/pages/CustomRecipes.tsx:544,569,1019-1021` | None (hyperlink only; default source link text) | Link only |
| Fonts | `src/main.tsx:3-9` (`@fontsource/dm-sans`, `@fontsource/fraunces`) | None (self-hosted) | Local |
| Clipboard | `src/pages/RecipeDetail.tsx:407` (`navigator.clipboard.writeText(location.href)`) | None | Local |

No analytics, no third-party scripts, no runtime `fetch` outside the Supabase client.

## J. Privileged operations

| Operation | Entry point | Guard | Notes |
| --- | --- | --- | --- |
| Delete all personal data | Settings: `signOut` (if configured), `forgetCloudCache`, `clearUserData`, `clearRecipeNoteDrafts` | Refuses while sync enabled or running; signs out first | Clears sync outbox; cloud data not touched (documented). See ARCH-2. |
| Replace import | `importBackup(preview, "replace")` | Preview token and fingerprint; one transaction | Overwrites everything |
| Merge import | `importBackup(preview, "merge")` | Same, plus newer-wins per row | Can replace the current active cook (ARCH-4) |
| Enable cloud sync | `enableSync` | Requires session, Web Locks, account binding per browser | First sync overwrites same-ID local rows (LOGIC-10) |
| Sign out | `signOut` | Refused while sync runs | `scope: local` |
| Upload record | `airfuel_apply_change` RPC | Supabase JWT, `auth.uid()`, revision and operation ordering | Owner `BYPASSRLS` precondition (ARCH-5) |
| Read own records | `airfuel_user_records` select | RLS `auth.uid() = user_id`; grant to `authenticated` only | Good |
| Persistent storage | `requestPersistentStorage` | Browser permission | Settings only |

## K. Dead code, unused exports and dependencies

Checked with `grep` over `src/` and `tests/`, and with `ts-prune@0.10.3 -p tsconfig.app.json`.

Actions with zero external call sites: `deleteRecipeState`, `saveSession` (only used internally), `saveActiveCooking`. `saveActiveCooking` also writes without the cross-tab guard. See ARCH-10.

Exports that `ts-prune` lists as unused but that have consumers through the barrel or dynamic paths: `useCloudStatus`, `signIn`, `enableSync`, `forgetCloudCache` (used by `CloudSettings` and `Settings`), and the `src/lib/index.ts` re-exports. These are false positives.

Exports with no unit test: `coreTemperatureRequirement` (food-safety minimum core temperature, `CustomRecipes.tsx:214`), `ingredientKey`, `deletePlan`, `deletePantry`, `deleteShopping`, `deleteOverride`, `requestPersistentStorage`, `navigation.ts` (both functions), and everything in `cloud/index.ts`.

Dependencies declared but not used:
- `eslint-plugin-react-hooks` (in devDependencies). `eslint.config.js` does not register it, so hook rules are not enforced.
- `prettier` (devDependencies). No config file and no script uses it.
- `@fontsource/*` is used (via side-effect CSS imports in `main.tsx`), so it is not unused.
- `sharp`, `tsx`, `globals`, `@axe-core/playwright`, `vite-plugin-pwa`, `typescript-eslint`, `@eslint/js` are used by scripts, config or e2e.
- `@electric-sql/pglite` was added to devDependencies during the sweep by another agent. It is used only by the inventory SQL check scripts and the sync RLS tests (if they import it).

## L. Test coverage gaps (backend)

- `src/cloud/index.ts`: `forgetCloudCache` and `syncDisplayState` are tested in WT (`backend-sync-transport.test.ts`). `signIn`, `enableSync`, sync scheduling, sign-out and the auth listener are not (ARCH-19).
- `src/lib/navigation.ts`: no tests.
- `coreTemperatureRequirement` (food-safety rule in a page): no unit test. The e2e app spec checks the 74 °C text only.
- Multi-row page writes (`addShopping` in RecipeDetail, `clearTicked` in Planning): no test that a failure mid-loop leaves a consistent state (ARCH-12).
- Migration: no repo test runs the SQL. Other agents' `backend-sync-rls.test.ts` documents the owner precondition but does not execute the migration on a database (check its implementation before relying on it).

## M. Derived data and rebuild rules

- `overrides`: each row stores a full copy of the recipe taken at creation. Safety fields are merged against the live catalogue in `effectiveRecipes` (internal temperature takes the maximum, allergens union, dietary intersection, safety union). Nutrition, ingredients, title and steps are frozen. A later catalogue correction does not reach a user who has overridden that recipe. The storage test suite asserts this as intended (`backend-storage-invariants.test.ts`). Recorded as ARCH-9 DECISION.
- `shopping` generated rows: derived from `plans`, `pantry` and the recipe catalogue, and persisted as full snapshots (name, aisle, unit) when ticked. Only `checked` and `quantity` are used on read. The stored name and aisle are never rebuilt. ARCH-16.
- `shopping` IDs for generated rows are `week-<monday>:generated:<json>`. The regex `^week-(\d{4}-\d{2}-\d{2}):` in `db.ts:131` depends on this format in `Planning.tsx:478`. Two modules hold the contract, with no shared constant.
- `sync` fingerprints (`records.fingerprint`) are derived from the local row at the last acknowledged state. They are the only baseline for change detection. Clearing them changes behaviour (ARCH-2).

## N. Errors and types

- `as any`: 0. `as unknown as`: 0. `eslint-disable`, `@ts-ignore`, `@ts-expect-error`: 0.
- `as` casts in `src/`: 28. Most are DOM element casts. Form-data casts to domain types (`Settings.tsx:158,164,165`, `Planning.tsx:348`, `CustomRecipes.tsx:509,960`) are checked afterwards by zod in the action layer, so they are safe but unchecked at the call site (ARCH-18).
- Non-null `!`: 14 uses. Acceptable ones are guarded (for example `db.ts:658` inside a `has` check, `noteDrafts.ts:56`). `engine.ts:505` (`formatToParts(...).find(...)!`) assumes the locale formatter emits a part; `RecipeDetail.tsx:264` uses `recipe!` inside a branch already guarded by `if (!recipe)`.
- Error abstraction: `withUserErrors` covers action functions only. Cloud errors from Supabase are shown raw in `cloud/index.ts:250-262`. Some same-tab messages say "in another tab" (`db.ts:283`, `startCooking` in the same tab). ARCH-13.
