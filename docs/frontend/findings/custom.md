# Custom recipes findings (agent: custom, prefix CUST)

Scope: `src/pages/CustomRecipes.tsx`, custom-recipe selectors in `src/styles.css` (`.custom-field*`, `.custom-hint`, `.custom-required-note`, `.required-mark`).
Checks: `npx tsc -p tsconfig.app.json --noEmit` (exit 0), `npx eslint src/pages/CustomRecipes.tsx` (exit 0), `npx vitest run tests/unit/custom-ingredients.test.ts` (3/3 pass).
Browser scripts: `scripts/frontend-audit/tmp/custom/flow.mjs` (before), `verify.mjs` (after, 10 steps, all pass, no console errors), `responsive.mjs` (320/375, light/dark, axe).

## CUST-1: Whitespace-only required fields show raw schema JSON
- Severity: P1
- Route / component / file:line: `/custom` create/edit modal, `src/pages/CustomRecipes.tsx` save handler; toast from `src/App.tsx:152-160`
- Defect (what a user sees): Entering spaces only in Recipe name (or Method, Food safety notes, etc.) passed the native `required` check, then the toast showed raw Zod JSON (`[ { "origin": "string", "code": "too_small" ...`). The modal stayed open with no message next to the field.
- Root cause: The form relied on `recipeSchema.parse` inside `run()`; its error text went straight to the toast.
- Fix: Required text fields are trimmed-checked in the form, and the candidate record is validated with `recipeSchema.safeParse` before saving. Each issue maps to its field and shows a plain message beside it, with `aria-invalid` and `aria-describedby`; focus moves to the first invalid field.
- Verification: `verify.mjs` step 1: invalid = title, steps; title error text shown; focus on title; no `"code"` text in toast. Screenshot `docs/frontend/screenshots/agents/custom/custom-errors-1440-light.png`.
- Status: FIXED-VERIFIED

## CUST-2: Core safety temperature error only in a toast; raw chicken in "Quick dinners" saved with no safety temperature
- Severity: P1 (food safety)
- Route / component / file:line: `/custom` form, `Required internal food temperature` field, `src/pages/CustomRecipes.tsx` (`categoryMinimumC`, `coreTemperatureRequirement`)
- Defect (what a user sees): Core temperature below the minimum showed only as a toast, and the field was not marked invalid. In categories without a minimum (Quick dinners, Vegetarian, Snacks & sides, Something sweet), the minimum was null, so a recipe with chicken and a blank core was saved with `internalTempC: null`.
- Root cause: the minimum came only from the category.
- Fix: the requirement is now the strictest of the category minimum and an ingredient-word minimum (poultry 74°C; mince, pork, egg, sausage, bacon, ham, beef, lamb, steak 71°C; fish and seafood 63°C). Packaged words (stock, sauce, paste, powder, seasoning, extract, oil) are skipped. Blank core uses that minimum, and the hint says so. Too-low values give an inline message naming the reason, e.g. "Use at least 74°C as the core safety temperature because it contains chicken breast (poultry)."
- Verification: `verify.mjs` step 2 (quick dinner, chicken, 70 → inline reason message) and step 3 (chicken & turkey, 70 → inline message, `aria-invalid="true"`, describedby `core-error`). Not browser-tested: a quick-dinner chicken recipe saved with a blank core now stores 74 (code path only, logic unit-checked by reading).
- Behaviour change to note: existing custom recipes whose ingredients name chicken, egg, fish or mince in a category with a lower or no minimum will now need a core temperature when edited.
- Status: FIXED-VERIFIED (inline message); FIXED-UNVERIFIED (auto-applied minimum stored value)

## CUST-3: Unsaved edits silently lost on Escape, X or reload
- Severity: P1 (data loss within the form)
- Route / component / file:line: `/custom` edit modal; `Modal` in `src/components/UI.tsx` calls `onClose` on Escape
- Defect (what a user sees): Pressing Escape or the close button discarded everything typed, with no prompt. Reloading or closing the tab also lost it without warning.
- Root cause: no dirty tracking; `onClose` was `setEditing(null)`.
- Fix: any change sets a dirty flag. Closing with unsaved changes shows an inline "Discard your changes?" prompt at the bottom of the form, with "Keep editing" (focused) and "Discard changes". A `beforeunload` guard is registered while the editor is open with unsaved changes.
- Verification: `verify.mjs` step 4: prompt visible on Escape, focus on "Keep editing", title kept after Keep editing, Discard closes. The `beforeunload` guard was not tested.
- Status: FIXED-VERIFIED
- Addendum (verify3.mjs): beforeunload fires only when dirty (in-page cancelable event: dirty prevented=true, clean prevented=false; Playwright close(runBeforeUnload) reports one beforeunload dialog when dirty, none when clean).

