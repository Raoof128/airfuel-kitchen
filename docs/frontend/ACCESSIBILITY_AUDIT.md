# AirFuel Kitchen: WCAG 2.2 AA accessibility audit

Date: 2026-10-11. Agent: `a11y` (read-only for `src/`). Findings: `docs/frontend/findings/a11y.md` (prefix `A11Y`).
Target: WCAG 2.2 AA, with the target-size minimum (2.5.8) measured at 24 x 24 CSS px and 44 px as the aim.

## Result in one paragraph

Automated axe (WCAG 2.0/2.1/2.2 A and AA) finds **zero violations** across all 104 page states. The app is well built on the basics: one `h1` per route, a working skip link, focus restoration after dialogs, Escape closes every dialog, toasts and form errors use live regions, and reduced motion is honoured. The gaps are in **accessible names and state**, not structure: two Label-in-Name problems (planner day chips and add-meal buttons, timer input), a toggle button whose label changes with its pressed state, a few small hit areas, and a status banner that is not announced. Of the 11 findings, 8 are open, 1 is fixed but unverified (A11Y-6), and 2 are fixed and verified (A11Y-4, A11Y-7).

## Scope and method

| Check | How | Result |
|---|---|---|
| Axe sweep | `scripts/frontend-audit/tmp/a11y/axe-scan.mjs`. 13 routes x {empty, populated} x {light, dark} x {375, 1440}. Tags `wcag2a, wcag2aa, wcag21aa, wcag22aa`. | 0 violations. Re-run after owners' fixes: still 0. |
| Label in Name (2.5.3), experimental | `extra.mjs` with `label-content-name-mismatch` | Every day chip (7) and add-meal button (28) on `/planner` (A11Y-1). |
| Axe "incomplete" | `extra.mjs` | `aria-prohibited-attr` on `.quick-filters` (A11Y-3). Image-disclosure contrast is a false positive (passes by calculation). |
| Keyboard | `keyboard.mjs`: 70 Tab presses per route at 1440 and 375, skip link, menu Escape and focus return | No traps. Focus visible on every stop. Skip link works. Mobile menu Escape and close button restore focus. |
| Dialog Escape | `final-checks.mjs` (5 dialogs) | All close on Escape, focus returns to the trigger. |
| Dynamic states | `dynamic.mjs`, `recheck.mjs`, `offline.mjs` | Toasts (`status` / `alert`) correct. Custom-recipe form errors correct (`aria-invalid`, `aria-describedby`, summary `alert`). Timer completion announced via `role="status"` (61 s run). Offline banner not announced (A11Y-9). |
| Structure | `structure.mjs` | One `h1` per route, no skipped heading levels. Landmarks: `main`, `nav` x3 with labels, `header`, `footer`. |
| Target size | `final-checks.mjs` (all visible enabled controls, 375 and 1440, light and dark) | Offenders listed in A11Y-7 and A11Y-8. Checkboxes at 19 px pass because the wrapping label is the target. |
| Reflow at 320 CSS px | `structure.mjs` | No document overflow on 12 of 13 routes. Planner note A11Y-11 (not reproduced in isolation). |
| Contrast | `contrast.mjs` against `src/styles/tokens.css`, both themes | All text pairs >= 4.5:1. Input borders (`--line-control`) 3.5:1 light and 3.8:1 dark. |
| Reduced motion | `src/styles.css:2769`, `src/styles/cook-mode.css:748` | Animations and transitions disabled under `prefers-reduced-motion: reduce`. |
| Automated Playwright spec | `tests/e2e/a11y.spec.ts`, 12 primary routes x {light, dark}, fails on serious/critical WCAG 2.2 AA violations. Typechecks (`tsc --ignoreConfig` on the file). Not run, per the brief. | Written. |

Populated state was built through the real UI (favourite, mark tried, rate, note, plan a meal, shopping item, journal session) by `scripts/frontend-audit/tmp/a11y/populate.mjs`, then verified after reload by `verify-state.mjs`.

## Open issues by owner

