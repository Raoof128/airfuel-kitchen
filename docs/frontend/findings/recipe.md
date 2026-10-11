# Recipe Details findings (agent: recipe, prefix REC)

Scope: `src/pages/RecipeDetail.tsx`, recipe-detail selectors in `src/styles.css`.
Recipes exercised: air-fryer-chicken-thighs (functional, full), air-fryer-beef-joint, air-fryer-halloumi (plant), air-fryer-sweet-potato-jackets-with-tahini-yogurt (longest title), dal-with-air-fryer-tofu (most ingredients, 18), air-fryer-muffins (layout only).

## REC-1: Print hides the protein headline but shows the macro row
- Severity: P2
- Route / component / file:line: `/recipe/<slug>` print output; `src/styles.css` print block (`.nutrition-primary { display: none }`, was ~line 2753)
- Defect (what a user sees): Printed recipe shows "kcal / carbs / fat" with no protein figure, the headline number of the block.
- Root cause: print CSS hid `.nutrition-primary` while `.macro-row` still printed.
- Fix: removed the `display: none` rule for `.nutrition-primary` from the print block so the protein headline prints.
- Verification: `scripts/frontend-audit/tmp/recipe/verify.mjs` under `emulateMedia("print")` reports `.nutrition-primary` display `flex` (was `none`).
- Status: FIXED-VERIFIED

## REC-2: Servings field rejects incomplete typing
- Severity: P2
- Route / component / file:line: `/recipe/<slug>` Ingredients servings input; `src/pages/RecipeDetail.tsx` (servings `<input>`, `servingsDraft` state)
- Defect (what a user sees): The servings box snaps back to the previous value on every intermediate keystroke. It cannot be cleared, and "0.5" cannot be typed from a larger value (typing "0" is rejected).
- Root cause: controlled input bound straight to `servings`; out-of-range or empty intermediate text was dropped in `onChange`.
- Fix: keep the typed text in `servingsDraft` while it is in progress. Only values in [0.5, 100] update `servings` (and the active cooking session). The draft is cleared on blur, so the field shows the committed value again.
- Verification: `verify.mjs`: empty field stays editable; "0.5" typed gives 0.5 scaled quantities; "0" stays as typed and does not change quantities; blur restores 4. Also `npx eslint src/pages/RecipeDetail.tsx` clean.
- Status: FIXED-VERIFIED

## REC-3: Rating group is unlabelled and the clear button is ambiguous
- Severity: P2
- Route / component / file:line: `/recipe/<slug>` "Your recipe notes" rating; `src/pages/RecipeDetail.tsx` (`.rating-control`, "Clear" button)
- Defect (what a user sees): A screen reader gets no group name for the stars (`aria-label` on a plain div is not announced). The clear button is just "Clear" with no context.
- Root cause: `aria-label` on a `div` with no role; generic button text.
- Fix: `role="group"` on the rating container; the clear button now has `aria-label="Clear rating"`.
- Verification: `verify.mjs`: `getByRole("group", { name: "Your recipe rating" })` resolves; `getByRole("button", { name: "Clear rating" })` present after rating. Axe on the page reports no violations. Stars remain native buttons with `Rate n stars` names and `aria-pressed`. Tab/Enter keyboard path was not separately scripted; native buttons are keyboard-operable by default.
- Status: FIXED-VERIFIED

## REC-4: Fixed bottom nav covers macro block at 375px (baseline)
- Severity: P1 as reported in the brief; not reproduced in live view
- Route / component / file:line: `/recipe/<slug>` 320/375; `.mobile-bottom-nav` in `src/styles/kitchen.css` (~line 767)
- Defect (what a user sees): In the baseline full-page capture (`docs/frontend/screenshots/baseline/recipe-375-light.png`) the "11g protein" headline appears partly under the nav.
- Root cause: capture artifact. The fixed nav is placed at the viewport bottom in a full-page screenshot. In a live viewport the nav sits on top of scrolled content only as expected.
- Checks: at 320/375/768/1440, light and dark, six recipes: no horizontal overflow; `.mobile-bottom-nav` is hidden at 1440; at 320/375/768 scrolling to the footer leaves the footer above the nav (`coversFooter` false); `main` has 76-80px bottom padding. Live 375px screenshot at scroll 320 (`docs/frontend/screenshots/agents/recipe/chicken-375-light-y320.png`) shows the nav at the viewport bottom with hero, summary and timing readable.
- Hero/summary ordering: stacked (image then summary) at 320/375; two-column at 768 and 1440 with image and summary top-aligned. No defect found.
- Status: WONT-FIX (not reproducible in live layout; no code change)

