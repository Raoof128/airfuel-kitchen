# Explorer findings (EXP)

Owner: `explorer`. Routes: `/explore` (with query strings), `/favourites`.
Owned files: `src/pages/Explorer.tsx`; Explorer-specific selectors in `src/styles.css`.
Probe scripts: `scripts/frontend-audit/tmp/explorer/probe1..9.mjs`.

## EXP-1: Favourites view shows all recipes after removing the "favourites" token
- Severity: P1
- Route / component / file:line: `/favourites` · `src/pages/Explorer.tsx` active-filter block (`collectionFiltered`, token list), "My collection" select
- Defect (what a user sees): On `/favourites` a "favourites" filter token appeared (and the Filters button read "Filters (1)" even on an empty favourites page). Clicking the token set the collection to "All recipes", so the page titled "Your favourites" listed all 300 recipes.
- Root cause: `status` is forced to `"favourites"` on this route, but `activeFilters` and the token list treated any non-"all" status as a user-chosen filter.
- Fix: the collection is only a filter on `/explore`. `collectionFiltered = !favourites && status !== "all"` drives both the count and the token. The "My collection" select is hidden on the favourites route.
- Verification: `probe4.mjs`, `probe2.mjs`: before, "fav tokens: ['favourites']" and "after removing favourites token: count 300". After, "fav tokens: []", "Filters" with no count. `probe3.mjs`: `fav filters label: Filters`.
- Status: FIXED-VERIFIED

## EXP-2: Keyboard unfavourite on /favourites drops focus to <body>
- Severity: P1
- Route / component / file:line: `/favourites` · heart button in `src/components/UI.tsx` (`RecipeCard`), results list in `src/pages/Explorer.tsx`
- Defect (what a user sees): Pressing Enter on a heart to remove a favourite makes the card disappear and focus goes to the page body. A keyboard user has to tab from the top of the page again.
- Root cause: the focused card unmounts; nothing moves focus.
- Fix: the results heading (`.results-heading`, `tabIndex={-1}`, ref) receives focus when the favourites view loses results while focus is on `<body>`. Mouse users see no change.
- Verification: `probe4.mjs`: "focus after keyboard unfavourite: DIV results-heading" (before: BODY). Toast still shows "Favourites updated" and the aria-live count still announces the change.
- Status: FIXED-VERIFIED

## EXP-3: Empty favourites page says "No recipes on this shelf" with a reset button
- Severity: P2
- Route / component / file:line: `/favourites` (zero favourites) · `src/pages/Explorer.tsx` empty-state branch
- Defect (what a user sees): A new user who opens Favourites sees "No recipes on this shelf. Try another ingredient or loosen a filter" and "Reset search & filters", which do nothing useful.
- Root cause: one generic empty state for both views.
- Fix: when the favourites view has no saved recipes and no search or filter is active, show "No favourites yet" with "Tap the heart on any recipe to keep it here." and an "Explore recipes" link. Otherwise the generic empty state stays. `Empty` now receives the button as `action`, not inside `<p>`.
- Verification: `probe2.mjs`: "fav empty state text: No favourites yet Tap the heart on any recipe to keep it here. Explore recipes". Screenshots: `docs/frontend/screenshots/agents/explorer/capture/favourites-*.png`.
- Status: FIXED-VERIFIED

## EXP-4: Mobile filter panel pushes results about 700px down with no way back
- Severity: P2
- Route / component / file:line: `/explore` at 320/375 · `src/pages/Explorer.tsx` filter panel
- Defect (what a user sees): At 375px the open filter panel is about 1,000px tall and sits above the results. To see the results, a user has to scroll past the whole panel.
- Root cause: the panel is inline, not a sheet, and there is no action that leaves it.
- Fix: the panel ends with a "Show N recipes" button that closes the panel and moves focus to the results heading. The button label follows the live count. Not a full bottom sheet: the inline panel stays, but it now has a clear exit. A sheet remains an option if the lead wants one.
- Verification: `probe5.mjs`: "panel open after show: 0 focus: results-heading". Screenshot `docs/frontend/screenshots/agents/explorer/after-filters-bottom-375-dark.png` shows the "Show 67 recipes" button. No horizontal overflow at 320 or 375 (`probe3.mjs`, capture run 0 overflow).
- Status: FIXED-VERIFIED (partial: inline panel kept, see above)

