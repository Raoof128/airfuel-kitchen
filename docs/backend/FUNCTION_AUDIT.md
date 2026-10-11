# Function audit (final)

Compiled 2026-10-11 from the inventory draft (`FUNCTION_AUDIT.md` draft, HEAD `3dea492`) and every agent's audited dispositions in `docs/backend/findings/`. Later rounds supersede earlier dispositions.

Status codes: **KEEP** (reviewed, no defect), **FIXED** (defect fixed; finding and tests cited), **DECISION** (owner or lead call), **DEAD** (no caller), **OPEN** (defect still present), **NEW** (added in this sweep), **TEST-GAP** (behaviour untested; function looks right). Line numbers are approximate; names are the reliable reference.

Test references are unit test files under `tests/unit/` unless marked. Test names are abbreviated.

## 1. Write actions (`src/lib/db.ts`, `createActions`)

| Function | Final disposition | Finding IDs | Test reference |
| --- | --- | --- | --- |
| `patchRecipeState` | KEEP | STO-2 (fingerprint); viewing is not a change | backend-storage-backup (preview between view and import); notes-concurrency |
| `saveRecipeNotes` | KEEP | LOGIC-1 (frontend) | notes-concurrency; backend-storage-invariants (two stale tabs) |
| `toggleRecipeState` | KEEP | parity under concurrent presses | backend-storage-invariants (31 and 29 presses); upgrade-interactions |
| `deleteRecipeState` (API member) | DEAD | ARCH-10 (OPEN): remove from API; still at `db.ts` line ~417 | none |
| `saveSession` (API member) | DEAD | ARCH-10 (OPEN): remove from API; still at `db.ts` line ~463; used internally by `saveCookingSession` | backup-all-tables, backend-storage-* (seeding) |
| `saveCookingSession` | KEEP | atomic session, tried and rating; rollback verified | session-rating; upgrade-interactions; backend-storage-invariants |
| `deleteSession` | KEEP | keeps recipe state and other sessions | backend-storage-invariants |
| `savePlan` | KEEP | plans may point at missing recipes; nutrition and shopping skip them | backend-storage-invariants (missing recipe) |
| `deletePlan` | TEST-GAP | none recorded | none |
| `savePantry` | KEEP | `pantrySchema` strict | backend-storage-*; shopping-tick-persistence |
| `deletePantry` | TEST-GAP | none recorded | none |
| `saveShopping` | KEEP | prunes generated rows older than 28 days (STO, PLAN-3) | shopping-prune; shopping-tick-persistence; integration-hardening |
| `saveShoppingBatch` | NEW (ARCH-12, FIXED) | one `rw` transaction; invalid row writes nothing | backend-storage-cook-shopping, ARCH-12 block (7 tests) |
| `clearTickedShopping` | NEW (ARCH-12, FIXED) | one transaction; deletes ticked manual, unticks ticked generated for the week | backend-storage-cook-shopping, ARCH-12 block |
| `deleteShopping` | TEST-GAP | used by the planner's clear flow, now replaced by `clearTickedShopping` | none direct |
| `savePreferences` | KEEP | partial merge; timezone checked; v2 upgrade fills defaults | db; backend-storage-backup |
| `saveCustomRecipe` | KEEP | strict; ARCH-6 (size bound) OPEN; SEC-3 cap applied | backend-storage-limits (cap); backend-security-input |
| `deleteCustomRecipe` | DECISION | STO-7: history kept on purpose | backend-storage-invariants |
| `saveOverride` | DECISION | STO-6 / ARCH-9: frozen full copy; catalogue corrections do not reach it | backend-storage-invariants (asserts intended behaviour); backend-engine-safety |
| `deleteOverride` | TEST-GAP | none recorded | none |
| `startCooking` | KEEP | conditional on expected id; cross-tab tested | upgrade-interactions; write-errors; backend-storage-recipe-checks (seeding) |
| `stopCooking` | KEEP | conditional on expected id | upgrade-interactions; write-errors |
| `patchActiveCooking` | FIXED | ARCH-3: creates a cook only with an explicit start; refusal wording neutral | backend-storage-cook-shopping, ARCH-3 block |
| `setCookingCheck` | FIXED | ARCH-3: refuses with nothing cooking; recipe-page ticks go through `setRecipeCheck` | backend-storage-cook-shopping; upgrade-interactions |
| `setRecipeCheck` | NEW (ARCH-3 revised, FIXED) | writes only `recipeStates.checks`; never touches `activeCooking`; bounded by length | backend-storage-recipe-checks (18 tests) |
| `saveActiveCooking` | FIXED, still DEAD and a hazard | STO-8 guard when expected id passed; omitted argument still bypasses (ARCH-10, OBS-3, OPEN) | backend-storage-active-guard (4 tests) |
| `clearUserData` | KEEP | clears all nine tables in one transaction; delete-all flow (SEC-11, LEAD-B10) | backup-all-tables; db; backend-sync-controller (delete-all) |

