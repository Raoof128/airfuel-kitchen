# Journal findings (agent: journal)

Scope: `src/pages/Journal.tsx`, `src/components/SessionForm.tsx`, journal selectors in `src/styles/kitchen.css`.
Scripts: `scripts/frontend-audit/tmp/journal/` (flow1, flow2, flow3, measure, select).
Screenshots: `docs/frontend/screenshots/agents/journal/`.

## JRN-1: Cooking memory cards squeeze the notes into a narrow column on phones
- Severity: P2
- Route / component / file:line: `/journal`, `.journal-entry` grid in `src/styles/kitchen.css` (max-width 600px block, ~L1171)
- Defect (what a user sees): on 320 and 375 the date tile took 55px plus a gap, so long notes wrapped to about 217px (320) or 264px (375). A single long note made a card over 1300px tall, with a wide empty gutter on the left.
- Root cause: two-column grid (date | content) applied at phone widths.
- Fix: at max-width 600px the entry is a single column. The date becomes an inline row above the content, and the actions sit in the second row. Added `.session-form .form-grid` single column (see JRN-2).
- Verification: `scripts/frontend-audit/tmp/journal/measure.mjs`. Content width 320: 217 -> 288px. 375: 264 -> 335px. Card height at 375 with the long test note: 1090 -> 851px. No horizontal overflow at 320, 375 or 768. Screenshot: `docs/frontend/screenshots/agents/journal/journal-populated-375-light.png` (taken before the fix).
- Dark check: `docs/frontend/screenshots/agents/journal/journal-after-fix-375-dark.png`, no overflow, axe clean.
- Status: FIXED-VERIFIED

## JRN-2: Rating select truncates "Not rated" in the session form on phones
- Severity: P2
- Route / component / file:line: Log/Edit cooking memory modal, `src/components/SessionForm.tsx` (form now has `session-form` class)
- Defect (what a user sees): at 375px the Rating select was 110px wide and the "Not rated" label was clipped.
- Root cause: shared two-column `.form-grid` inside a narrow modal.
- Fix: `.session-form .form-grid { grid-template-columns: minmax(0, 1fr) }` at max-width 600px, inside the journal block of `kitchen.css`. The shared `.form-grid` is untouched.
- Verification: `scripts/frontend-audit/tmp/journal/select.mjs`. Select width at 375: 110 -> 295px. At 320: 240px. At 768 the two-column grid is unchanged (269px).
- Status: FIXED-VERIFIED

## JRN-3: Recipe title appears twice in the session form
- Severity: P3
- Route / component / file:line: `src/components/SessionForm.tsx` (muted `recipe.title` line), `src/pages/Journal.tsx` add path
- Defect: on the Journal add path the recipe name is in the picker and again as a muted line under it.
- Fix: new optional `showRecipeTitle` prop (default true). Journal passes `showRecipeTitle={Boolean(session)}`, so the line is hidden only when the picker is visible. The form now has `aria-label="Cooking session for <recipe>"`, so it has an accessible name in all three places.
- Verification (`scripts/frontend-audit/tmp/journal/verify2.mjs`, `verify3.mjs`): Journal add: form named, no muted recipe line. Journal edit: named, title kept. Recipe page dialog "A cooking memory": named, title kept. Cook mode "How did your cook go?": named, title kept.
- Status: FIXED-VERIFIED

## JRN-4: Edit button is disabled with no explanation when the recipe is missing
- Severity: P2
- Route / component / file:line: `src/pages/Journal.tsx`, entry actions
- Defect: if a session's recipe is no longer on this device, the pencil button was greyed out with no reason given.
- Fix: the edit button is no longer rendered when the recipe is missing. The card shows "Recipe not on this device. Import a backup to edit this memory. You can still delete it." Delete remains.
- Verification: planted a session with `recipeId: "missing-recipe-xyz"` directly in IndexedDB, reloaded. Entry shows the note, 0 edit buttons, 0 cook-again links, delete works (memory removed), axe clean.
- Status: FIXED-VERIFIED

## JRN-5: Clearing a rating on a session does not clear the recipe's rating
- Severity: P3
- Route / component / file:line: `src/lib/db.ts` `saveCookingSession` (`...(input.rating === null ? {} : { rating })`)
- Defect: if a user empties Rating on a session edit, the recipe's stored rating stays. The UI shows "Not rated" for the session but the recipe still shows the old value.
- Needs other owner: `src/lib/db.ts` (logic owner). Decide whether an empty session rating should clear the recipe rating, then add a unit test. Not changed by me (db.ts is out of scope and the brief forbids edits there without the logic agent).
- Status: NEEDS-OWNER

## JRN-6: "Cook again" has no action on the entry
- Severity: P3
- Route / component / file:line: `src/pages/Journal.tsx` entry content; `.journal-again` in `src/styles/kitchen.css`
- Defect: the journal shows "Would cook again" but no path back to cook it.
- Fix: each entry whose recipe exists gets a "Cook again" button-styled link to `#/cook/<recipe.slug>` (cook mode, since the goal is to cook). Accessible name: "Cook again: <recipe title>".
- Verification: link count 1, href `#/cook/air-fryer-halloumi`, aria-label "Cook again: Golden halloumi slices". Entry screenshot: `docs/frontend/screenshots/agents/journal/journal-entry-cook-again-375-light.png` (the toast overlaps the link in that capture only).
- Status: FIXED-VERIFIED

