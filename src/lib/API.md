# Data API contract

Import from `src/lib/index.ts`. All database mutations are asynchronous and reject on validation/storage errors; UI must catch and display them. `useKitchen()` returns undefined while loading; otherwise a reactive `KitchenData` snapshot with recipeStates, sessions, plans, pantry, shopping, customRecipes, overrides, preferences, activeCooking. Dexie observes writes from other tabs.

- `actions.patchRecipeState(recipeId, patch)` partial patch of tried/favourite/rating (1-5 or null)/notes/viewedAt. triedAt is automatic, undo clears it. Opening only updates viewedAt.
- `actions.saveRecipeNotes(recipeId, notes, expectedNotes)` writes notes only, and only when the stored notes still equal `expectedNotes` (the value this tab last loaded or saved). Otherwise it rejects with "These notes were saved in another tab" and writes nothing.
- Recipe rating and session rating: a session rating (1-5) also sets the recipe rating in the same transaction. Clearing a session's rating (`null`) keeps the recipe rating on purpose: a recipe rating can come from the recipe page or another cook, and an edit to one journal entry must not erase it. Use the recipe page's Clear control to remove a recipe rating.
- `actions.saveSession({id?,recipeId,date:'YYYY-MM-DD',servingsPrepared,servingsConsumed,rating:null|1..5,actualMinutes:null|number,ingredientChanges,temperatureC:null|number,timeChanges,notes,wouldCookAgain:null|boolean})`. Consumed must be explicit (0 means none). Does not automatically change tried flag.
- `actions.deleteSession(id)`
- `actions.savePlan({id?,recipeId,date,slot:'breakfast'|'lunch'|'dinner'|'snack',servings})`; `deletePlan(id)`
- `actions.savePantry({id?,name,quantity,unit:'g'|'ml'|'each'|'tsp'|'tbsp',form})`; `deletePantry(id)`
- `actions.saveShopping({id?,name,quantity,unit,form,aisle,checked,manual})`; `deleteShopping(id)`. Generated shopping rows use deterministic IDs; save checked rows with manual:false.
- `actions.savePreferences(partial)` with `name,location,language,timezone,airFryerBrand,airFryerLitres,airFryerModel,defaultServings,minProtein,maxMinutes,preferredProteins,favouriteIngredients,dislikedIngredients,avoidIngredients,allergens,dietary,oilFree,cuisines,theme`.
- `actions.saveCustomRecipe(recipe)` full validated Recipe; id must begin `custom-`. `deleteCustomRecipe(id)`.
- `actions.saveOverride(recipeId, partialRecipe)` validates against full recipe when `effectiveRecipes` is called. UI should generally use full custom recipes for ingredient changes. `deleteOverride(recipeId)`.
- `actions.saveActiveCooking({recipeId,servings,checkedIngredients:number[],checkedSteps:number[],timerEndsAt:number|null,timerRemainingSeconds:number}, expectedActiveRecipeId?)` or null to clear. Pass `expectedActiveRecipeId` (the recipe the tab last saw, or null for none) to refuse the write when another tab changed the active cook. Interactive start and stop controls should use `startCooking` and `stopCooking`.
- `exportBackup():Promise<string>`; `previewImport(text):Promise<ImportPreview>` returns `{backup,added,duplicates,conflicts,currentCount,fingerprint}`. `importBackup(preview,'merge'|'replace')`; requires UI confirm replace. Rechecks current database fingerprint; stale previews reject and must be regenerated. Merge newer updatedAt wins; identical timestamp ties retain current data.
- `effectiveRecipes(catalogue,data)` combines immutable catalogue/custom recipes/validated overrides.
- `filterRecipes(recipes,filters,states?)` (free-text query matches whole words or word starts: `oil` does not match `boiled`, `eggs` matches `egg`): filters optional query,category,minProtein,maxCalories,maxMinutes,dietary:string[],excludeAllergens:string[],avoidIngredients:string[],difficulty,oilFree,status:'all'|'tried'|'untried'|'favourites',sort:'relevance'|'time'|'protein'|'rating'. Punctuation and regular-expression syntax in the query only separate words. `excludeAllergens` treats `gluten` and `wheat` as one allergen. Recipes with `custom-` IDs are excluded whenever an allergen or diet filter is set.
- `avoidIngredients` matches whole words and their plural or head-noun endings. `egg` matches `eggs` and `peanut butter`, not `eggplant`. `pea` does not match `peanut`, but it does match `chickpea` and `nut` matches `peanut`, `walnut` and `coconut`. This errs toward excluding more. Use the precise allergen list for allergies.
- `recommendRecipes(recipes,data,mode='tonight',limit=6,options?)` returns `{recipe,score,reasons:string[]}[]`; modes tonight,new,favourites,pantry,fast,surprise. All allergies/dietary/avoidIngredients remain hard constraints and are applied before scoring. `options` is `{now?: epoch ms, random?: () => number in [0,1)}`, which makes the cooked-recently window and surprise jitter reproducible. `score` is the recipe's own score and does not depend on the other results. Diversity only changes the order. `reasons` lists at most four true reasons, strongest first. Recipes cooked in the last 7 days rank lower, as do recipes cooked in the last 28 days and recipes cooked more than once in the last 90 days. They are not removed. A single rating does not lift its whole category: two recipes in a category must be rated 4 or more first.
- `scaleIngredients(recipe,servings)` returns ingredients with recalculated quantities.
- `plannedNutrition(plans,recipes)` and `consumedNutrition(sessions,recipes)` return `{protein,calories,carbs,fat,missingRecipes}`. Caller filters desired date range first. Tried state never enters nutrient calculations.
- Spoon display uses the Australian measures: 1 tsp = 5 ml, 1 tbsp = 20 ml.
- `formatShoppingAmount(quantity, unit)` returns display text for a shopping row: under 15 ml reads as teaspoon fractions rounded to the nearest quarter or third (`⅓ tsp`, nearest, so it may be up to 0.03 ml under), 15 to 60 ml as tablespoons rounded up to the next half (`1¾ tbsp` style), other ml stays ml, and from 999.95 ml up it becomes L; g from 999.95 g up becomes kg; positive amounts never display as zero; g/each unchanged. Aggregation stays in ml.
- Shopping ticks for generated rows are pruned when a week is more than 28 days old (manual items are kept).
- `buildShoppingList(plans,recipes,pantry=[],saved=[])` returns `ShoppingItem[]`. Raw/cooked and fresh/dried remain distinct; matching teaspoon/tablespoon volumes normalise to ml (AU 5ml/20ml); pantry subtracts compatible quantities only.
- `localDate(date=new Date(),timezone='Australia/Sydney')`, `weekDates(date=localDate())` Monday to Sunday date strings.

