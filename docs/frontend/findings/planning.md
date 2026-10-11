# Planner / Shopping / Pantry findings (agent: planning, prefix PLAN)

Scope: `src/pages/Planning.tsx` (Planner, Shopping, Pantry). Logic reviewed read-only in `src/lib/engine.ts` (`buildShoppingList`, `scaleIngredients`) and `src/lib/db.ts` (`saveShopping`).
Scripts: `scripts/frontend-audit/tmp/planning/` (flow.mjs, flow2.mjs, sweep.mjs, kbd.mjs, smoke.mjs).
Screenshots: `docs/frontend/screenshots/agents/planning/` (planner, shopping, pantry-empty × 320/375/768/1440 × light/dark).

## PLAN-1: Planner on a phone is a very long stack
- Severity: P2
- Route / component / file:line: `/planner`, `Planner` in `src/pages/Planning.tsx` (`changeWeek`, `moveDay`, `.day-strip`, `.day-nav`, `data-selected` on `.day-panel`); CSS appended to `src/styles/kitchen.css` inside `@media (max-width: 719px)`.
- Defect (what a user sees): At 375px the week rendered as seven full-width day cards with four slots each, about 4,500px tall for an empty week. Finding tomorrow's dinner meant scrolling past about 20 empty buttons.
- Root cause: the mobile layout stacked all seven days with every empty slot shown in full.
- Fix: Below 720px one day is shown at a time. A 7-day strip (weekday, date, dot when meals are planned) sits above it, with the selected day marked by `aria-current="true"`, plus Previous/Next day buttons. Today is selected by default when it is in the viewed week. A week change selects today if it is in the new week, otherwise its first day. Moving past a week edge changes the week. The desktop and tablet grid is unchanged at 720px and up. Targets are at least 44px. Chips scroll horizontally inside the strip only at 320px, where seven 44px chips do not fit. No page overflow.
- Verification: `scripts/frontend-audit/tmp/planning/verify-fix.mjs` at 320/375/768/1440, light and dark: no page overflow, axe clean, one day visible below 720px and seven at 768/1440, chip and nav targets at least 44px, previous-day moves and crosses weeks, week change resets selection, planned-dot persists after reload, no console errors. Screenshots: `docs/frontend/screenshots/agents/planning/planner-day-375-light-after-add.png`, `planner-week-768-light.png`.
- Run result: 63 of 64 checks passed in one run. The one failure ("planned dot persists after reload") was a test timing artifact: the script counted 400ms after reload, before Dexie had loaded. `dot.mjs` waits for the data and shows the dot present before and after reload. Re-run the full script after any change to confirm.
- Known limit: at 320px the seven chips do not fit, so the strip scrolls horizontally inside itself (no page scroll).
- Status: FIXED-VERIFIED

## PLAN-5: Shopping had no way to clear ticks
- Severity: P2 (feature request from lead)
- Route / component / file:line: `/shopping`, `Shopping` in `src/pages/Planning.tsx`; confirm `Modal` on the same page.
- Defect: no way to reset a finished shopping trip except unticking each row.
- Fix: "Clear ticked items" appears only when at least one item is ticked. It opens a confirm dialog that says what happens: manual ticked items are deleted, planned ingredients are unticked and stay, the meal plan is unchanged. Uses the existing `run`, `actions.deleteShopping` and `actions.saveShopping`. No `src/lib` change. A toast reports the count. Cancel ("Keep ticks") leaves everything as it was. Chosen confirm over undo because the undo would need to re-create deleted manual items.
- Verification: `verify-fix.mjs`: button hidden with nothing ticked, shown when ticked, cancel keeps 2 ticks, confirm deletes the manual item and unticks the planned one, state persists after reload, axe clean on the shopping page at 375.
- Status: FIXED-VERIFIED (same run as PLAN-1)
- Note: the clear runs as sequential writes, not one transaction. If a write fails midway the error toast shows and the dialog stays open. The list is then partly cleared, and re-running is safe.

## PLAN-2: Shopping amounts in spices show fractional ml
- Severity: P3
- Route / component / file:line: `/shopping`, `Shopping` in `src/pages/Planning.tsx:422`; conversion in `src/lib/engine.ts` `baseUnit()` (tsp → ml, ×5; tbsp → ml, ×20)
- Defect (what a user sees): With two halloumi meals planned at default servings, the list reads "smoked paprika 1.7 ml" and "olive oil 9.2 ml", where the recipes say "1 tsp". The arithmetic is correct (verified below), but ml is an awkward unit for a few grams of spice.
- Root cause: the shopping list aggregates everything in the base unit (ml), and tsp/tbsp are never shown back to the user.
- Fix: Needs other owner (logic agent, `src/lib/engine.ts`): display tsp for tsp/tbsp-derived rows (e.g. "1.7 ml ≈ 1/3 tsp") or round the displayed value sensibly. Not changed here.
- Verification: quantities checked by hand. Halloumi = 225 g × 2/6 + 225 g × 2/4 = 187.5 g (displayed 187.5 g). Olive oil = 5 ml × 2/6 + 15 ml × 2/4 = 9.17 ml (displayed 9.2 ml). Smoked paprika = 5 ml × 2/6 = 1.67 ml (displayed 1.7 ml).
- Status: NEEDS-OWNER