## 2. Backup, restore and validation (`src/lib/db.ts`)

| Function | Final disposition | Finding IDs | Test reference |
| --- | --- | --- | --- |
| `readKitchen` / `useKitchen` | KEEP (full-table reads, debt) | ARCH-15 (WONT-FIX, deferred) | session-rating; notes-concurrency; indirect |
| `pruneStaleGeneratedShopping` | KEEP | regex and 28-day rule; ARCH-16 (OPEN, snapshot rows) | shopping-prune |
| `describeWriteError` / `withUserErrors` | FIXED (quota and zod readable); SEC-15 OPEN for lower-layer text | STO-3, LOGIC-2, SEC-15 | write-errors; backend-storage-backup (quota) |
| `createActions` | KEEP | — | every DB test |
| `save` (internal) | FIXED | SEC-2 (ceiling clamp), SEC-3 (cap at new row) | backend-storage-limits; backend-storage-invariants (monotonic) |
| `rawSnapshot` | NEW (STO-1, FIXED) | reads stored rows as stored | backend-storage-backup (corrupt record); backend-redteam-storage |
| `snapshot` (validated) | OPEN | ARCH-20: one invalid stored row still fails export; quarantine undecided | STO-1 tests (named record) |
| `exportBackup` | FIXED | STO-1 (per-table, named record), STO-3, STO-4 (20 MB guard), RT-B1 (serialised size) | backend-storage-sizes; backend-storage-backup; backend-security-integrity |
| `dataFingerprint` | FIXED | STO-2 (ignores viewedAt and view-only rows); SEC-16 OPEN (full JSON copy kept) | backend-storage-backup |
| `comparableRow` | KEEP | sorted keys (regression guard) | backup-preview-conflicts; backend-storage-backup (upgraded record) |
| `previewImport` | FIXED | STO-1, STO-2, STO-3, RT-B2 (incoming updatedAt capped at now - 1), SEC-16 (memory, OPEN) | backup-preview-conflicts; backup-schema-errors; backend-security-input; backend-storage-sizes |
| `importBackup` | FIXED | ARCH-4 (merge keeps local cook), SEC-3 (caps), RT-B1 (size), STO-3 (rollback) | backend-storage-cook-shopping (ARCH-4); backend-storage-limits; backend-redteam-storage; TEST-1 (flaky) |
| `requestPersistentStorage` | KEEP | returns false when unsupported; Settings calls it (LOGIC-6, frontend) | none direct (TEST-GAP, trivial) |
| `onUpgradeBlocked` | NEW (STO-5, FIXED) | subscribes to blocked events; App shows message (LEAD-B1) | backend-storage-migration (blocked upgrade); browser `blocked.mjs` (lead) |
| `maxBackupBytes`, `backupLimits` (schema) | NEW (SEC-3, SEC-4) | single source for caps and the 20 MB limit used by Settings (LEAD-B2) | backend-storage-limits; backend-security-integrity (SEC-4 reads Settings source) |

## 3. Migrations and upgrade