## CUST-4: Edit and Delete buttons on every card have identical names
- Severity: P2 (a11y)
- Route / component / file:line: `/custom` list cards, `src/pages/CustomRecipes.tsx`
- Defect: Screen-reader users hear "Edit" / "Delete" repeatedly with no recipe name.
- Fix: `aria-label="Edit <title>"` and `aria-label="Delete <title>"` (visible text unchanged).
- Verification: `verify.mjs` steps 9 and 10 locate the buttons by `getByRole` name with the recipe title. Pass.
- Status: FIXED-VERIFIED

## CUST-5: Hints inside labels polluted accessible names
- Severity: P2 (a11y)
- Route / component / file:line: ingredients textarea and core temperature in `src/pages/CustomRecipes.tsx`
- Defect: The `<small>` hint sat inside `<label>`, so the accessible name read as the whole paragraph.
- Fix: hints are outside the label and linked by `aria-describedby`.
- Verification: `verify.mjs` step 3 reads `aria-describedby="custom-core-hint core-error"`. axe on the dialog: no violations (`verify.mjs` step 5, `responsive.mjs`).
- Status: FIXED-VERIFIED

## CUST-6: No visible required markers
- Severity: P2
- Route / component / file:line: `/custom` create/edit form
- Defect: Required fields looked the same as optional ones (core temperature, source). Nothing said which fields were required.
- Fix: a red `*` on each required label (`aria-hidden`, so names are unchanged), with the note "Fields marked * are required."
- Verification: screenshot `docs/frontend/screenshots/agents/custom/custom-form-errors-375-dark.png`.
- Status: FIXED-VERIFIED

## CUST-7: Numeric limits relied on native validation, which the form now bypasses
- Severity: P2
- Route / component / file:line: `src/pages/CustomRecipes.tsx` (`numberBounds`, form `noValidate`)
- Defect (potential): Native min/max bubbles are unstyled and not next to fields, so the form now checks ranges itself. A missed bound would let e.g. 700 prep minutes through, since the schema allows up to 1,000,000.
- Fix: explicit range check for every numeric input and a core range check, all with inline messages.
- Verification: code path only, `tsc` and `eslint` pass. Not browser-tested for each bound.
- Status: FIXED-UNVERIFIED

## CUST-8: Blank source silently becomes the NSW reference
- Severity: P3
- Route / component / file:line: "Research/source link (optional HTTPS)" in `src/pages/CustomRecipes.tsx`
- Defect: Leaving the optional link blank saved the NSW Food Authority URL with no sign on the form.
- Fix: hint text says "Blank uses the NSW Food Authority food safety reference." The stored label is unchanged.
- Verification: copy-only; not screenshot-checked.
- Status: FIXED-UNVERIFIED

## CUST-9: Ingredients and method cannot be added, removed or reordered with buttons
- Severity: P3 (design)
- Route / component / file:line: `/custom` form
- Defect: none measured. Ingredients and method are one line per item in a textarea, so add, remove and reorder are done by editing lines. There are no row controls.
- Decision: WONT-FIX as a defect. A row builder would be a feature change. The lead can decide whether to ask for it.
- Status: WONT-FIX (lead confirmed). Hint now reads "One ingredient per line, e.g. 200 | g | chicken breast" (pipe format is required by the parser).

## CUST-10: README says custom recipes live in "Your recipes (Settings)"
- Severity: P2
- Route / component / file:line: `README.md:34`; the page is `/#/custom`, linked only from the Explorer button "Your own recipes" (`src/pages/Explorer.tsx:131`). Settings has no link.
- Defect: A user following the README looks in Settings and does not find it.
- Needs other owner: README (lead) to say "Your own recipes" (Explore), or the Settings/navigation owner to add a link. Exact change: in `README.md:34` replace "Your recipes (Settings)" with "Your own recipes (Explore)".
- Status: NEEDS-OWNER