## PLAN-3: Ticked shopping rows are never cleaned up
- Severity: P3
- Route / component / file:line: `src/lib/db.ts` `saveShopping`; `src/pages/Planning.tsx:342` (`saved` filter)
- Defect (what a user sees): Nothing visible. When a planned meal is removed, its ticked generated rows stay in IndexedDB (`week-<date>:generated:…`) with no further use. Over months this accumulates.
- Root cause: no garbage collection of stale `saved` rows for generated items.
- Fix: Needs other owner (logic agent, `src/lib/db.ts` and `buildShoppingList` in `src/lib/engine.ts`): prune `week-*` shopping rows that no longer match a planned ingredient, with a unit test. Not changed here.
- Verification: reasoned from code; not observed in the browser.
- Status: NEEDS-OWNER

## PLAN-4: Manual shopping items appear in every week
- Severity: P3 (confirm intent)
- Route / component / file:line: `src/lib/engine.ts` `buildShoppingList` (`saved.filter(item => item.manual)`); `src/pages/Planning.tsx:342`
- Defect (what a user sees): A manual item ("Lemons") added while viewing one week also shows in every other week's list, and cannot be scoped to a week. It only goes when deleted.
- Root cause: manual items are intentionally unscoped (`manual` is not week-prefixed).
- Fix: not changed. Probably intended ("write your own items"), but worth a decision.
- Verification: `flow2.mjs` step 4 added "Lemons" and it persisted after reload.
- Status: OPEN (product decision)

## Checked and working (no defect)
- Planner add, edit (servings and recipe) and remove. Totals update ("1 meals planned" → "2 meals planned"). Persisted across reload.
- Planner → Shopping consistency: adding, removing and changing servings all update the list. Halloumi 75 g → 300 g (servings 2 → 4 on the wraps) → 75 g (wraps removed).
- Shopping ticks persist after reload ("1 of 10 items ticked off"). A tick resets when the quantity changes, which is intended (`engine.ts` `sameQuantity`).
- Manual add works and persists. Pantry subtraction works (halloumi 75 g − 50 g pantry = 25 g) and toggles off via the checkbox.
- Modal keyboard: Enter opens the Add meal dialog with focus inside; Escape closes it and focus returns to the trigger. Shopping add dialog fields are labelled.
- Responsive: no horizontal scroll at 320/375/768/1440 in planner, shopping or pantry (light and dark).
- Axe (WCAG 2.x A/AA tags via @axe-core/playwright, default rules): 0 violations on planner, shopping and empty pantry at 320/375/768/1440 in light and dark.
- Console: no errors or warnings during any flow.

## Not present in the code (from the lead's checklist)
- Shopping "clear / reset with safeguard": no clear or reset control exists.
- Shopping print / share: not implemented.
- Pantry availability states, recipe matching and missing-ingredient indicators: the Pantry page only lists items with edit and remove. Those signals may exist on recipe pages (not audited here).
- Planner drag and drop: none, so no fallback needed.

## Not verified
- Pantry with many items at 320px and populated layout (only the empty state was captured).
- Dark-mode visual quality was checked by overflow and axe only, not by eye.
- Pantry duplicate names (e.g. two "halloumi" rows) are not merged. Subtraction still sums them correctly, but the UI shows two rows. Not tested beyond code reading.

## DS-8 / DS-10 (planner and shopping parts): sub-12px text and sub-44px icon buttons
- Severity: P2
- Route / component / file:line: `src/styles.css` `.plan-totals > span`, `.day-panel header > span`, `.planned-meal > span`, `.add-meal`, `.meal-slot h3`, `.shopping-row small` (text); `.planned-meal > .icon-button`, `.shopping-row .icon-button`, `.pantry-item .icon-button`, `.week-picker .icon-button` (targets)
- Defect: text at 9–11px in planner and shopping. Icon buttons at 29×28 (planned meal), 30×36 (shopping row), 40px default (pantry and week picker).
- Fix: text raised to 12px (the 700px and 600px overrides too, so they do not drop back below 12px). Icon buttons set to `var(--tap-min)` (44px). The new single-day layout in `kitchen.css` already uses 44px. Not changed: `.timer-panel small` (cook page), `.journal-date span` and `.journal-summary span` (journal), and `.timer-controls .icon-button` (cook page, `styles.css`). Those belong to other owners.
- Verification: targets script at 320/375/768/1440, light: every visible `.icon-button` on planner, shopping and pantry is at least 44×44; text selectors report 12px or more; no page overflow; axe clean. A manual shopping row at 320 is 246px wide with no overflow, and both 44px buttons sit inside it.
- Status: FIXED-VERIFIED (planner and shopping). Cook and journal items: NEEDS-OWNER.

