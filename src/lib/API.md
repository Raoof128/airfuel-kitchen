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
- `actions.saveActiveCooking({recipeId,servings,checkedIngredients:number[],checkedSteps:number[],timerEndsAt:number|null,timerRemainingSeconds:number})` or null to clear.
- `exportBackup():Promise<string>`; `previewImport(text):Promise<ImportPreview>` returns `{backup,added,duplicates,conflicts,currentCount,fingerprint}`. `importBackup(preview,'merge'|'replace')`; requires UI confirm replace. Rechecks current database fingerprint; stale previews reject and must be regenerated. Merge newer updatedAt wins; identical timestamp ties retain current data.
- `effectiveRecipes(catalogue,data)` combines immutable catalogue/custom recipes/validated overrides.
- `filterRecipes(recipes,filters,states?)` (free-text query matches whole words or word starts: `oil` does not match `boiled`, `eggs` matches `egg`): filters optional query,category,minProtein,maxCalories,maxMinutes,dietary:string[],excludeAllergens:string[],difficulty,oilFree,status:'all'|'tried'|'untried'|'favourites',sort:'relevance'|'time'|'protein'|'rating'.
- `recommendRecipes(recipes,data,mode='tonight',limit=6)` returns `{recipe,score,reasons:string[]}[]`; modes tonight,new,favourites,pantry,fast,surprise. All allergies/dietary/avoidIngredients remain hard constraints.
- `scaleIngredients(recipe,servings)` returns ingredients with recalculated quantities.
- `plannedNutrition(plans,recipes)` and `consumedNutrition(sessions,recipes)` return `{protein,calories,carbs,fat,missingRecipes}`. Caller filters desired date range first. Tried state never enters nutrient calculations.
- Spoon display uses the Australian measures: 1 tsp = 5 ml, 1 tbsp = 20 ml.
- `formatShoppingAmount(quantity, unit)` returns display text for a shopping row: small ml amounts that sit on a clean teaspoon or tablespoon fraction read as `⅓ tsp`, `1¾ tbsp` (only below 60 ml); other ml stays ml, 1000 ml and up becomes L; g/each unchanged. Aggregation stays in ml.
- Shopping ticks for generated rows are pruned when a week is more than 28 days old (manual items are kept).
- `buildShoppingList(plans,recipes,pantry=[],saved=[])` returns `ShoppingItem[]`. Raw/cooked and fresh/dried remain distinct; matching teaspoon/tablespoon volumes normalise to ml (AU 5ml/20ml); pantry subtracts compatible quantities only.
- `localDate(date=new Date(),timezone='Australia/Sydney')`, `weekDates(date=localDate())` Monday to Sunday date strings.

`actions.deleteRecipeState(recipeId)` forgets all flags/rating/notes/view history for one recipe. `actions.clearUserData()` atomically clears every user table; invoke only after explicit UI confirmation and an opportunity to export. Canonical catalogue remains bundled and untouched. The API propagates storage errors so callers can show recovery messages; it never reports a failed write as saved. Validation failures and full browser storage reject with readable messages (`describeWriteError`), never raw Zod issue JSON or DOM error text; deliberate messages such as cooking-state conflicts pass through unchanged.

## Official references consulted
- https://dexie.org/docs/Dexie/Dexie.transaction() (transaction lifetime, atomicity and rollback)
- https://dexie.org/docs/Version/Version.upgrade() (version upgrades)
- https://zod.dev/api (strict runtime object validation)

## Boundaries
No network, analytics, credentials, AI model or cloud sync. Rule-based recommendations use declared allergen metadata and explicit avoids; users still need to check ingredient packaging. `surprise` randomises only after hard constraints. Ratings and explicit tried flags never create consumed nutrient totals. Ingredient nutrient values remain source estimates. The library stores notes as plain text; the React UI must never inject them as HTML. The schema rejects unknown object properties, unsafe source URL schemes, negative/nonfinite quantities, invalid dates and unsupported backup versions. Imported custom recipes require namespaced IDs.

## Integration hardening

- `actions.saveCookingSession(input)` has the same input as saveSession and atomically saves the session plus tried state and any non-null rating. Use it for the cooking-memory form, avoiding partial success and duplicate session retries.
- `actions.patchActiveCooking(recipeId,patch,defaultServings=2)` reads the latest active row inside a transaction and updates only specified fields (servings, timerEndsAt, timerRemainingSeconds, checkedIngredients, checkedSteps). Starting another recipe resets its checklist.
- `actions.setCookingCheck(recipeId,'ingredient'|'step',index,checked,defaultServings=2)` atomically changes just one checkbox against the latest stored set; simultaneous checkbox/timer changes from other tabs survive.
- Generated shopping ticks reset when their required quantity changes. Manual shopping ticks reset when edited ingredient/quantity/unit/form changes.
- Unverified `custom-` recipes are excluded whenever an allergen exclusion is active, including Explorer. An unchecked custom allergen declaration cannot establish safety. Custom recipes remain directly accessible from Your own recipes; the app does not infer safe ingredients from free text.

`actions.saveCookingSession(input, completeCooking=false)` additionally clears the active timer/checklist only when the flag is true and the active recipe matches the logged recipe. All three updates commit atomically. Keep false for editing prior journal entries and generic retrospective logs.

Serving-count boundaries are 0.01–100 in stored recipe/default/planned/prepared/active data; consumed portions additionally allow zero. Unverified custom recipes are excluded for active dietary requirements as well as allergen exclusions. Overrides cannot introduce new dietary claims or promote a baseline recipe to oil-free.