## EXP-5: axe heading-order violation on /explore
- Severity: P2 (a11y)
- Route / component / file:line: `/explore` results · `src/pages/Explorer.tsx` results branch
- Defect (what a user sees): Screen-reader heading navigation goes from the page h1 straight to recipe-card h3s. axe reports `heading-order`.
- Root cause: no h2 between the page title and the card titles.
- Fix: a visually hidden `<h2>Recipe results</h2>` (existing `.sr-only`) before the grid.
- Verification: `probe3.mjs` before: `heading-order (moderate) x1`. `probe5.mjs` after, at 375 dark with the panel open: `[]`.
- Status: FIXED-VERIFIED

## EXP-6: Typing lag with 300 recipes
- Severity: P2
- Route / component / file:line: `/explore` search input · `src/pages/Explorer.tsx` results computation
- Defect (what a user sees): On every keystroke the list recomputed synchronously and blocked the input. A 31-character burst produced 5 long tasks of 50–70ms each.
- Root cause: `filterRecipes` ran on each render from the raw input value, with no memoisation and no deferral.
- Fix: the input updates immediately; the list uses `useDeferredValue(search)`; results are memoised (`useMemo`) on the filter values and `data.recipeStates`.
- Verification: `probe4.mjs`: before `longtasks: [63, 70, 60, 55, 50]`, 2633 ms; after `[59, 61]`, 2113 ms for the same 31 keystrokes (headless Chromium, 1440 viewport, 30 ms key delay). Residual 60 ms tasks are probably the 24-card render; not measured further. No debounce was added: the deferred value gave the same effect without delaying results.
- Status: FIXED-VERIFIED (improved, not eliminated; headless measurement only)

## EXP-7: Hand-edited `?category=` produced a hidden filter with no usable chip
- Severity: P3
- Route / component / file:line: `/explore?category=bogus` · `src/pages/Explorer.tsx` category state init
- Defect (what a user sees): The page showed "0 recipes" with a "bogus" filter token. Its label was the raw value, and the only way out was Reset.
- Root cause: URL values were not validated against `categoryLabels`.
- Fix: a category from the URL is applied only if it is a known key.
- Verification: `probe6.mjs`: "bogus category: 300 recipes to discover tokens: []".
- Status: FIXED-VERIFIED

## EXP-8: Whitespace-only search written to the URL as `q=++`
- Severity: P3
- Route / component / file:line: `/explore` · `src/pages/Explorer.tsx` URL sync effect
- Defect (what a user sees): Typing spaces left `q=++` in the address bar and made the link look like it had a search.
- Root cause: the raw input value was written to the URL.
- Fix: `q: search.trim()`.
- Verification: `probe9.mjs`: "hash after whitespace: #/explore?sort=protein", count 300.
- Status: FIXED-VERIFIED

## EXP-9: Quick chip says "Under 20 minutes", active token says "Up to 19 min"
- Severity: P3
- Route / component / file:line: `src/pages/Explorer.tsx` active-filter token for `time`
- Defect (what a user sees): The chip and its token name the same filter in different words.
- Root cause: the time filter stores the maximum (19) and the token shows the maximum.
- Fix: none. Both select the same recipes (`totalMinutes <= 19` is `< 20` for whole minutes).
- Verification: `probe8.mjs` shows both tokens and the same counts.
- Status: WONT-FIX (cosmetic; same result set)

## EXP-10: Recipe card title links are about 30px tall on mobile
- Severity: P2 (touch target)
- Route / component / file:line: `/explore` cards · `src/components/UI.tsx` `RecipeCard` (`h3 > a`)
- Defect (what a user sees): On 375 the title link on each card is about 30px high, below the 44px target the brief asks for (WCAG 2.2 AA minimum is 24px, so it passes AA). Only the title text is tappable, not the card body.
- Root cause: the link is text-height only.
- Fix: Needs other owner: `src/components/UI.tsx` (shell owner). Give the title link `display: block` with `padding-block: 6px` or `min-height: 44px`, or make the card body the link target.
- Verification: `probe3.mjs` at 375: "A. 'Oil-free herb pork loin' 257x30", and 3 others at 230–260px wide.
- Status: NEEDS-OWNER

