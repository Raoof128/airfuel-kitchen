# Logic / state / persistence audit (agent: logic, prefix LOGIC)

Date: 2026-10-11. Scope: `src/lib/*`, `src/cloud/*`, `tests/unit/*`. Browser scripts: `scripts/frontend-audit/tmp/logic/` (memory.mjs, backup.mjs, planner.mjs, failures.mjs, multitab-notes.mjs, search.ts, probe.ts).
Unit suite after changes: `npx vitest run` → 13 files, 90 tests passing. `npx tsc -p tsconfig.app.json --noEmit` clean. `npx eslint src/lib src/cloud tests/unit` clean.

## LOGIC-1: Stale tab silently overwrites notes saved in another tab
- Severity: P1
- Route / component / file:line: `#/recipe/<slug>`, `src/pages/RecipeDetail.tsx:649` (Save notes), `src/lib/db.ts` (`saveRecipeNotes`)
- Defect (what a user sees): Tab 1 has the recipe open with unsaved text. Tab 2 saves "Saved from tab 2". Tab 1 then clicks Save notes and its text replaces the saved note with no warning. Verified in browser: stored notes became "Draft from tab 1", and "Saved from tab 2" was lost.
- Root cause: `patchRecipeState(recipe.id, { notes })` is last-write-wins with no check against the notes this tab loaded.
- Fix: Added `actions.saveRecipeNotes(recipeId, notes, expectedNotes)` in `src/lib/db.ts`. It writes only when the stored notes equal `expectedNotes`, otherwise it rejects with "These notes were saved in another tab. Review them before saving again." and writes nothing. Documented in `src/lib/API.md`. Tests: `tests/unit/notes-concurrency.test.ts` (5 tests).
- Needs other owner: `src/pages/RecipeDetail.tsx` (recipe owner). Exact change:
  1. Add `const [savedNotes, setSavedNotes] = useState(() => data.recipeStates.find((s) => s.id === recipe?.id)?.notes ?? "");` next to the `note` state (line ~129).
  2. In the Save notes handler (line ~649) replace `actions.patchRecipeState(recipe.id, { notes: note })` with `actions.saveRecipeNotes(recipe.id, note, savedNotes)`.
  3. After a successful save, `setSavedNotes(note)`.
  4. Keep the draft in the textarea on rejection; the existing `run()` toast shows the message.
- Verification: unit tests pass. Browser before fix reproduced the overwrite (tab 1 result "Draft from tab 1" overwrote "Saved from tab 2"). Page wiring NOT yet verified because RecipeDetail is owned by another agent.
- Status: NEEDS-OWNER (lib part FIXED-VERIFIED by unit tests)

## LOGIC-2: Raw validation JSON and DOM error text shown in save toasts
- Severity: P2
- Route / component / file:line: every action in `src/lib/db.ts` → toast from `src/App.tsx` `run()` (line ~168)
- Defect: A ZodError surfaced as its JSON issue list (`[ { "origin": "string", ... }]`), and a full browser quota showed "The quota has been exceeded. QuotaExceededError: ..."
- Root cause: `run()` shows `error.message` directly.
- Fix: `describeWriteError` plus `withUserErrors` wrapper in `src/lib/db.ts`; every action now rejects with readable text for validation and quota failures. Deliberate messages (cooking conflicts, notes conflicts) pass through unchanged. Tests: `tests/unit/write-errors.test.ts` (6 tests). Documented in `src/lib/API.md`.
- Verification: `scripts/frontend-audit/tmp/logic/failures.mjs` with a forced QuotaExceededError on recipeStates writes. Toast now reads "This browser has no free storage left. Export a backup, free some space and try again.", the rating did not change (no false success), no page errors.
- Status: FIXED-VERIFIED

