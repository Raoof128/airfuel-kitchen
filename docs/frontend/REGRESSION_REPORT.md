# Red-team regression report: AirFuel Kitchen frontend

Independent review of the frontend repair set (42 changed files; baseline commit in `.snapshots/airfuel.git`). Target: Vite dev server at `http://127.0.0.1:5180`, hash routes. No source, test, `index.html` or config file was edited. Scripts live in `scripts/frontend-audit/tmp/redteam/`; screenshots in `docs/frontend/screenshots/redteam/`.

Status key: **LIVE** = reproduced in a browser script; **CODE** = found by reading the diff, not reproduced; **UNVERIFIED** = could not be tested here.

## Counts

| Severity | Count | IDs |
| --- | ---: | --- |
| P0 | 0 | none |
| P1 | 0 | none confirmed (see RT-7, unverified) |
| P2 | 2 | RT-1, RT-2 |
| P3 | 4 | RT-3, RT-4, RT-5, RT-6 |
| Unrated (unverified) | 1 | RT-7 |

Classification: REGRESSION means the repair caused it. PRE-EXISTING/MISSED means it predates the repair or the register did not cover it. I did not compare RT-4 or RT-6 against the baseline build, so their status is a conservative call.

## Findings

### RT-1: P2, REGRESSION, LIVE. Error toast blocks later success confirmations
- **Route:** every route that saves (verified on `/recipe/air-fryer-chicken-thighs`).
- **Files:** `src/App.tsx:141` (the auto-dismiss timer now skips error toasts), `src/App.tsx:197` (`run()` keeps the current error and drops the success message).
- **Repro (375 and 1440 are the same logic):**
  1. Open the recipe in tab B. Open it in tab A. In A, write a note and click "Save notes".
  2. In B, type a note and click "Save notes". The save is rejected: "These notes were saved in another tab. Review them before saving again."
  3. Wait 13 seconds. The error is still showing.
  4. In B, click "Save recipe". The favourite saves (`aria-pressed="true"`), but no "Favourites updated" confirmation appears. The error toast still hides it.
- **Why it matters:** before the repair the error timed out after 12 seconds; now it stays until dismissed, so a successful action can go unconfirmed for as long as the error is up. The suppression line itself predates the repair; the repair lengthened it from 12 seconds to indefinitely.
- **Evidence:** `scripts/frontend-audit/tmp/redteam/sticky-error3.mjs` (output: toast present at 0.5s, 13s, and after the successful favourite); `docs/frontend/screenshots/redteam/sticky-error-suppressed-success.png`.
- **Fix direction (for the owner, not applied):** keep errors sticky if wanted, but let a later success replace an error that is for a different operation, or show success in its own status region.

### RT-2: P2, REGRESSION, CODE. Cook mode "Keep screen awake" shows no on or off state
- **Route:** `/cook/:slug` (not on the landscape or 375 captures; the control is in the cook panel).
- **File:** `src/pages/CookMode.tsx:653-664`. The repair removed the "Screen stays awake" text and kept `aria-pressed`. A grep of every `src/**/*.css` file finds no `aria-pressed` styling for this control; the only attribute rule is `.cook-mode [aria-disabled="true"]` in `src/styles/cook-mode.css:56`.
- **Effect:** a sighted user cannot tell whether the screen will stay awake. The accessible state is still exposed, so this is a visual regression for sighted users only.
- **Repro:** open cook mode in Chrome, toggle "Keep screen awake", and compare the button before and after. No visual change is expected.
- **Evidence:** code only. I did not capture the toggled state, because wake-lock support depends on the browser and device.

### RT-3: P3, REGRESSION, CODE. Saving the shopping list silently deletes old generated ticks
- **Route:** `/shopping`, on any shopping save.
- **File:** `src/lib/db.ts:414` calls `pruneStaleGeneratedShopping` (defined near `src/lib/db.ts:127`). Generated rows whose planning week is more than 28 days old are removed, with no message.
- **Effect:** ticks on generated items disappear after four weeks. Manual items are kept. This is not user-authored data, but the change is silent and was not in the register.
- **Evidence:** code only. A live check would need a shopping row dated more than 28 days back.

### RT-4: P3, PRE-EXISTING/MISSED, LIVE. Spoon amounts do not step up a unit when scaled
- **Route:** `/cook/air-fryer-chicken-thighs?servings=100`.
- **Repro:** set Servings to 100 and press Enter. Ingredient text includes "25 tsp" (paprika, 1 tsp per 4 servings) and "12½ tsp" (mixed herbs), where tablespoons would be clearer. No NaN or undefined text appears.
- **Evidence:** `scripts/frontend-audit/tmp/redteam/hundred.mjs`; `docs/frontend/screenshots/redteam/cook-servings-100.png`.
- **Note:** the register has LOGIC-5 (tsp vs ml), not this. Not compared to baseline.