## A11Y-1 (planner part): day chips and "Add meal" fail Label in Name
- Severity: P2
- Route / component / file:line: `/planner`, `Planner` in `src/pages/Planning.tsx` (day chips, `.add-meal` buttons)
- Defect: accessible names did not contain the visible text ("Mon 5" / "Add meal"), and the add-meal names read ISO dates. The selected day used `aria-current="true"`, which announces a location, not a selection.
- Fix: chip names start with the visible text, e.g. "Mon 5, Monday 5 October, 2 meals planned". Chips are `aria-pressed` toggle buttons (no tablist, so no arrow-key pattern is needed). Add-meal names read "Add meal to lunch, Sunday 11 October".
- Verification: `a11y-fix.mjs` and `a11y-page.mjs` at 320/375/1440, light and dark: every chip and add-meal name starts with its visible text (whitespace-normalised); exactly one chip pressed; no `aria-current` on chips; full-page axe clean.
- Status: FIXED-VERIFIED

## A11Y-10 (planner, shopping and pantry forms): errors relied on the native bubble
- Severity: P3
- Route / component / file:line: `Planner` add-meal form, `ItemForm` (shopping add/edit and pantry add/edit) in `src/pages/Planning.tsx`; CSS `.planner-field-error` in `src/styles/kitchen.css`
- Defect: empty or invalid fields were only reported by the browser bubble.
- Fix: `noValidate` plus our own checks. Each error is shown beside its field (outside the label, so it does not join the field's name). Fields get `aria-invalid` and `aria-describedby`. A "Check the details" `role="alert"` summary appears, and focus moves to the first invalid field. A blank quantity is treated as missing rather than 0 (`Number("")` is 0). Form errors reset when the dialog closes or saves.
- Verification: `a11y-fix.mjs` at 320/375/1440: planner (blank date and servings) → alert, `aria-invalid`, `aria-describedby="date-error"`, focus on `date`, dialog stays open. Shopping (blank name and quantity) → both messages, focus on `name`. Pantry blank quantity → rejected, not saved as 0. Dialog axe clean with errors shown.
- Status: FIXED-VERIFIED (planner, shopping, pantry). Recipe and journal forms belong to their owners.

## PLAN-2 update: spoon display wired into shopping rows
- `Shopping` rows now call `formatShoppingAmount(row.quantity, row.unit)` (`src/pages/Planning.tsx`). The edit dialog still edits the raw number and unit. Pantry amounts stay raw.
- Verified on /shopping at 375 with air-fryer-halloumi (lunch) and air-fryer-sweet-potato-hash (dinner): smoked paprika shows "1⅓ tsp" (1.67 ml + 5 ml = 6.67 ml) and olive oil shows "6⅓ tsp" (1.67 ml + 30 ml = 31.67 ml). Manual "Plain flour" at 1500 g shows "1,500 g". The edit dialog reopens with 1500 and g. Axe clean, no console errors.
- Note: the unit list has no kg, so the lead's "1.5 kg" example is not possible. The closest check was 1500 g.
- Status: FIXED-VERIFIED

## RT-5: inconsistent day panel names (planner)
- Severity: P3 (regression). Every day panel was named by a different element: the selected panel by the navigator heading, the others by their short heading.
- Fix: each `section.day-panel` is labelled by `day-long-<date>`, a visually hidden full-date span in its header (e.g. "Sunday 11 October"). The selected-panel special case is removed. The visible "Sun / 11" heading is unchanged.
- Verification: `panel-names.mjs` at 375 (1 visible) and 1440 (7 visible): all 7 names are full dates in the form "Monday 5 October" ... "Sunday 11 October". Axe clean at both widths.
- Status: FIXED-VERIFIED

## SEC-14: planned meals that break current exclusions are not flagged (planner and shopping)
- Severity: P2 (safety)
- Route / component / file:line: `/planner` planned-meal cards and `/shopping` header, `src/pages/Planning.tsx` (`exclusionConflicts`, `.planned-meal-conflict`, `.shopping-conflict`); CSS in `src/styles/kitchen.css`.
- Defect: after an allergen exclusion or dietary requirement is set in Settings, planned meals that break it were shown and shopped with no warning.
- Fix: no new rule written. `exclusionConflicts` calls the existing `filterRecipes` once per preference (`excludeAllergens: [a]` or `dietary: [d]`), so the closure rules (gluten/wheat) and the fail-closed rule for custom recipes apply exactly as in recommendations. Each planned meal that fails shows an icon plus text, e.g. "Warning: Contains milk, now excluded. Keep it, or change the meal." Dietary failures read "Not vegan, now required." The shopping list shows a notice with a count ("1 planned meal conflicts with your exclusions...") and a link to the planner. Meals are kept; nothing is removed.
- Verification: `exclusions.mjs` (halloumi = milk, sweet-potato hash = egg): with milk excluded, only halloumi is flagged, both meals stay in the plan, shopping notice shows "1 planned meal conflicts", axe clean on shopping, at 375 and 1440 in light and dark, no page errors. `dietary.mjs`: vegan requirement shows "Not vegan, now required" on halloumi, planner axe clean with the warning shown. Screenshots: `exclusion-shopping-375-light.png`, `exclusion-planner-375-light.png`.
- Status: FIXED-VERIFIED
