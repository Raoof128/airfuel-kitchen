# AirFuel Kitchen upgrade audit

Baseline inspected on 11 October 2026 from the existing production preview at `http://127.0.0.1:4173`. All browser work used disposable Playwright contexts. The user's browser profile and saved kitchen were not modified. The 300-recipe catalogue is the retained baseline.

## Evidence and method

- Read and applied `/Users/raoof.r12/.agents/skills/frontend-design/SKILL.md` for editorial direction, hierarchy and intentional composition.
- Read `/Users/raoof.r12/.claude/plugins/cache/ui-ux-pro-max-skill/ui-ux-pro-max/2.11.0/.claude/skills/ui-ux-pro-max/SKILL.md`, its `references/pro-rules.md` and accessibility, touch, performance and responsive sections of `references/quick-reference.md`. The native-specific checklist was adapted to browser semantics rather than treated as a native-platform compliance claim.
- Ran the installed search workflow for `animation accessibility z-index loading` in the UX domain. It returned loading feedback, restrained continuous animation and stacking-context guidance. The main implementation owns the persisted product design-system synthesis.
- Captured **18 before screenshots**, covering Today, Explore and recipe details at 375, 768 and 1440 CSS pixels in both light and dark themes. See [capture manifest](screenshots/upgrade-before/capture.json). Reproduce with `node scripts/capture-upgrade.mjs before`; use `after` only against the completed production build.
- Visually inspected the mobile Today and Explore pages, desktop recipe and tablet dark dashboard, then reviewed all route components and shared styles. The representative files are [mobile Today](screenshots/upgrade-before/375-light-today.png), [mobile Explore](screenshots/upgrade-before/375-dark-explore.png), [desktop recipe](screenshots/upgrade-before/1440-light-recipe.png) and [tablet dark Today](screenshots/upgrade-before/768-dark-today.png).
- A separate 375-pixel browser check confirmed an Axe `button-name` violation on Explore, undersized controls, and lost catalogue search after a recipe round trip. These are baseline findings, not the final upgrade test outcome.

## Findings

Locations below identify the baseline code and may move during the upgrade. P1 means an acceptance or accessibility gap to resolve before delivery; P2 means meaningful usability or presentation work. No extra findings have been invented to reach a quota.