### RT-5: P3, REGRESSION, CODE. Planner day panels have inconsistent accessible names
- **Route:** `/planner` at 720px and wider.
- **File:** `src/pages/Planning.tsx:216-218`. The selected day's panel is labelled by the full date heading (`day-nav-heading`), while the other panels use their short weekday heading (`day-title-*`). At wide widths, all seven panels are visible, so screen-reader users hear a different name for the selected column.
- **Evidence:** code only. The visible layout is correct at both widths (see the visual section).

### RT-6: P3, PRE-EXISTING, LIVE. Custom recipe form asks for nine required fields, and the example teaches the advanced format
- **Route:** `/custom` (Create a recipe).
- **Repro:** fill only the name, description, category, servings, prep, air-frying, and ingredients. "Save my recipe" leaves the dialog open and shows inline errors for what one serving is, the shake or turn step, the food-safety notes, storage, the nutrition source, and the nutrition values. The errors are inline and specific, which is good.
- **Placeholder:** `src/pages/CustomRecipes.tsx:~820` shows the pipe format (`300 | g | chicken breast | ...`). Natural lines such as `200 g chicken breast, diced` work. The baseline placeholder was the same, so this predates the repair.
- **Evidence:** `scripts/frontend-audit/tmp/redteam/journey-custom-settings.mjs` (passes once all fields are filled; screenshot of the inline errors at `docs/frontend/screenshots/redteam/fail-custom-1440-0.png`).

### RT-7: Unrated, UNVERIFIED. Offline behaviour not tested
- **Route:** all routes, offline.
- **What I saw:** with `context.setOffline(true)` and a reload on `/#/explore`, the `main` element had no text and no offline notice appeared. The dev server does not register a service worker (`vite-plugin-pwa` is not enabled in dev), so this is expected here and says nothing about the production build.
- **Needed:** a production build served by the owner, then the same reload. I did not start a server on another port.
- **Evidence:** `scripts/frontend-audit/tmp/redteam/edge.mjs` (offline step).

## Journeys (mobile 375 and desktop 1440)

| Journey | 1440 | 375 | Notes |
| --- | --- | --- | --- |
| Find, favourite, tried, rate 4, note, reload, favourites, dashboard | PASS | PASS | State restored after reload; dashboard shows the recipe. |
| Plan to today's dinner, shopping amounts | PASS | PASS | Chicken thighs 4 each for 4 servings becomes 2 each for 2. Amounts scale correctly. |
| Shopping tick, clear ticked, reload | PASS | PASS | Planned items are unticked and stay on the list, which matches the dialog copy. |
| Cook: begin, two steps, timer, reload mid-timer | PASS | PASS | Remaining time was 01:57 before reload and 01:56 to 01:57 after. Within one-second display granularity this is consistent with a running timer, but not precise enough to prove it. |
| Finish and save a memory, journal, edit, delete | PASS | PASS | Edit and delete persist across reload. |
| Custom recipe with natural ingredient lines, explore, plan, shopping | PASS | not run | Long (about 100-character) name wraps with 0px horizontal overflow at 1440. Shopping shows chicken breast, rice, salt, and eggs. |
| Settings: theme, export, merge import into fresh profile, delete all | PASS | not run | Theme persists across reload. Import of the export file restores the custom recipe. Delete requires typing DELETE. |
| Mobile planner: day strip, prev and next, week edges, add to a non-today day, resize across 720px | n/a | PASS | Next and previous cross week boundaries correctly. Adding to Saturday works. The selected day survives 375 to 1024 to 375. |

## Keyboard, focus, and axe

- **Keyboard on `/explore`:** 45 Tab stops, no focus lost to body, no visible-focus gaps detected by the script. Enter on a save button keeps focus on that card (supports EXP-2).
- **Keyboard on `/planner`:** focus cycles through the page and back to the browser UI, as expected. No gaps.
- **Keyboard on `/recipe`:** the action bar, servings controls, rating buttons, and notes are reachable in order.
- **Mobile menu:** Enter opens it with focus on the menu, Escape closes it, and focus returns to the "Open navigation" button. Tab stays inside the navigation.
- **Axe (WCAG 2.0 and 2.1 A and AA):** zero violations on all 13 routes in light and dark at 375 and 1440, with populated data (`scripts/frontend-audit/tmp/redteam/audit.json`). This covers the load-time state only. Dialogs, toasts, and inline form errors were not axe-checked. The axe install was sanity-checked against a page with known violations; it flagged five.
- **Console and runtime errors:** none on any route in any journey.