## REC-5: Action bar wraps to three rows at 320px
- Severity: P3
- Route / component / file:line: `/recipe/<slug>` action bar; `.recipe-action-bar` in `src/styles.css`
- Defect: At 320 the five actions wrap into staggered rows (2 + 2 + icons). Nothing overflows or is clipped; `scrollWidth` equals `clientWidth` at 320, 375, 768 and 1440.
- Status: WONT-FIX (cosmetic, no clipping; evidence `docs/frontend/screenshots/agents/recipe/actionbar-320-dark.png`)

## Checked, no defect found
- Back link: returns to the remembered explore location (`#/explore?category=dinner&sort=protein` after visiting a filtered explore page).
- Favourite: toggles, `aria-pressed` correct, persists after reload.
- Mark as tried: toggles to "Tried · undo" and back; persists after reload.
- Servings stepper: +/- scales ingredients; disabled at 0.5 and 100; "For N servings" caption updates.
- Ingredient and step checkboxes: persist after reload.
- Add ingredients: writes shopping items, toast shown.
- Add to meal plan: dialog submits and closes.
- My adjustments: rejects a changed temperature without changed steps with an inline error.
- Start cooking: navigates to `#/cook/<slug>?servings=N`.
- Cooking memory dialog opens with its full set of fields.
- Notes: draft status is accurate while typing; draft survives reload (note-drafts unit test passes, 4/4); saved notes persist after reload; clearing and saving works.
- Safety section: visible in the method column, and in print.
- Axe scan (chicken thighs, light, 1280): no violations.
- Console and page errors during the sweep: none.

## Not verified
- Dark-mode visual comparison was done by layout measurement and one screenshot at 320, not a full pixel review.
- Batch warning copy is static ("Larger portions may need batches…") at all servings. Left unchanged because it carries cooking-safety guidance; not changed to avoid hiding safety information.
- Print in a real print dialog was verified through computed styles under `emulateMedia("print")`, not a printed PDF.
- tsc: 3 errors reported in files I do not own (`src/App.tsx:42`, `src/pages/Settings.tsx:123`, `src/pages/Settings.tsx:241`); none in `RecipeDetail.tsx`.

## Needs other owner
- None.

## REC-6: Sub-12px text on recipe-detail selectors (from DS-8)
- Severity: P2
- Route / component / file:line: `src/styles.css`: `.ingredient-list small` (was 11px, ~l.1186), `.safety-note p` (was 12px screen, 10px print, ~l.1313 and ~l.2831), `.provenance` (was 9px print, ~l.2845), `.recipe-action-bar .button` (was 11px at the mobile breakpoint, ~l.2520), `.method-list label` (was 11px print, ~l.2822). `.ingredient-list label` and `.ingredient-notes p` print rules (10px) also raised.
- Defect (what a user sees): small helper text and food-safety copy below 12px; print provenance at 9px.
- Root cause: hand-set small font sizes in both screen and print media blocks.
- Fix: screen `.ingredient-list small` to 12px; screen `.safety-note p` to 14px (safety copy kept prominent); print `.provenance`, `.safety-note p`, `.ingredient-list label`, `.ingredient-notes p` and `.method-list label` raised to 12px. The mobile `.recipe-action-bar .button` 11px rule raised to 12px, but `kitchen.css` sets 13px at that breakpoint and wins, so the rendered size is 13px.
- Verification: `scripts/frontend-audit/tmp/recipe/fontcheck.mjs` at 320/375/1440 computed sizes: `.ingredient-list small` 12px, `.safety-note p` 14px, `.recipe-action-bar .button` 13/13/14px, `.method-list label` 13px; overflow 0 at all three widths; no clipped elements. The 320px action bar still stacks as before (`docs/frontend/screenshots/agents/recipe/actionbar-320-light-12px.png`); no worse wrapping.
- Status: FIXED-VERIFIED (print values verified by CSS edit only, not by a printed PDF)

