# Frontend inventory

Discovered 2026-10-11 by reading the hash router in `src/App.tsx` (routes are an if/else chain on `location.hash`, so there are no other route definitions) and every exported component in `src/components` and `src/pages`.
Owner = the sweep agent responsible for audit and repair (see `AGENT_BRIEF.md`). Audit, issue, repair and verified columns were filled from the findings files on 2026-10-11. The lead's final pass is pending, so no route is COMPLETE (see `SWEEP_PROGRESS.md`). Issue IDs are in `ISSUE_REGISTER.md`. Detail lives in `ISSUE_REGISTER.md` and `findings/<owner>.md`.

## Routes (13)

| Item | Route | Source path | Used by | Owner | Audit status | Issues | Repair status | Verified |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Today / Dashboard | `/` | `src/pages/Dashboard.tsx` | sidebar, bottom nav, brand link | dashboard | Audited | DASH-1 to DASH-7 | 4 fixed-verified; DASH-5, 6, 7 WONT-FIX | Scripted; visual partial (1440 light). Final pass pending |
| Explore | `/explore?…` | `src/pages/Explorer.tsx` | nav, dashboard search/chips | explorer | Audited | EXP-1 to EXP-11; EXP-10 fixed by shell (SHELL-13); A11Y-3 | 9 fixed-verified; EXP-11 fixed-unverified; EXP-9 WONT-FIX | Scripted; visual partial (375 dark). Final pass pending |
| Favourites | `/favourites` | `src/pages/Explorer.tsx` (`favourites` prop) | nav | explorer | Audited | EXP-1, EXP-2, EXP-3, EXP-11 (shared with Explore) | 3 fixed-verified; EXP-11 fixed-unverified | Scripted; visual partial. Final pass pending |
| Recipe details | `/recipe/:slug` | `src/pages/RecipeDetail.tsx` | cards everywhere | recipe | Audited | REC-1 to REC-7; A11Y-5, A11Y-6, A11Y-10 (recipe); LOGIC-1, LOGIC-4 | REC-1, 2, 3, 6, 7 fixed-verified; REC-4, 5 WONT-FIX; LOGIC-4 DECISION | Scripted; visual partial (375 light). Final pass pending |
| Cook Mode | `/cook/:slug?servings=` | `src/pages/CookMode.tsx`, `src/components/CookingTimer.tsx` | recipe page | cookmode | Audited | COOK-1 to COOK-6; A11Y-2 | COOK-1, 5, 6 and A11Y-2 fixed-verified; COOK-2, 3, 4 fixed-unverified | Scripted; no screen reader run. Final pass pending |
| Meal planner | `/planner` | `src/pages/Planning.tsx` (`Planner`, `WeekPicker`) | nav, dashboard | planning | Audited | PLAN-1, PLAN-5; A11Y-1; A11Y-10 and DS-8/DS-10 (planner parts); A11Y-11 | PLAN-1, PLAN-5, A11Y-1 fixed-verified; A11Y-11 OPEN | Scripted; visual not recorded. Final pass pending |
| Shopping list | `/shopping` | `src/pages/Planning.tsx` (`Shopping`, `ItemForm`) | nav, recipe page | planning | Audited | PLAN-2, PLAN-3, PLAN-4, PLAN-5; LOGIC-5; A11Y-10 | PLAN-2, PLAN-5 fixed-verified; PLAN-3 fixed (unit only); PLAN-4 DECISION; LOGIC-5 OPEN | Scripted and unit tests; visual not recorded. Final pass pending |
| Pantry | `/pantry` | `src/pages/Planning.tsx` (`Pantry`) | nav | planning | Audited | A11Y-10 (pantry form); DS-10 (pantry icon buttons) | Fixed-verified | Scripted (empty state only); populated state at 320 not verified |
| Cooking journal | `/journal` | `src/pages/Journal.tsx`, `src/components/SessionForm.tsx` | nav | journal | Audited | JRN-1 to JRN-7; DS-8, DS-10, A11Y-10 (journal parts) | JRN-1, 2, 3, 4, 6 fixed-verified; JRN-5 DECISION; JRN-7 OPEN-UNREPRODUCED | Scripted; visual partial (375). Final pass pending |
| Settings | `/settings` | `src/pages/Settings.tsx`, `src/components/CloudSettings.tsx` | sidebar | settings | Audited | SET-1 to SET-8; LOGIC-6; SET-2 lib part (logic) | All fixed-verified; SET-6 WONT-FIX | Scripted and unit tests; visual partial (375 light). Final pass pending |
| Kitchen guide (Help) | `/help` | `src/pages/Settings.tsx` (`Help`) | sidebar, footer | settings | Audited | SET-7, SET-8, SHELL-12; LEAD-1 (food safety) | Fixed-verified; LEAD-1 DECISION (owner) | Scripted; visual not recorded. Final pass pending |
| Your recipes (custom) | `/custom` | `src/pages/CustomRecipes.tsx` | settings | custom | Audited | CUST-1 to CUST-12; CUST-10 (README link, now fixed via SET-5) | 8 fixed-verified; CUST-2, 7, 8 fixed-unverified; CUST-9 WONT-FIX | Scripted and unit tests; visual not recorded. Final pass pending |
| Not found | any other | inline in `src/App.tsx` | — | shell | Audited | SHELL-4, SHELL-5, SHELL-8 | Fixed-verified | Axe at 375; one 320 screenshot cited. Final pass pending |