## Visual comparison

- **Planner, 1440 light, baseline vs final:** the structure is unchanged. Final "Add meal" labels and the nutrition line are a little larger. No regression. Files: `docs/frontend/screenshots/baseline/planner-1440-light.png` and `docs/frontend/screenshots/final/planner-1440-light.png`.
- **Dashboard, 375:** recipe card images look empty in full-page captures. This is an artifact: the images are lazy-loaded and never load when the page is not scrolled. Source images decode at 1200px with no failed requests.
- **Not compared:** journal, settings, recipe, and dark-mode pairs. I did not review them, so I make no claim about them.
- **Polish:** the planner and dashboard read as deliberate and consistent with each other. The recipe-card placeholder labelled "Category illustration" is visible on any card whose image has not loaded, so it is worth checking in a production build.

## Edge cases

| Case | Result | Evidence |
| --- | --- | --- |
| Zero-result search ("zzqxw") | Correct empty state: "No recipes on this shelf. Try another ingredient or loosen a filter.", with "Reset search & filters" and an allergen-exclusion reassurance. | `zero.mjs`, `docs/frontend/screenshots/redteam/edge-zero-results-1440.png` |
| 100 servings | Values scale; spoon amounts do not step up units (RT-4). | `hundred.mjs` |
| Offline | UNVERIFIED (RT-7). | `edge.mjs` |
| 320px with 200% text (`html { font-size: 200% }`) on `/`, `/explore`, `/planner` | 0px horizontal overflow on all three. | `edge.mjs`, `docs/frontend/screenshots/redteam/edge-320-200pct_*.png` |
| Landscape 812x375 cook mode | No overflow; "Begin cooking" and "Done, next step" are on screen (step button at y=488 of 375 is off-screen, see below). | `docs/frontend/screenshots/redteam/edge-cook-landscape-812x375.png` |

The landscape result needs one correction: the `doneBox` y-value (488) is larger than the 375px viewport height, so the step button sits below the fold at that size. The page scrolls to it, so it is reachable, but the first screen does not show it. Not logged as a finding, since the cook panel is designed to scroll.

## Issue register claims

**Confirmed live:**
- EXP-1 (empty favourites): with no favourites the page shows "No favourites yet" and no catalogue (`fav-empty.mjs`).
- REC-7 and LOGIC-1 (stale notes): a stale save is rejected with the guard message, and the saved note is kept (`sticky-error2.mjs`). Caveat: a save after a live update is not a stale save, and it overwrites by design.
- SHELL-2 (failed save stays): the error stayed past 12 seconds (RT-1).
- EXP-2 (keyboard unfavourite drops focus): on `/explore`, Enter on a save button kept focus on the same card (`keyboard.mjs`). Only the save action was tested, not the unfavourite on `/favourites`.
- CUST-2 (too-low temperature): the form shows an inline message ("Use at least 74°C...") rather than only a toast.
- DS-1 (control contrast): supported but not proven. Axe's color-contrast rule passed on all populated routes in both themes. I did not measure the 3:1 control outlines directly.

**Not confirmed (not tested, or could not be tested):**
- CUST-1, CUST-3, CUST-7, CUST-8 (custom recipe edge cases and draft prompts).
- SET-2 (non-backup JSON message), SET-6.
- COOK-1 (each keystroke saved), COOK-2, COOK-3, COOK-4 (screen-reader behaviour not run).
- SHELL-1 (dark-system light flash), SHELL-10 (bottom nav clearance).
- JRN-7 (empty journal after reload during HMR): reproduced as not occurring on reload in my runs, but the original cause could not be reproduced, so it is neither confirmed nor refuted.
- REC-4, REC-5, LOGIC-5, LOGIC-9, LOGIC-10, PLAN-4, A11Y-11 (not tested).
- Offline support in general (RT-7).

## Items I did not complete

- Dark-mode visual review and baseline comparisons for journal, settings, recipe, and the 375 layouts. The screenshots exist; I did not compare them.
- Live check of RT-2 (wake-lock visual state) and RT-3 (generated-tick pruning).
- Keyboard pass on the custom-recipe dialog and cook mode.
- Screen-reader pass on any route.

## Round 2: verification of repairs

Re-run on the dev server at `http://127.0.0.1:5180`, read-only. Scripts: `scripts/frontend-audit/tmp/redteam/round2.mjs`, `round2b.mjs`, `wake2.mjs`. Logs and per-check JSON are in the session scratchpad. Production-only checks (offline, service worker) are left to the e2e suite, as agreed.