| ID | Sev | Owner | File | Issue | Status |
|---|---|---|---|---|---|
| A11Y-1 | P2 | planning | `src/pages/Planning.tsx:150-160, 257-270` | Day chips and "Add meal" names do not contain visible text (Label in Name). `aria-current` used for selection. | OPEN |
| A11Y-2 | P2 | cookmode | `src/components/CookingTimer.tsx:174` | Timer input `aria-label="Timer minutes"` overrides the visible label "Timer duration". Delete the attribute. | OPEN |
| A11Y-3 | P2 | explorer | `src/pages/Explorer.tsx:236` | `div.quick-filters` has `aria-label` and no role. Add `role="group"`. | OPEN |
| A11Y-4 | P2 | shell | `src/components/UI.tsx:148-149` | Heart toggle name changed with state. | FIXED-VERIFIED |
| A11Y-5 | P2 | recipe | `src/pages/RecipeDetail.tsx:328-336` | "Mark as tried" name becomes "Tried · undo" while `aria-pressed` is also set. | OPEN |
| A11Y-6 | P3 | recipe | `src/pages/RecipeDetail.tsx:240-244` | Save button lacked `aria-pressed`. Now present. | FIXED-UNVERIFIED |
| A11Y-7 | P2 | designsystem | `src/styles.css` (`.back-link`) | Back links were 19 px tall. Now 44 px. | FIXED-VERIFIED |
| A11Y-8 | P3 | shell / designsystem | `src/components/UI.tsx` (`h3 a`) | Card title link is 17 px tall. Verify the spacing exception first. | OPEN |
| A11Y-9 | P2 | shell | `src/App.tsx:327, 333` | Offline and update banners have no `role="status"`. Confirmed: an offline banner has no role. | OPEN |
| A11Y-10 | P3 | planning / recipe / journal | shopping form, add-to-plan form, `SessionForm.tsx` | Required-field errors only use the browser bubble. Use the CustomRecipes pattern. | OPEN |
| A11Y-11 | P3 | planning | `/planner` at 320 | Day strip overflow seen once in a sweep, not reproduced in isolation. | OPEN, pending reproduction |

Also note: `aria-current="true"` on a selected day (A11Y-1) is a location attribute, not a selection attribute. Use `aria-pressed` or `aria-selected`.

## Confirmed passing (no owner action needed)

- One `h1` per route, no skipped heading levels.
- Skip link, first Tab stop, moves focus into `#main`.
- Focus moves to `main` on route change; document title updates per route.
- Focus indicator visible on every keyboard stop (3 px terracotta outline; screenshot `scripts/frontend-audit/tmp/a11y/planner-date-focus.png`).
- All six dialog and menu cases close on Escape and restore focus.
- Toasts: success `role="status"`, error `role="alert"`, dismiss button named.
- Cooking timer: countdown `aria-live="off"`; completion text in `role="status"`.
- Custom recipe form: `aria-invalid`, `aria-describedby`, summary `role="alert"`, focus moves to the first invalid field. Good model for A11Y-10.
- Explorer result count `aria-live="polite"`. Progress bars named.
- Non-colour status: "Tried ✓" text, line-through with a checkbox on shopping rows, heart fill with `aria-pressed`.
- Dark theme follows `prefers-color-scheme` and passes axe.
- Image disclosure "Category illustration" (92% white chip, #464840 text, about 8.8:1) passes by calculation.

## What could not be verified here

- No real screen reader run (VoiceOver, NVDA, TalkBack). Live-region behaviour is checked by DOM roles, not by speech output.
- Browser zoom at 200% and 400% was approximated by a 320 CSS px viewport. No real zoomed Chrome run.
- Voice control (Label in Name) is inferred from the name strings, not tested with a voice tool.
- The populated-state axe rerun used the saved storage snapshot from `populate.mjs`. Other dynamic states (cooking session with active timer mid-run, offline cached recipes) were tested as single cases only.
- `npm run test:e2e` was not run, per the brief. The new spec typechecks, but its pass or fail depends on the production preview at `127.0.0.1:4173`, which should be confirmed by whoever runs the suite.

## Scripts (throwaway, under `scripts/frontend-audit/tmp/a11y/`)

- `populate.mjs`: UI-driven populated state (writes `populated-state.json`, gitignored tmp).
- `axe-scan.mjs`: full axe sweep, 104 states. Output `axe-results.json` / `axe-rerun.json`.
- `extra.mjs`: `label-content-name-mismatch`, `target-size`, `aria-allowed`, incomplete items.
- `structure.mjs`: headings, landmarks, reflow at 320, touch targets at 375.
- `keyboard.mjs`: tab order, focus ring, traps, skip link, mobile menu.
- `dynamic.mjs`: toasts, form errors, timer completion (about 1 min).
- `final-checks.mjs`: small targets (<24 px), planner at 320, dialog Escape.
- `recheck.mjs`, `offline.mjs`: end-of-run verification of each finding.
- `contrast.mjs`: token contrast table.

## Re-run

Last run: end of the audit window, 2026-10-11, dev server `http://127.0.0.1:5180`. Axe sweep: 0 violations. Per-finding status is in `docs/frontend/findings/a11y.md`.