## LOGIC-3: Free-text search matched substrings inside other words
- Severity: P3 (latent: no current catalogue recipe triggers it, but custom recipes can)
- Route / component / file:line: `#/explore` search, `src/lib/engine.ts` `filterRecipes`
- Defect: "oil" matches "boiled" or "foil", "egg" matches "veggie", "rice" matches "price".
- Root cause: `searchable(recipe).includes(token)`.
- Fix: Tokens are matched against word starts (`words()` splits on non-letter/number, keeps accents). "eggs" still maps to "egg". Tests: `tests/unit/search-words.test.ts` (5 tests, including README phrases checked against the real catalogue). Documented in `src/lib/API.md`.
- Verification: unit tests. Probe on the real catalogue showed the README queries unchanged: `under 20 minutes` 24 results, `no oil` 37, `more than 40g protein` 44 (matches direct predicates), `chicken breast` 22.
- Status: FIXED-VERIFIED

## LOGIC-4: "Add ingredients" twice replaces the first set instead of adding
- Severity: P2
- Route / component / file:line: `#/recipe/<slug>`, `src/pages/RecipeDetail.tsx:202-214`
- Defect: Pressing "Add ingredients" twice (servings 2 each time) leaves one set of rows, not two. Verified: the shopping list showed chicken thighs "2 each", not 4. Any ticks or manual edits on those rows are also reset.
- Root cause: row ids are deterministic (`direct-${recipe.id}-${index}`), so `saveShopping` overwrites them. Manual rows are also not merged with planned rows, so the same ingredient can appear twice (for example chicken thighs from a plan and from "Add ingredients").
- Fix: Needs other owner: `src/pages/RecipeDetail.tsx:206` change `id: \`direct-${recipe!.id}-${index}\`` to `id: crypto.randomUUID()` so each add is a separate line item and existing ticks are kept. Merging with planned rows is a product decision (Planning owner).
- Verification: `scripts/frontend-audit/tmp/logic/multitab-notes.mjs` (second run shows 1 set).
- Status: NEEDS-OWNER

## LOGIC-5: Manual shopping rows display units differently from planned rows
- Severity: P3
- Route / component / file:line: `#/shopping`, `src/lib/engine.ts` `buildShoppingList` (manual rows appended unchanged)
- Defect: Planned paprika shows "ml" (converted from tsp), manual items keep "tsp" (for example "0.5 tsp · raw"). Same ingredient appears in two units.
- Root cause: manual rows are appended without `baseUnit` normalisation.
- Fix: Not changed. Decide whether manual items should convert to ml like planned items (small change in `buildShoppingList`, plus tests). Left for product decision.
- Status: OPEN

## LOGIC-6: Duplicate persistent-storage request in Settings; `requestPersistentStorage` unused
- Severity: P3
- Route / component / file:line: `src/pages/Settings.tsx:498-505`; `src/lib/db.ts` `requestPersistentStorage`
- Defect: None visible. Settings repeats `navigator.storage.persist()` inline, so the lib helper is dead code.
- Fix: Needs other owner: Settings may call `requestPersistentStorage()` after its own availability message check. Or delete the lib helper. Not changed.
- Status: NEEDS-OWNER (low priority)

## LOGIC-7: Viewing a recipe showed as a "different version" in backup preview
- Severity: P3
- Route / component / file:line: Settings → Import backup preview, `src/lib/db.ts` `previewImport`
- Defect: After importing a backup and opening the recipe, re-importing the identical backup reported "Different versions 1" (viewedAt changed). Merge never applies viewedAt, so the count was misleading.
- Fix: `comparableRow()` ignores `viewedAt` for recipeStates when counting conflicts. Tests: `tests/unit/backup-preview-conflicts.test.ts` (3 tests).
- Verification: `backup.mjs` re-import check now "Different versions 0"; 16/16 browser checks pass.
- Status: FIXED-VERIFIED