Non-route states: loading screen ("Opening your kitchen…", `App.tsx`), toast (`App.tsx`), beforeunload guard (`App.tsx`), skip link, mobile header + menu, desktop sidebar, bottom nav.
There is no authentication route and no onboarding route. The README says no account is required, and optional cloud sign-in lives in the Settings panel. No separate About page exists; `/help` covers it.

## Shared components

| Component | Source | Used by | Owner |
| --- | --- | --- | --- |
| Kitchen / App shell, sidebar, mobile header, bottom nav, toast, 404 | `src/App.tsx` | all routes | shell |
| Modal | `src/components/UI.tsx` | recipe, planning, journal, settings | shell |
| Empty | `src/components/UI.tsx` | most pages, 404 | shell |
| FoodImage | `src/components/UI.tsx` | cards, recipe hero, dashboard | shell |
| RecipeCard / RecipeGrid | `src/components/UI.tsx` | dashboard, explore, favourites | shell |
| PageHeading / SectionHeading | `src/components/UI.tsx` | all pages | shell |
| Pill | `src/components/UI.tsx` | filters, chips | shell |
| SavedCheckbox | `src/components/UI.tsx` | ingredients, shopping | shell |
| AppContext / useApp / formatQuantity / readableDate | `src/components/context.tsx` | all pages | shell |
| CookingTimer | `src/components/CookingTimer.tsx` | cook mode, recipe page | cookmode |
| SessionForm | `src/components/SessionForm.tsx` | recipe, cook mode, journal | journal |
| CloudSettings | `src/components/CloudSettings.tsx` | settings | settings |
| MultiCheck | `src/pages/Settings.tsx` | settings | settings |
| PlanForm | `src/pages/RecipeDetail.tsx` | recipe page | recipe |
| WeekPicker / ItemForm | `src/pages/Planning.tsx` | planner/shopping/pantry | planning |

## Styling and assets

| Item | Source | Owner |
| --- | --- | --- |
| Design tokens | `src/styles/tokens.css` | designsystem |
| Global + primitives + pages | `src/styles.css` (2795 lines) | designsystem (primitives), page agents (page selectors) |
| Kitchen page styles | `src/styles/kitchen.css` | same split |
| Cook mode styles | `src/styles/cook-mode.css` | cookmode |
| Fonts | `@fontsource/fraunces`, `@fontsource/dm-sans` (`src/main.tsx`) | designsystem / perf |
| Category illustrations (8) | `public/images/` | perf |
| PWA / service worker | `vite.config.ts` (`vite-plugin-pwa`) | perf |

## Logic used by the UI

`src/lib/{db,engine,schema,noteDrafts,navigation,index}.ts`, `src/cloud/*`: owned by logic (persistence, search, recommendations, shopping aggregation, backup).