| Function / step | Final disposition | Finding IDs | Test reference |
| --- | --- | --- | --- |
| Dexie v2 upgrade (`servingsConsumed ??= 0`, preferences defaults) | FIXED | RT-B7 (null values replaced with defaults) | backend-storage-migration (8); backend-redteam-migration (8); backend-storage-sizes RT-B7 |
| Dexie v1 to v2 rollback on failure | KEEP (verified) | upgrade is atomic | backend-storage-migration (rollback, retry) |
| Sync Dexie `SyncDB` v2 (`conflicts` table) | KEEP (verified) | additive; a real v1 sync database upgrade is not tested (SYNC notes) | backend-sync-engine |
| SQL `202610110001_airfuel_sync.sql` | KEEP | owner from `auth.uid()`, search_path empty, no mutation grants | backend-sync-rls (30) |
| SQL `202610110002_airfuel_sync_no_force_rls.sql` | FIXED (PGlite) | ARCH-5: removes FORCE RLS so owner without BYPASSRLS works | backend-sync-rls no-FORCE tests |
| SQL `202610110003_airfuel_sync_quota.sql` | FIXED (PGlite) | SEC-9: per-account quota 224,006 rows; OBS-1 (concurrency double count, OPEN); OBS-2 (tombstones, OPEN) | backend-sync-rls quota; backend-sync-quota-backfill (3) |

## 4. Domain engine (`src/lib/engine.ts`)

| Function | Final disposition | Finding IDs | Test reference |
| --- | --- | --- | --- |
| `effectiveRecipes` | FIXED (fail closed on changed ingredients); DECISION on frozen copy | ENG-19 (= SEC-1); ARCH-9 | backend-engine-safety (override fails closed); backend-security-integrity SEC-1; backend-storage-invariants |
| `filterRecipes` | FIXED | ENG-1, ENG-2 (self-caught), ENG-3 (avoid list, LEAD-B8), ENG-4 (gluten and wheat), ENG-7 (speed), ENG-21 (folding), SEC-5 | backend-engine-safety; backend-engine-search; search-words; backend-redteam-engine |
| `recommendRecipes` | FIXED | ENG-1, ENG-5, ENG-6, ENG-8, ENG-9, ENG-10, ENG-16 (graded recency, accepted) | backend-engine-scenarios (27); backend-engine-safety |
| `recipeWords` (cache) | FIXED | ENG-17 | backend-engine-search (pathological input) |
| `mentions`, `wordMatches`, `fold` | FIXED | ENG-1, ENG-21 | backend-engine-safety; backend-redteam-engine |
| `allergenClosure` | FIXED | ENG-4 | backend-engine-safety |
| `scaleIngredients` | KEEP | verified over 300 recipes | backend-engine-nutrition (22) |
| `plannedNutrition` / `consumedNutrition` | KEEP | missing recipes counted, not zero | backend-storage-invariants; backend-engine-nutrition |
| `ingredientKey` | KEEP | aggregation key; no direct test | indirect (buildShoppingList) |
| `buildShoppingList` | FIXED | ENG-11 (zero rows dropped); PLAN-3 (prune in writes) | backend-engine-nutrition; shopping-tick-persistence |
| `formatShoppingAmount` | FIXED; DECISION on rounding | ENG-12 (positive never zero); ENG-13 (nearest rounding accepted) | shopping-amounts; backend-engine-nutrition |
| `formatAmount` (`src/components/context.tsx`) | FIXED | LEAD-2 (fractions) | format-amount (3) |
| `ingredientDetails` (`context.tsx`) | FIXED | LEAD-3 (separator) | format-amount |
| `localDate` / `weekDates` | KEEP; ARCH-18 OPEN (`!` on Intl) | ARCH-18 | engine (8) |
| `RecommendOptions` (`now`, `random`) | FIXED | ENG-10 | backend-engine-scenarios |

## 5. Schema and catalogue