| ID | Priority | Observed problem and evidence | Required response |
| --- | --- | --- | --- |
| U01 | P1 | Start cooking only scrolls to the long recipe method; there is no focused step experience, remaining-step control or standalone Cook Mode. `RecipeDetail.tsx` baseline 260–272. | Add a focused, persistent Cook Mode with a readable current step, progress, timer and visible temperature/safety guidance. Preserve the complete recipe view. |
| U02 | P1 | Explore's Surprise button contains a `hide-mobile` text span and no accessible name. At 375px the automated browser audit reports `button-name`. `Explorer.tsx` 123–141. | Give the control a stable accessible label independent of visual text. Audit both themes at narrow widths. |
| U03 | P1 | Mobile navigation is a full-screen overlay without Escape handling, background inertness, focus containment or focus restoration. `App.tsx` mobile header/sidebar; `styles.css` 2138 onward. | Use a real modal drawer or an equally robust accessible implementation with a clear close action and correct keyboard behaviour. |
| U04 | P2 | Mobile recipe cards remain two narrow columns at 375–430px. Category labels are 8px, metadata 10px, descriptions 11px and image disclosures 7px. This requires close reading where cooking information should be effortless. `styles.css` 2304–2355; before mobile screenshots. | Use readable single-column or horizontal mobile cards, with useful metadata and a consistent type scale. |
| U05 | P2 | A third card is explicitly hidden when a grid has exactly three children. This drops actual recommendations and recent items to preserve visual symmetry. `styles.css` 2037 and 2308. | Keep all supplied results visible at every breakpoint. Adapt the layout instead of hiding content. |
| U06 | P2 | Measured mobile hit areas are 32×32px for favourites, 36px high for categories, 40×40px for the menu and 41px for toolbar buttons. | Provide at least 44px practical action targets and enough separation without enlarging the visual icon unnecessarily. |
| U07 | P2 | Explore initialises filters from the query but writes changes only to component state. Search is empty after entering chicken, visiting a result and returning. Sort and several filters never initialise from the query. `Explorer.tsx` 16–39. | Synchronise meaningful filters and sort with the URL, preserve the browsing context and provide individual active-filter removal. |
| U08 | P2 | `FoodImage` has no failure state. A missing local image yields a broken image rather than the required trustworthy fallback. `UI.tsx` 72–88. | Render a category-aware fallback with preserved dimensions and explicit text, and test forced image failure. |
| U09 | P2 | The same featured recipe appears immediately again in the discovery cards. Selecting another recommendation mode also changes the far-away top hero, weakening the relationship between control and result. `Dashboard.tsx` 36–44 and 194–235. | Deduplicate featured/new/personalised sets and keep controls coupled to the section they change. |
| U10 | P2 | Selecting favourites with no saved favourites replaces the hero with a message claiming restrictions caused the empty state. `Dashboard.tsx` 137–144 and 207–235. | Tailor empty states to the selected mode and offer an appropriate route to save favourites or stock the pantry. |
| U11 | P2 | The dashboard only derives a recently-opened list from `viewedAt`; actual recent cooking sessions are absent. `Dashboard.tsx` 67–71 and 263–267. | Add recently cooked meals from session history and distinguish browsing from cooking and consumption. |
| U12 | P2 | Planner meals can be added and deleted, but existing meal/date/slot/servings cannot be edited or replaced in place. `Planning.tsx` 138–183. | Add an edit/replace flow preserving the plan ID, with confirmation only where necessary and no duplicate entries. |
| U13 | P2 | Recipe notes exist only in component state until Save; no unsaved indicator or navigation warning is present. `RecipeDetail.tsx` note state and save form. | Preserve deliberate Save semantics while showing unsaved status and retaining drafts or guarding navigation. Verify after a completed route transition, not a same-tick hash change. |
| U14 | P2 | The Settings form is keyed by preference `updatedAt`, so a competing preference update remounts uncontrolled inputs and can discard an in-progress edit. `Settings.tsx` 83–85. This is a code-review risk, not a reproduced data-loss claim. | Avoid silently replacing dirty values; test cross-tab behaviour or explicitly preserve the form draft until save/cancel. |
| U15 | P2 | The cooking journal's new-session picker is a 300-option select without a search field. `Journal.tsx` 153–165. | Add a labelled recipe search or filtered picker so logging a past cook does not require scanning the entire catalogue. |
| U16 | P2 | Custom recipe ingredient entry requires a pipe-separated mini-format; parse/schema failures are surfaced as generic operation errors. `CustomRecipes.tsx` 91–111. | Improve instructions and field-level validation, or expose structured ingredient rows. Keep validation errors near the field and retain edits. |
| U17 | P2 | The default Explore relevance order with no query follows catalogue insertion order. On first opening, low-protein sides and sweets lead the list despite the high-protein meal purpose. `engine.ts` 130–139 and before Explore screenshot. | Choose and clearly label a useful initial sort or editorial selection, while keeping the full catalogue accessible and explicit sorts stable. |
| U18 | P2 | Several meal names are paired with an image of a different ingredient or dish because there are eight category illustrations. The tiny disclosure is insufficient visual context at mobile sizes. Baseline prawn fajita shows a chicken wrap; tuna and prawn cards show salmon. | Make the category illustration disclosure readable and explicit. Preserve honest attribution; do not imply these are tested recipe photographs. Improve image variety only where rights and truthfulness permit. |

## Upgrade verification plan

The new test suite will supplement the original tests, not replace their persistence/security coverage. It will cover 320, 375, 430, 768, 1024, 1440 and 1920px in light/dark, and Today, Explore, recipe, Cook Mode, planner, shopping, journal and settings. Checks include overflow, accessible headings/names, automated WCAG rules, readable mobile cards, navigation focus, repeated toggles, persistent filters, Cook Mode reload, long notes, theme changes, image failure and production-browser timing observations. Existing tests retain malformed backups, offline use, browser restart and multiple tabs.

## First integrated review

The first integrated browser run exposed a light-theme contrast regression: `#666d61` text on `#e9eddf` measured **4.49:1**, below the required 4.5:1. It affected the three dashboard collection descriptions and today's planner date. The dark matrix did not have this violation. This is a token-level defect, not a reason to relax the accessibility checks.

The independent screenshot review of the first upgraded build confirmed improved single-column mobile cards, readable illustration disclosure and a clear focused cooking hierarchy. It also identified two additional refinements: the redundant cooking-start toast covered the mobile next-step action, and all nine mobile category chips pushed catalogue results below the entire 900px viewport. The cooking specialist removed that toast; a compact mobile category selector was proposed to the main frontend owner. These observations come from rendered images, not DOM-only checks.