`actions.deleteRecipeState(recipeId)` forgets all flags/rating/notes/view history for one recipe. `actions.clearUserData()` atomically clears every user table; invoke only after explicit UI confirmation and an opportunity to export. Canonical catalogue remains bundled and untouched. The API propagates storage errors so callers can show recovery messages; it never reports a failed write as saved. Validation failures and full browser storage reject with readable messages (`describeWriteError`), never raw Zod issue JSON or DOM error text; deliberate messages such as cooking-state conflicts pass through unchanged.

## Backup, restore and upgrade guarantees

- `exportBackup()` validates every saved row before writing. A damaged row makes it reject with a sentence naming the table and record id, and nothing is exported. It also rejects, without writing, any backup over `maxBackupBytes` (20 MB), because a larger file could not be restored.
- `previewImport(text)` and `importBackup(preview, mode)` read the local data as stored, so one damaged local row never blocks a replace-restore, which is the way out of it. Storage failures are reported as readable messages, never raw browser text.
- Opening or viewing a recipe does not invalidate an import preview. The fingerprint ignores `viewedAt` and view-only recipe rows (`updatedAt` 0). Any real memory edit, session, plan, or other table change still does.
- Records are compared with sorted keys, so the same data upgraded from v1 (where new keys are appended) is not reported as a conflict.
- `onUpgradeBlocked(callback)` subscribes to Dexie's `blocked` event. Dexie waits silently while another tab on an older build holds the database open. The page should tell the user to close other AirFuel Kitchen tabs and reload.
- Recipe-page ticks: `setRecipeCheck(recipeId,'ingredient'|'step',index,checked,length?)` writes `recipeStates.checks` only, while not cooking. Pass the recipe's ingredient or step count as `length`; an index beyond it is refused. The active cook is never created or changed by it.
- Cook Mode ticks: `setCookingCheck` works only for the active cook of that recipe and throws "Start cooking this recipe before ticking its steps or ingredients." when nothing is cooking. `startCooking` seeds a new cook's checklist from the recipe-page checks.
- A merge never replaces the local active cook with a different recipe. Replace still takes the backup's cook.
- `saveShoppingBatch(rows)` writes a whole list in one transaction; `clearTickedShopping(weekStart)` clears one week's ticks in one transaction.
- Caps: `backupLimits` (schema.ts) is the single source of per-table record limits. A merge that would exceed one, or a write that would add a row beyond one, is refused before anything is written, so export always works.
- Timestamps are clamped to `timestampCeiling`, so a row imported at the maximum stays editable.
- The v1 to v2 upgrade runs in one versionchange transaction. A failure rolls back every table it changed, and the next open retries it.