## REC-7: Notes overwrite across tabs; add-ingredients resets ticks (from logic agent)
- Severity: P1 (notes), P2 (shopping)
- Route / component / file:line: `/recipe/<slug>` "Save notes" and "Add ingredients"; `src/pages/RecipeDetail.tsx` (`savedNotes` state, Save handler, `addShopping`)
- Defect (what a user sees): tab A's unsaved notes overwrote tab B's saved notes without warning. Re-adding ingredients reset ticks already set on the shopping list.
- Root cause: notes save wrote unconditionally. Shopping ids are stable per recipe and position, so re-adding replaced rows with `checked: false`.
- Fix: notes save goes through `actions.saveRecipeNotes(recipe.id, note, savedNotes)`, which rejects when the stored notes differ from this tab's baseline. `savedNotes` is set on load and after a successful save, and is not refreshed from storage while this tab has unsaved edits. Add ingredients keeps the stable ids (random ids would add duplicate rows on each click, so I did not use them) and carries over each row's existing `checked` state.
- Verification: two-tab script (`tmp/recipe/logic2.mjs`): tab A's save is rejected with "…saved in another tab. Review them before saving again."; tab A keeps its draft; tab B reload shows the stored "from tab B". Re-add script (`tmp/recipe/shop.mjs`): a ticked item stays ticked after re-adding, with 6 rows for 6 ingredients. `npx eslint src/pages/RecipeDetail.tsx` clean; tsc reports no RecipeDetail errors.
- Status: FIXED-VERIFIED

## A11Y-5/6/10 (from lead): toggle names and form validation
- Severity: A11Y-5 P2, A11Y-6 check, A11Y-10 P3
- Route / component / file:line: `/recipe/<slug>` "Save recipe" and "Mark as tried" toggles; "Add to meal plan" dialog (`PlanForm`); "My adjustments" dialog; `src/pages/RecipeDetail.tsx`
- Defect (what a user sees): The toggle names changed with state ("Saved" / "Tried · undo") while `aria-pressed` was also set, so the accessible name was not constant. Validation relied on the native browser bubble; no inline message, no `aria-invalid`, no focus move.
- Root cause: toggle labels were state-driven; forms were not `noValidate`.
- Fix: "Save recipe" and "Mark as tried" keep a constant visible and accessible name; state is carried by `aria-pressed` and the filled icon / `selected` style (same approach as the heart button in `UI.tsx`). The "Tried · undo" hint is gone; the toast still says the status can be undone. Plan form: `noValidate`, inline messages (`#plan-date-error`, `#plan-servings-error`), `aria-invalid` and `aria-describedby` on the failing inputs, focus moves to the first invalid field. Adjustments form: `noValidate`, focus moves to the first `:invalid` field and the existing alert explains the problem.
- Verification: `tmp/recipe/a11y.mjs`: "Save recipe" and "Mark as tried" each have one control with a constant name; `aria-pressed` flips and persists after reload. Plan form empty date and servings 0 show both messages with `aria-invalid` on both fields and focus on date. Adjustments with temp 300 focus `temp` and show the alert. eslint clean; no tsc errors in `RecipeDetail.tsx`.
- Status: FIXED-VERIFIED for A11Y-5 and A11Y-6. A11Y-10 PARTIAL: the adjustments form has focus and a single alert but no per-field `aria-invalid`/`aria-describedby`; the plan form is complete.

## A11Y-10 follow-up: adjustments form per-field errors (completes REC-8)
- Fix: `adjustErrors` state drives per-field `aria-invalid` and `aria-describedby` on temp, cook and steps, each with an inline message (`#adjust-temp-error`, `#adjust-cook-error`, `#adjust-steps-error`). The steps-mismatch rule is now a steps field error. Focus moves to the first failing field. The form-level alert is kept only for a failed save.
- Verification: `tmp/recipe/adjust.mjs`: temp 300 gives `aria-invalid="true"`, `aria-describedby` pointing at an existing message, and focus on temp; temp fixed with steps unchanged gives the steps message; empty cook focuses cook; a valid save closes the dialog. eslint clean; no tsc errors in `RecipeDetail.tsx`.
- Status: FIXED-VERIFIED (A11Y-10 for both forms; REC-8 is now complete)