| Function | Final disposition | Finding IDs | Test reference |
| --- | --- | --- | --- |
| `recipeSchema` / `customRecipeSchema` | KEEP; ARCH-6 OPEN (serialised size) | ARCH-6, SEC-7 (DECISION) | backend-storage-limits; backend-security-input |
| `backupSchema` | FIXED | SEC-3 (caps via `backupLimits`); strict format version 2 | backup-schema-errors; backend-security-input |
| `preferenceSchema` timezone | KEEP | `Intl` check | backend-security-input |
| source URL refine | FIXED | SEC-6 (try and catch) | backend-security-input; backend-storage-limits |
| `catalogue` loader (`src/data/catalogue.ts`) | OPEN (startup cost) | PERF-2 (frontend register) | data tests (26) |
| `coreTemperatureRequirement`, `parseNaturalIngredient` (`src/lib/customRecipe.ts`) | FIXED (moved to lib) | ARCH-8 | backend-custom-safety (19); custom-ingredients (17) |

## 6. Cloud sync core (`src/cloud/core.ts`)

| Function | Final disposition | Finding IDs | Test reference |
| --- | --- | --- | --- |
| `validateWire` | FIXED (lower-case operation id) | SYNC-7; SYNC-13 DECISION (no client byte limit) | backend-sync-engine; cloud; backend-security-input |
| `stableStringify`, `compareVersion` | KEEP | — | cloud; backend-sync-engine |
| `SyncDB` (metadata, v2 `conflicts`) | KEEP | — | cloud |
| `SyncEngine.bind`, `pendingCount` | KEEP | `pendingCount` excludes blocked records | backend-sync-engine |
| `classifySyncError`, `retryDelay`, `SyncError` | NEW (SYNC-1, SYNC-10) | permanent, transient, auth, config | backend-sync-transport; backend-sync-engine (retry policy) |
| `keepDisplacedValue`, `listConflicts`, `resolveConflict` | NEW (SYNC-2, FIXED local) | conflict copies kept; server-side retention is a DECISION | backend-sync-engine; backend-sync-transport |
| `recoverReceipts`, `finishReceipt` | FIXED | SYNC-3 (validated compare) | backend-sync-engine |
| `scanLocal` | FIXED | SYNC-4 (invalid rows skipped, never tombstoned) | backend-sync-engine |
| `acceptRemote` | FIXED | SYNC-2 (keep displaced first); ARCH-2 interplay | backend-sync-engine |
| `run` | FIXED | SYNC-1 (head-of-line), ARCH-1; ARCH-13 raw text OPEN | backend-sync-engine (head-of-line); inventory R7 |
| `forgetBaselines` / `forgetSyncBaselines` | FIXED | ARCH-2 (keeps local rows; refuses with unresolved conflicts) | backend-sync-engine (ARCH-2 tests) |
| `deleteAllSyncState` / `deleteLocalState` (controller: `deleteLocalCloudState`) | FIXED with DECISION | LEAD-B10 (delete-all); RT-B8 (conflicts deleted, warning shown, DECISION) | backend-sync-controller (delete-all with conflicts); backend-redteam-sync RT-B8 (expected fail) |
| `retryRejected` (`retryRejectedCloudRecords`) | NEW (ARCH-23, FIXED) | re-queues refused records | backend-sync-controller (retryRejected tests) |

## 7. Cloud adapter, controller and config