## Round 2 reload persistence
Five runs (`scripts/frontend-audit/tmp/journal/reload5.mjs`): fresh context, save a session, wait 800ms, reload, wait 2000ms before counting. Results: before=1 after_reload=1 notes correct in all five. No page errors. No zero-entry case.

Earlier single 0-entry result from round 1 was not reproduced in 3 + 5 subsequent runs. It was captured only once, during a dev-server HMR reload, and I did not capture the exact state at that moment. Treat it as unexplained, not as a confirmed defect.

## Checked and working
- Empty state: copy and CTA render. axe: no violations.
- Log a cook modal: focus moves to the close button on open. Escape closes and focus returns to "Log a cook". axe on dialog: no violations.
- Validation: empty "Servings prepared" blocks submit with the native message.
- Save: entry appears with en-AU date ("11 / Oct 2026"), rating, servings, minutes, long notes, air-fryer setting and "Would cook again". Toast "Cooking memory saved". Survives reload (three repeat runs, 1 entry each).
- Edit: opens with prefilled values; save updates the card.
- Delete: asks for confirmation; "Keep memory" keeps the entry; "Delete memory" removes it and shows the empty state. Entry deletion does not reset the recipe's tried flag, which matches the dialog copy.
- Recipe page: "Save a cooking memory" button present (form reuse). Cook mode finish form opens from "Finish & save".
- No console or page errors in any run.
- `npx tsc -p tsconfig.app.json --noEmit`: 0 errors at time of round 2.
- `npx eslint src/components/SessionForm.tsx src/pages/Journal.tsx`: clean.

## Not verified
- 1440 / 1024 captures for the journal changes (the fixes are inside the max-width 600px block, so desktop layout is unchanged by construction, but not screenshotted).
- Cook mode save end to end (the finish form opens and is named, but I did not submit it from cook mode).
- Full keyboard-only pass through the modal (Tab cycling was not scripted).
- Sort/filter: the page has no filter, only a date sort.

## DS-8: Sub-12px text on journal selectors (round 3)
- Severity: P2
- Selectors: `.journal-date span`, `.journal-summary span`, `.journal-content .recipe-meta`
- Defect at start of round 3: date span 10px (8px in one stale rule), summary span 11px at 1440, recipe meta 11px in a stale narrow rule.
- Fix: all three raised to 12px in `src/styles.css` (base and narrow blocks) and `src/styles/kitchen.css` (max-width 600px block). Stale 8px/10px/11px declarations removed.
- Verification (`scripts/frontend-audit/tmp/journal/ds8.mjs`): computed sizes at 320, 375, 1440 are all 12px for the date span and summary span. Recipe meta is 14px on phones and 12px at 1440, so none below 12px. No horizontal overflow at any width.
- Status: FIXED-VERIFIED

## DS-10: Journal icon buttons below 44px hit area
- Severity: P2
- Finding: the stale narrow rule in `src/styles.css` set `.journal-actions .icon-button` to 28x35. The unconditional 44px rule in `src/styles/kitchen.css` (~L603) overrides it, so the rendered size was already 44x44 at 320, 375 and 1440.
- Fix: the stale narrow rule now uses `var(--tap-min)` (44px) for min-width and min-height, so the 28px values cannot come back.
- Verification (`ds8.mjs`): rendered icon button 44x44 at 320, 375 and 1440. Card remains intact at 320 (`journal-entry-320-light.png`, no overflow).
- Status: FIXED-VERIFIED

## A11Y-10: SessionForm relied on the native validation bubble (P3)
- Fix: `noValidate` on the form. Inline messages sit next to each invalid field, outside its `<label>` so the field's accessible name stays short. Each field gets `aria-invalid` and `aria-describedby` (the message, plus the "Only these count…" hint on Servings you ate). On submit, the first invalid field is focused. Errors clear as the user edits that field. Checks: date required; prepared 0.5–100 in halves; consumed 0–100; actual minutes 0–1440 (optional); air-fryer setting 40–260 (optional). The save-error alert is unchanged.
- Files: `src/components/SessionForm.tsx`, `src/styles/kitchen.css` (`.session-field-error`, `.session-field [aria-invalid][name]`). The extra attribute selector is needed because the input's `1px solid` shorthand has higher specificity than `.stack-form [aria-invalid]`.
- Verification (`scripts/frontend-audit/tmp/journal/a11y10.mjs`, `border.mjs`) at 375 light, in all three places (Journal add, recipe page dialog, cook mode finish):
  - blank prepared and 150 eaten: both fields flagged, messages shown, focus on Servings prepared, no native bubble (`noValidate`).
  - accessible names unchanged: "Servings prepared" and "Servings you ate" still match by role and name.
  - the invalid border computes to `#a32c2c` (danger).
  - axe clean in the dialog in all three places.
  - after correcting, the form saves and closes with no errors left.
- Screenshot: `docs/frontend/screenshots/agents/journal/session-validation-journal-add-375-light.png`.
- Status: FIXED-VERIFIED