The initial interaction failures also identified test selectors whose exact text matching included nested native-select option text. The tests were changed to semantic `combobox`/`listbox` roles with their accessible names, preserving all value and persistence assertions. The simultaneous-checklist test now explicitly begins the shared cooking session before editing it in two tabs, matching the new cooking ownership contract. No failing product assertion was removed.

Two further regressions were added for in-place Explore query updates followed by real navigation, and confirmed personal-data deletion removing temporary note drafts in every open tab. The suite contains **45 browser tests**, including the original 19.

## Final disposition

The fresh production-build rerun passed **45/45 browser tests** in approximately 2.5 minutes. The integrated unit suite passed **58 tests across 9 files**; lint and type checking also passed. `test-results/.last-run.json` records `passed` with no failed tests. The matrix captured **112 screens**, covering seven widths, two themes and eight routes, with no horizontal overflow, uncaught page errors or violations in the applied Axe WCAG rule sets. Automated checks are evidence for the tested browser, not a claim of formal accessibility certification.

| Findings | Final disposition |
| --- | --- |
| U01 | Resolved: focused Cook Mode, step progress, servings, shared absolute-deadline timer and journal completion survive navigation/reload. |
| U02–U03 | Resolved: named Surprise control and native navigation dialog; explicit Tab cycling, Escape, background scroll lock and trigger focus restoration pass. |
| U04–U06 | Resolved for the audited controls: readable single-column phone cards, all results visible, 44px favourite/menu/category targets. |
| U07 | Resolved: filters and sort survive recipe round trips/reload; real Explore navigation resets the current query. A route revision distinguishes that navigation from in-place URL edits. |
| U08 | Resolved: forced image failure renders an accessible fallback with reserved space. |
| U09–U11 | Resolved: hero/new/recommendation deduplication, section-local recommendations, appropriate empty states and session-derived recent cooking. |
| U12 | Resolved: editing or replacing a meal preserves its ID and updates recipe/slot/servings without a duplicate; date is editable in the same flow. |
| U13–U14 | Resolved: tab-local unsaved recipe drafts, visible save status, dirty Settings protection and fieldwise cross-tab merging. Confirmed deletion clears drafts in all open tabs and prevents their return after reload. |
| U15 | Resolved: journal search narrows recipe choices while preserving the current session draft until another recipe is chosen. |
| U16 | Resolved with a retained minor limitation: ingredient entry still uses a documented delimited format, now with field-associated, line-specific errors and correction without lost edits. Structured ingredient rows remain a possible future enhancement. |
| U17 | Resolved: an explicit Most protein initial sort with accessible alternative sorts and quick filters. |
| U18 | Mitigated, with a documented limitation: readable Category illustration disclosure, honest credits and image fallback. The eight generated category images are not photographs of the individual recipe outcomes. |

The light muted token was darkened from `#666d61` to `#5e6759`, resolving the measured contrast failure against sage surfaces. Explicit bundled font imports and the root DM Sans family preserve the intended body/display pairing. The second visual iteration also replaced mobile category-chip sprawl with a labelled select and removed the redundant cooking-start toast.

Final visual inspection covered 12 additional screenshots across 375/768/1440px and both themes, including [mobile Explore](screenshots/upgrade-after/matrix/375-light-explore.png), [mobile Cook Mode](screenshots/upgrade-after/matrix/375-dark-cook.png), [tablet planner](screenshots/upgrade-after/matrix/768-light-planner.png), [tablet Settings](screenshots/upgrade-after/matrix/768-dark-settings.png), [desktop Today](screenshots/upgrade-after/matrix/1440-light-today.png) and [desktop recipe](screenshots/upgrade-after/matrix/1440-dark-recipe.png). No unresolved critical or high-priority issue was found in this review. One minor presentation detail remains: the empty Shopping state's Plan a meal button sits inline with the final explanatory sentence on a narrow phone; it is visible and operable.

The final [local performance observation](screenshots/upgrade-after/performance.json) recorded LCP **296ms**, FCP **180ms**, DOMContentLoaded **90.3ms**, CLS **0.000160**, one **50ms** long task, and **1,821,818 transferred bytes** across 28 resources. This is fresh-context Chromium on a local production preview without CPU/network throttling, not field Core Web Vitals or a Lighthouse score. Physical device/screen-reader testing and live cloud qualification remain outside the verified evidence.