## Checked and working (no change needed)
- README search examples: "chicken breast" → 22, "under 20 minutes" → 24 (cap of the first page, count is exact), "no oil" → 37, "more than 40g protein" → 44; nonsense "zzqxv nonsense" → 0 with empty-state copy; "EGGS" matches "egg" (`probe1.mjs`).
- Category chips set `category` and the URL; "All recipes" clears (`probe6.mjs`).
- Sort options: `sort=time` orders 10, 11, 11, 13, 13 min (`probe6.mjs`).
- Every active-filter token removes its own filter; "Clear all" and the panel's "Reset filters" return to `?sort=protein` (`probe8.mjs`).
- Back navigation from a recipe restores `?q=chicken&sort=time`, the search box and the sort select; reload restores them too; same-route hash edits re-sync state through the `routeRevision` remount (`probe2.mjs`).
- Favourite and "Tried ✓" badges sync between recipe detail, explore cards and favourites, and survive reload (`probe7.mjs`).
- "Surprise me" navigates to a recipe from the current results (`probe6.mjs`).
- Keyboard: Filters opens with Enter; number input and allergen checkbox operated from keyboard; results update (`probe5.mjs`).
- Overflow: 0px horizontal overflow at 320 and 375, explore and favourites, light and dark (`capture.mjs explore,favourites`, 20 captures, 0 overflow or console errors).
- Console errors: none across all probes.
- Card heart label: now a stable "Save X to favourites" with `aria-pressed` (changed by the shell owner in `UI.tsx`). Earlier label/state mismatch no longer applies.

## Not verified
- Visual review of the 768, 1024 and 1440 captures; the capture run checked overflow and errors only.
- Screen-reader output (no NVDA/VoiceOver run).
- Performance on a real device; all timings are headless Chromium.
- Light-theme 375 after-fix screenshot (dark was the one reviewed).

## Files changed
- `src/pages/Explorer.tsx`
- `src/styles.css` (only the `.filter-bottom` block and the new `.filter-actions` rule, added next to it)

## Checks run
- `npx tsc -p tsconfig.app.json --noEmit`: no errors in Explorer.tsx. One unrelated error in `src/pages/Settings.tsx:131` (TS2352), not touched.
- `npx eslint src/pages/Explorer.tsx`: exit 0.
- `npx vitest run tests/unit/engine.test.ts`: 8 passed.

## EXP-11: Favourites header repeats the catalogue count
- Severity: P3
- Route / component / file:line: `/favourites` · `src/pages/Explorer.tsx` `PageHeading` description
- Defect (what a user sees): The page "Your favourites" said "300 source-checked recipes… Your next good meal starts here." above an empty or short list.
- Root cause: one description for both views.
- Fix: on the favourites route the description reads "Recipes you have saved with the heart, ready when you are."
- Verification: tsc (no Explorer errors), eslint exit 0, `probe2.mjs`/`probe3.mjs` re-run with no console errors and 0 overflow. Visual check of the header in `docs/frontend/screenshots/agents/explorer/capture/favourites-375-light.png` (captured before this one-line copy change; the copy change itself was not re-screenshotted).
- Status: FIXED-UNVERIFIED (copy only; logic re-run passes)

## DS-8 (from design-system agent): sub-12px sort label and select
- Severity: P2 (type size below the 12px floor; 44px touch target)
- Route / component / file:line: `/explore` results heading · `src/styles.css` `.results-heading label` / `select` (mobile block at ~2468, base at ~830), `src/styles/kitchen.css` `.results-heading select` (~563)
- Defect (what a user sees): The "Sort by" label was 10px and the select 11px between 601px and 700px wide. The desktop select was 13px and 38px tall in `styles.css`, overridden by `kitchen.css` to 44px.
- Root cause: the same selectors were set in several places with conflicting sizes; `kitchen.css` loads last and wins.
- Fix: label 13px and select 14px on desktop, 16px on phones (avoids iOS zoom), 44px min-height everywhere, border `var(--line-control)`. Mobile label raised from 10px to 13px.
- Verification: `probe10.mjs` computed styles: 320/375 label 13px, select 16px, height 44px; 650/768/1440 label 13px, select 14px, height 44px; border rgb(122,134,115) 1px at all widths. eslint exit 0.
- Status: FIXED-VERIFIED

## A11Y-3: quick filter group has a label but no role
- Severity: P2
- Route / component / file:line: `/explore` · `src/pages/Explorer.tsx` `.quick-filters`
- Defect (what a user sees): Screen readers ignore the "Quick recipe filters" name because a div with aria-label and no role is not announced as a group.
- Root cause: missing `role`.
- Fix: `role="group"` on the container, matching the category tabs.
- Verification: `probe11.mjs`: role group, name "Quick recipe filters"; axe violations []. eslint exit 0.
- Status: FIXED-VERIFIED