## LOGIC-8: Cooking message blamed "another tab" when another recipe is cooking in this tab
- Severity: P3
- Route / component / file:line: `src/lib/db.ts` `patchActiveCooking`
- Defect: Changing a timer or serving on recipe B while recipe A is active showed "Cooking changed in another tab...".
- Fix: Explicit message "Another recipe is already cooking. Finish or stop it before changing this one." Test in `tests/unit/write-errors.test.ts`.
- Status: FIXED-VERIFIED (unit). Browser path not exercised.

## LOGIC-9: Invalid saved override silently hides the user's edit
- Severity: P3
- Route / component / file:line: `src/lib/engine.ts` `effectiveRecipes` (`safeParse` failure is ignored)
- Defect: If an override stops validating (schema change or bad backup), the recipe shows the catalogue version and the user is not told their edit is inactive.
- Fix: Not changed. Needs a product decision: show a notice on the recipe page, or keep the stored override visible in Settings.
- Status: OPEN

## LOGIC-10: Cloud first sync resolves same-record conflicts by random UUID (design risk)
- Severity: P1 (product decision), documented in `src/cloud/API.md`
- Route / component / file:line: `src/cloud/core.ts` `compareVersion`, `acceptRemote`, `airfuel_apply_change` (server)
- Defect: When two devices both have a local value for the same record (for example the singleton `preferences`), both start at revision 1 and the winner is the larger random operation_id. The losing device's edit is replaced without a prompt. Enabling sync on a device with local data can silently replace local preferences or recipe notes.
- Root cause: revision tie-break uses a random UUID, not the time of the edit.
- Fix: Not changed (server RPC and the migration are outside this sweep). Options: use `updatedAt` as the tie-break, or ask the user to choose on first enable when local and remote data both exist.
- Status: OPEN (needs product decision)

## Checked and found correct
- Tried state: mark → undo → reload → new tab → multi-tab, all views (`memory.mjs` 20/20).
- Ratings: save, reload, clear, multi-tab, `saveCookingSession`/`SessionForm` keeps recipe rating in step with the journal.
- Notes: save, reload, unsaved draft restored after reload, delete (empty) saved, multi-tab rating does not clobber notes.
- Backup: export → fresh-context merge restores tried/rating/notes; malformed (truncated, wrong format, duplicate ID, invalid JSON, unknown key) rejected with messages and no changes; newer conflict wins, older loses; stale preview rejected after another tab edit (`backup.mjs` 16/16).
- Planning ↔ shopping: two plans of one recipe at 2 and 4 servings give 6 chicken thighs; paprika 1 tsp + 1 tsp → 7.5 ml; pantry 1 tsp subtracted → 2.5 ml; dried herbs 0.75 tsp → 3.8 ml (display rounding) (`planner.mjs`).
- Blocked IndexedDB shows the app's recovery screen, no page errors (`failures.mjs` B).
- Views after marking tried and saving a favourite (`views.mjs`): dashboard "1 of 300 recipes tried", explore card shows "· Tried ✓", favourites list includes the recipe, recipe button "Tried · undo".
- Search on the real catalogue: README phrases match direct predicates.

## Architecture notes (for the shell owner, not edited)
- `src/App.tsx:236` `<AppContext value={{ data, recipes, run, navigate }}>` creates a new object on every App render, and `run`/`navigate` are re-created each render, so every consumer re-renders on every toast or pending change.
- `src/App.tsx` `const recipes = effectiveRecipes(catalogue, data)` is not memoised. Suggest `useMemo(() => effectiveRecipes(catalogue, data), [data])`.
- `useKitchen()` (`src/lib/db.ts`) re-reads every table on any write. Fine at current size; note for later.
- `localDate(new Date(), data.preferences.timezone)` is repeated about ten times across pages. A `useToday()` helper would remove the duplication.
- `src/components/context.tsx` `formatQuantity` rounds to one decimal, so 0.25 each displays as "0.3". Shopping may need two decimals or fractions.
- Stray file `src/pages/CookMode.tsx.tmp.4880.fbce7c3252bd` was present during the sweep (an editor temp file). Not mine; check that it is removed.