## Official references consulted
- https://dexie.org/docs/Dexie/Dexie.transaction() (transaction lifetime, atomicity and rollback)
- https://dexie.org/docs/Version/Version.upgrade() (version upgrades)
- https://zod.dev/api (strict runtime object validation)

## Boundaries
No network, analytics, credentials, AI model or cloud sync. Rule-based recommendations use declared allergen metadata and explicit avoids; users still need to check ingredient packaging. A backup override that changes a recipe's ingredients fails closed: it is excluded by every allergen and diet filter, because its declared allergens and diet claims can no longer be trusted. `surprise` randomises only after hard constraints. Ratings and explicit tried flags never create consumed nutrient totals. Ingredient nutrient values remain source estimates. The library stores notes as plain text; the React UI must never inject them as HTML. The schema rejects unknown object properties, unsafe source URL schemes, negative/nonfinite quantities, invalid dates and unsupported backup versions. Imported custom recipes require namespaced IDs.

## Integration hardening

- `actions.saveCookingSession(input)` has the same input as saveSession and atomically saves the session plus tried state and any non-null rating. Use it for the cooking-memory form, avoiding partial success and duplicate session retries.
- `actions.patchActiveCooking(recipeId,patch,defaultServings=2)` reads the latest active row inside a transaction and updates only specified fields (servings, timerEndsAt, timerRemainingSeconds, checkedIngredients, checkedSteps). Starting another recipe resets its checklist.
- `actions.setCookingCheck(recipeId,'ingredient'|'step',index,checked,defaultServings=2)` atomically changes just one checkbox against the latest stored set; simultaneous checkbox/timer changes from other tabs survive.
- Generated shopping ticks reset when their required quantity changes. Manual shopping ticks reset when edited ingredient/quantity/unit/form changes.
- Unverified `custom-` recipes are excluded whenever an allergen exclusion is active, including Explorer. An unchecked custom allergen declaration cannot establish safety. Custom recipes remain directly accessible from Your own recipes; the app does not infer safe ingredients from free text.

`actions.saveCookingSession(input, completeCooking=false)` additionally clears the active timer/checklist only when the flag is true and the active recipe matches the logged recipe. All three updates commit atomically. Keep false for editing prior journal entries and generic retrospective logs.

Serving-count boundaries are 0.01–100 in stored recipe/default/planned/prepared/active data; consumed portions additionally allow zero. Unverified custom recipes are excluded for active dietary requirements as well as allergen exclusions. Overrides cannot introduce new dietary claims or promote a baseline recipe to oil-free.