## Checked and OK
- Empty and populated list; persistence after reload (`verify.mjs` step 6).
- Recipe view at `/#/recipe/custom-…` (step 7); found by Explore search (step 8).
- Edit keeps values; save updates the list (step 9). Delete asks for confirmation and removes the card (step 10).
- Long title (200 characters) at 320px: no horizontal overflow (`responsive.mjs`).
- 320 and 375, light and dark: no page or dialog overflow; axe clean on the dialog.
- Planner and cook pages already show "Recipe unavailable" / "Recipe not found" for a deleted custom recipe (`Planning.tsx:222`, `Journal.tsx:92`, `CookMode.tsx:93`).

## Not verified
- Print and share-link behaviour on a custom recipe (README says link works only where the recipe has been imported or synced). That code is in RecipeDetail and belongs to the recipe owner.
- Planner and shopping flow: verified (verify2.mjs part 1; see addendum below).
- Full `vitest` suite and axe on the list page at each width (axe ran on the empty list and the dialog only).
- CUST-7 per-bound messages (code path only).

## Addendum: lead follow-up checks (verify2.mjs, verify3.mjs)
- Create -> reload -> Explore search -> detail -> Add to meal plan -> /planner -> /shopping (pork mince and soy sauce appear) -> reload of shopping and planner: all pass, no page errors.
- beforeunload (CUST-3): see the CUST-3 addendum above.
- Detail page at 375 light and dark: no horizontal overflow, no page errors. Screenshots `custom-detail-375-light.png` and `-dark.png` in the scratchpad. Note for the lead: the default category is Chicken & turkey, so a pork-mince test recipe shows 74°C core temperature (the category minimum). That is the existing rule and works as intended, but the default category may mislead pork-based recipes; choose the category deliberately.

## CUST-11: Ingredients required the pipe format (P2)
- Defect: every line needed `quantity | unit | ingredient | form`, so `200 g chicken breast` was rejected.
- Fix: `parseNaturalIngredient` reads `200 g chicken breast`, `2 tbsp olive oil`, `1/2 tsp paprika`, `1½ cups rice`, `3 eggs`, `pinch of salt`, `salt` and `1 L milk`. Unit aliases: g/gram(s), kg, ml, L/litre(s), cup(s) (converted to 250 ml, the Australian metric cup), tsp, tbsp/tbs, each/whole. Commas split off preparation. Pipe lines still use the original parser. Unreadable lines give "Line N: could not read “…”" with an example. Edit serialises in pipe format, which round-trips without loss; the natural form would drop form and aisle.
- Judgment calls for the lead: a line with no amount becomes 1 each, form "as needed" (e.g. `salt`); a pinch becomes 0.125 tsp; natural lines always use the Pantry aisle.
- Verification: `tests/unit/custom-ingredients.test.ts` 16/16 pass (one old assertion that a pipe-free line is an error was removed because that behaviour is now intended). Browser (`verify4.mjs`): garbage line reported as Line 6; natural lines saved, found in Explore, planned, shown in /shopping, and surviving reload; edit textarea shows pipe format and saves.
- Status: FIXED-VERIFIED

## CUST-12: New recipes defaulted to Chicken & turkey (P2)
- Defect: the category silently started as Chicken & turkey, so a pork recipe got the 74°C rule unless the user noticed.
- Fix: the select starts at "Choose a category" (disabled placeholder), is required, and shows an inline error "Choose a category, so the safety temperature rule can apply." Focus goes to it. The derived core-temperature rule is unchanged.
- Verification: `verify4.mjs`: default value "", inline error, focus on category, saves after choosing Beef, lamb & pork.
- Status: FIXED-VERIFIED

## RT-6: Ingredients placeholder showed the pipe format (P3)
- Fix: placeholder is now "300 g chicken breast, diced / 1 tbsp olive oil / ½ tsp smoked paprika". The hint already mentions the pipe format only under "Advanced". Unit tests cover `200 g chicken breast, diced` (preparation "diced") and `½ tsp smoked paprika`.
- Verification: tsc 0, eslint 0, vitest custom-ingredients 17/17.
- Status: FIXED-UNVERIFIED (no browser screenshot of the placeholder)
