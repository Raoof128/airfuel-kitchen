# Dashboard findings (route `/`, Today)

## DASH-1: Invisible search submit button was a Tab stop
- Severity: P2
- Route / component / file:line: `/` · `src/pages/Dashboard.tsx` (search form, `.sr-only` button)
- Defect (what a user sees): keyboard focus landed on an off-screen "Search" button after the search input, with no visible focus.
- Root cause: redundant `sr-only` submit button. The form has a single text input, so Enter already submits.
- Fix: removed the button. Enter still navigates to `#/explore?q=…`.
- Verification: tab-order script (320px light) no longer lists the button; Enter-submit unchanged.
- Status: FIXED-VERIFIED

## DASH-2: Long unbroken titles caused horizontal page scroll at 320px
- Severity: P1
- Route / component / file:line: `/` · `src/styles/kitchen.css` `.hero-copy h2`, `.collection-tiles h3`, `.saved-collection strong`
- Defect (what a user sees): a long recipe or collection title without spaces pushed the page 171px wider than the 320px viewport.
- Root cause: no `overflow-wrap` on these headings.
- Fix: `overflow-wrap: anywhere` on those three selectors.
- Verification: `scripts/frontend-audit/tmp/dashboard/overflow.mjs` at 320px with injected unbroken 140-character title: document overflow 0 (was 171).
- Status: FIXED-VERIFIED

## DASH-3: "Surprise me" did not show as active
- Severity: P2
- Route / component / file:line: `/` · `src/pages/Dashboard.tsx` recommendation chips
- Defect (what a user sees): after Surprise me, no chip looked selected and the button had no pressed state.
- Root cause: the Surprise button had no `selected` class and no `aria-pressed`.
- Fix: `className` now reflects `mode === "surprise"`, and `aria-pressed` added.
- Verification: `modes.mjs` (1440 light), Surprise me reports `pressed=true`.
- Status: FIXED-VERIFIED

## DASH-4: "Find your next favourite" chips showed a fake selected state
- Severity: P3
- Route / component / file:line: `/` · `src/pages/Dashboard.tsx` collection chips
- Defect (what a user sees): "All recipes" looked active on Today, but these chips are links that leave the page and do not filter Today.
- Root cause: `selected` hard-coded on index 0.
- Fix: removed the `selected` state from the link chips.
- Verification: `dashboard-1440-light.png` in `docs/frontend/screenshots/agents/dashboard/`.
- Status: FIXED-VERIFIED

## DASH-5: Collection chip query links checked against Explorer
- Severity: P3 (checked, no defect)
- Route / file: `src/pages/Dashboard.tsx` `collections`, `src/pages/Explorer.tsx` params
- Finding: `protein=30`, `time=19`, `status=untried`, `dietary=vegetarian&protein=15`, `category=chicken-turkey&status=favourites`, `category=breakfast&q=egg`, `q=budget` all map to supported Explorer params and values.
- Status: WONT-FIX (no change needed). Live click-through of each chip not run.

## DASH-6: Stats verified with real data
- Route: `/`. Drove the UI: favourited, marked tried, rated 4 stars, saved a cook memory (default 0 eaten). Today showed 1 tried, 1 favourite, 1 meal this week, 4.0 average, and all persisted after reload.
- Observation (P3, open): "Meals logged this week" counts every session in the week, including ones with 0 eaten, while "protein logged" counts only sessions with eaten > 0. The numbers are both correct for their definitions. The label could be clearer. Not changed.
- Status: WONT-FIX (definitions are intentional; label note only)

## DASH-7: Recommendation tabs and empty states
- "Cook a favourite again" and "Use what I have" show the empty state in a fresh profile, with working actions. The favourites empty copy reads correctly.
- Observation (P3): "Something new" and "Recommended tonight" return identical cards in a fresh profile because every recipe is untried. This is expected.
- Status: WONT-FIX

## Checks run
- axe (320px, light and dark): no violations.
- Console and page errors: none in any dashboard capture at 320/375/768/1024/1440, light and dark.
- `npx eslint src/pages/Dashboard.tsx`: clean.
- `npx tsc -p tsconfig.app.json --noEmit`: no errors in files I own. Errors exist in `src/App.tsx` (TS6133 unused vars), `src/pages/CustomRecipes.tsx:683` and `src/pages/Settings.tsx:123`. Those belong to other owners and were not touched.
- Not checked: keyboard operation of every recipe-card heart button; dark-theme visual review of the after-fix shots at all widths (captured but only 1440 light viewed).

## Needs other owner
- None blocking. The bottom-nav overlap seen in the 375px baseline is a full-page screenshot artifact of the fixed bottom nav, not a real overlap in the live viewport.