Environment note: headless Chromium denies the Wake Lock permission (`Wake Lock permission request denied`). The app handles that with the message "Your device couldn't keep the screen awake. Cooking progress is still saved." To see the On state, `wake2.mjs` overrides `navigator.wakeLock` with a stub. That is a test-only override, not a product result.

### CONFIRMED-FIXED

| ID | Check | Result |
| --- | --- | --- |
| RT-1 | Error and success in separate slots | A stale-note save shows the error (`.toast.error`). A later "Save recipe" shows "Favourites updated" in a separate notice (`.toast:not(.error)`). The error is still present 12 seconds later, which is intended. |
| RT-2 | Wake toggle pill and pressed state | Off: `aria-pressed=false`, pill "Off", transparent background. On: `aria-pressed=true`, pill "On" with a dark-green background (`rgb(68, 86, 55)`) and light text. Release returns to Off. Screenshot: `docs/frontend/screenshots/redteam/round2-wake-on.png`. The accessible name stays "Keep screen awake" in both states (COOK-4). |
| RT-5 | Planner panel names | At 1440, all seven visible panels are named by full date ("Monday 5 October" through "Sunday 11 October"). At 375, the single visible panel is "Sunday 11 October", the same naming scheme. |
| RT-6 | Custom placeholder natural format | Placeholder is `"300 g chicken breast, diced\n1 tbsp olive oil\n½ tsp smoked paprika"`. |
| COOK-7 | Typed servings, then one Done click | Servings typed as 3, one click: "0 of 3 complete" becomes "1 of 3 complete" and the heading moves to "Step 2". |
| COOK-7 | Double-click toggles once | "1 of 3 complete" becomes "2 of 3 complete". One step added, not two. |
| Fractions | Ingredient amounts at 2 servings | Recipe page shows "½ tsp paprika", "¼ tsp mixed herbs", "½ tsp garlic granules". No "0.x tsp" anywhere on the page. |
| Formatting | No ".." and no dangling " · " | Page text has no ".." and no "·" left at a line end or doubled. My first regex flagged "For 2 servings · One of 4 equal portions", which is a valid sentence separator, so I checked that match by hand. |
| Lazy routes | Deep links on fresh load | `/settings` ("Your kitchen, your way"), `/help` ("Welcome to your kitchen"), `/planner`, `/journal`, `/custom`, and `/cook/<slug>` all render their heading on a fresh load. |
| Lazy routes | No loader flash inside an open app | A MutationObserver during an in-app click on the Settings link counted 0 appearances of `.loading`. |
| SavedCheckbox | `aria-busy` while saving | `aria-busy` appears on the checkbox input during a shopping tick. |
| SET-2 | Wrong-schema JSON | `{"hello":"world","items":[1,2]}` shows: "This file is not an AirFuel Kitchen backup. Choose a backup exported from Settings. Problem at format." No Zod or raw JSON text. |
| COOK-1 | Typing servings keeps focus | Focus stays on the Servings field through each keystroke. The typed value "24" is held locally until blur. I did not count storage writes, so "no save per keystroke" is inferred from the draft state. |
| COOK-2 | Focus after a save | After Enter on "Done, next step", focus lands on the new step heading (H2), not on body. |
| COOK-4 | Wake toggle name | Stable name with `aria-pressed` (see RT-2). |
| JRN-7 | Journal persistence over reloads | One memory saved, then five reloads: 1 entry each time, and the note text is visible. The original empty-after-reload failure did not recur. |

### STILL-BROKEN

- **RT-4 (P3, PRE-EXISTING/MISSED): spoon amounts still do not step up a unit.** Ingredient amounts are fractions now, but at 24 servings the recipe page still reads "6 tsp paprika" and "3 tsp mixed herbs", where tablespoons would read better. This is only partly fixed: the decimal and fraction formatting is correct, and the unit scaling is still missing.

### PARTIAL (could not finish here)

- **COOK-3 (`role="status"` region):** the timer status region is present in the DOM with `display: block` when empty, so it is not hidden. I did not run a screen reader, so announcing "Time's up" is unverified.
- **COOK-1 (save per keystroke):** focus is confirmed. The absence of per-keystroke storage writes is inferred, not measured.

### NEW

No new defects found in the round-2 changes. The one behaviour worth noting: where Wake Lock is denied, the pill still reads "Off" and a status message explains why. That is accurate, not a defect.

### Not re-verified this round

- RT-3 (silent pruning of generated shopping ticks): not in the requested scope, so not re-run.
- RT-7 (offline): covered by the e2e suite, per the lead.