## Not verified
- Cloud sync against a live Supabase project (not run; no credentials, and the brief forbids network changes). Covered by unit tests only.
- Replace-mode import in the browser (merge and conflict modes verified).
- Page wiring for LOGIC-1 and LOGIC-4 (pages owned by other agents).

## Round 2 (routed from planning, journal and settings)

### PLAN-2: small spoon-derived shopping amounts shown as awkward ml
- Status: FIXED-VERIFIED (unit). Display function `formatShoppingAmount(quantity, unit)` in `src/lib/engine.ts`. Examples: 1.7 ml → "⅓ tsp", 9.2 ml → "1¾ tsp", 3.75 ml → "¾ tsp", 35 ml → "1¾ tbsp", 62 ml → "62 ml", 1200 ml → "1.2 L", 1200 g → "1,200 g". Aggregation is unchanged.
- Limitation: aggregation loses the origin unit, so an ml item that happens to sit on a clean spoon fraction (for example a true 15 ml) also reads as "3 tsp". Display rules: under 15 ml → tsp; 15–60 ml → tbsp rounded up to ½; 60 ml+ → ml.
- Needs other owner: `src/pages/Planning.tsx` (Shopping, line 588 `{formatQuantity(row.quantity)} {row.unit} · {row.form}`). Replace with `{formatShoppingAmount(row.quantity, row.unit)}`, importing it from `../lib`. Also any other shopping amount display.
- Tests: `tests/unit/shopping-amounts.test.ts` (4 tests).

### PLAN-3: stale generated shopping ticks accumulate
- Status: FIXED-VERIFIED (unit). `pruneStaleGeneratedShopping` runs inside `saveShopping`. It removes generated rows (`manual: false`, `week-<monday>:` prefix) whose week starts more than 28 days before today. Manual items are never pruned. Tests: `tests/unit/shopping-prune.test.ts` (2 tests).
- Trade-off: ticks for weeks older than four weeks are discarded. Planner users navigating far back will see those weeks untick.

### JRN-5: clearing a session rating keeps the recipe rating
- Status: intended, documented and pinned by a test (`tests/unit/session-rating.test.ts`), no code change.
- Reason: a recipe rating can be set from the recipe page or by another cook. Editing one journal entry must not erase it. Recipe rating removal stays available via the recipe page's Clear control. Documented in `src/lib/API.md`.
- Journal page copy could say so explicitly ("Clearing this cook's rating keeps the recipe rating"). Needs other owner: `src/pages/Journal.tsx` / `SessionForm.tsx` (optional).

### Journal 0-entry reload: code-path review
- No code path deletes or upgrades the Dexie database on load or HMR: no `db.delete()`, no `deleteDatabase`, no `versionchange` handler (Dexie's default closes the connection). The only schema upgrade is v2, which only sets `servingsConsumed ??= 0` and fills missing preference keys.
- Rows are cleared only by explicit user actions: `clearUserData` (Settings "Delete personal data") and `importBackup` in replace mode (confirmed). The cloud engine deletes local rows only for a remote tombstone when sync is enabled by the user.
- `App.tsx:182` shows loading while `useKitchen()` is undefined, so the Journal cannot render "0 entries" from an unresolved read.
- Conclusion: no data-loss path on load or HMR found. The one-off stays unexplained. If it recurs, capture `indexedDB` `sessions` count at the moment of the render.

### Settings: raw Zod message for wrong-schema backups
- Status: FIXED-VERIFIED (unit). `previewImport` throws `This file is not an AirFuel Kitchen backup. Choose a backup exported from Settings.` plus a short hint ("Problem at recipeStates.0.rating"). The Zod error is kept on `cause`. Tests: `tests/unit/backup-schema-errors.test.ts` (3 tests).
- Needs other owner (optional cleanup): `src/pages/Settings.tsx` line 481 has a `startsWith("[")` rewrite that no longer triggers. It can be removed.