| Function | Final disposition | Finding IDs | Test reference |
| --- | --- | --- | --- |
| `parseCloudConfig`, `createCloudClient` | KEEP | anon JWT or publishable key only; 20 s timeout | cloud (10) |
| `remoteRecord` | FIXED | SYNC-9 (foreign row is auth, not applied) | backend-sync-transport; backend-redteam-sync |
| `postgrestErrorKind` | FIXED | SYNC-6 (JWT and auth); ARCH-23 (42501 is config); 53400 permanent | backend-sync-transport (error mapping) |
| `createSupabaseAdapter.apply` | FIXED | classified errors; ARCH-13 raw text OPEN | backend-sync-transport; backend-sync-rls |
| `createSupabaseAdapter.readAll` | FIXED | SYNC-5 (unreadable rows skipped), RT-B6 (page cap from quota); ARCH-22 OPEN (offset paging) | backend-sync-transport (paginated reads); backend-redteam-sync RT-B6 |
| `createCloudController` (`src/cloud/controller.ts`) | NEW (ARCH-19, FIXED) | injectable db, client, locks, online | backend-sync-controller (11) |
| `signIn` | FIXED via controller | ARCH-19 (tested) | backend-sync-controller |
| `enableSync` | KEEP (candidate engine discarded: ARCH-21 WONT-FIX) | — | backend-sync-controller |
| `syncNow` | FIXED | SYNC-6 (auth stop), SYNC-8 (display state), SYNC-14 (busy phase OPEN) | backend-sync-controller; backend-cloudui |
| `signOut` | DECISION | SEC-12 (local scope only; global when online OPEN) | backend-sync-controller (partial) |
| `authenticatedSession` | FIXED | auth error classes | backend-sync-controller |
| auth listener (`SIGNED_OUT`) | FIXED | ARCH-7 (clears enabled account; check only while enabled) | backend-sync-controller (ARCH-7 tests) |
| `syncDisplayState`, `listCloudConflicts`, `resolveCloudConflict` | NEW (SYNC-8, FIXED) | used by `CloudSettings` (line ~290) | backend-cloudui (19) |
| `retryDelay` bounds | KEEP | 300 s maximum | backend-sync-engine |

## 8. Notes, navigation, and browser storage

| Function | Final disposition | Finding IDs | Test reference |
| --- | --- | --- | --- |
| `readRecipeNoteDraft`, `writeRecipeNoteDraft`, `removeRecipeNoteDraft`, `clearRecipeNoteDrafts`, `subscribeToDraftReset` | KEEP | — | note-drafts (4) |
| `rememberExplore`, `exploreReturnLocation` | FIXED (tests added in backend-navigation) | SEC-11 (residue) | backend-navigation (3) |
| `forgetExploreLocation` | NEW (SEC-11, FIXED) | clears search residue on delete-all (LEAD-B4) | backend-navigation |

## 9. Page-level behaviour that touches the backend

| Function | Final disposition | Finding IDs | Test reference |
| --- | --- | --- | --- |
| `addShopping` (RecipeDetail) | FIXED | ARCH-12 (batch, LEAD-B7) | backend-storage-cook-shopping |
| `clearTicked` (Planning) | FIXED | ARCH-12 (batch, LEAD-B7) | backend-storage-cook-shopping |
| Recipe-page checks (RecipeDetail) | FIXED | ARCH-3 (`setRecipeCheck`, LEAD-B9) | backend-storage-recipe-checks |
| Explorer and Planner search | FIXED | ENG-3 (avoid list passed, LEAD-B8) | backend-engine-safety |
| Delete-all handler (Settings) | FIXED | LEAD-B10, SEC-11, RT-B8 (warning) | backend-sync-controller; backend-navigation |
| Import and export handlers (Settings) | FIXED | SEC-4 (`maxBackupBytes`, LEAD-B2); STO-5 message (App, LEAD-B1) | backend-security-integrity (SEC-4) |
| Timer transitions (`CookingTimer.tsx`) | KEEP | ARCH-8 (still in the component; tested through cook-mode-logic) | cook-mode-logic (4) |

## 10. Dispositions still open (summary)

- ARCH-6 (client size limit), SYNC-13 and SEC-7 (lead decision), SYNC-14, ARCH-10, ARCH-13, ARCH-14, ARCH-16, ARCH-17, ARCH-18, ARCH-20, ARCH-22, OBS-1, OBS-2, SEC-12, SEC-13, SEC-15, SEC-16, SEC-18, TEST-1.
- Decisions taken and recorded: ARCH-9 and STO-6 (frozen overrides), STO-7 (custom delete keeps history), STO-10 (device clock), ENG-13 and ENG-14, ENG-16 (constants accepted), SYNC-11, SYNC-13, RT-B8, SEC-19, OBS-7.
