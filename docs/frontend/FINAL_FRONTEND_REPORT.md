# Final frontend report: Operation Frontend Zero-Defect

Date: 2026-10-11. Scope: the AirFuel Kitchen web app (React 19, Vite 8, Dexie), every hash route and shared component.
How it was run: a lead (Claude Opus 5.5) coordinated Claude Haiku 5.5 subagents, each owning separate files: dashboard, explorer, recipe, cookmode, journal, planning, settings, custom, shell, designsystem, logic, a11y, perf, register, e2efix, and an independent red-team reviewer that ran twice. The shared brief is in `AGENT_BRIEF.md`, and each agent's raw log is in `findings/<agent>.md`.
Design skills used: `frontend-design` (Anthropic) and `ui-ux-pro-max` 2.11.0. `DESIGN_SYSTEM.md` records the exact commands run, what they recommended and what was rejected. Claymorphism, the Calistoga/Inter pairing and the Caveat/Quicksand pairing were all rejected in favour of the existing Fraunces + DM Sans editorial identity.

## A. Coverage

| Measure | Count |
| --- | --- |
| Routes discovered (router is an if/else chain in `src/App.tsx`) | 13 (12 product routes + not-found) |
| Routes inspected | 13 |
| Components reviewed | 24 (see `FRONTEND_INVENTORY.md`) |
| Automated e2e tests (production build, port 4173) | 69 functional/a11y/security + 33 visual-regression snapshots, all passing |
| Unit tests | 109 across 19 files (58 at baseline) |
| Red-team journeys run at 375 and 1440 | 8 end-to-end journeys plus edge cases (round 1), then 16 targeted re-checks (round 2) |
| Responsive configurations captured | Baseline: 130 (13 routes × 320/375/768/1024/1440 × light/dark). Final: 182 (adds 430 and 1920). Both had 0 horizontal overflow and 0 console or network errors. Agents also checked 812×375 landscape, 720 px (a 200% zoom proxy) and 320 px with doubled text. |
| axe (WCAG 2.0/2.1/2.2 A+AA) | 104 states with 0 violations (13 routes × empty/populated × light/dark × 375/1440), plus dialogs and error states per agent |

## B. Issues (`ISSUE_REGISTER.md`)

| Severity | Count |
| --- | --- |
| P0 | 0 |
| P1 | 21 |
| P2 | 61 |
| P3 | 51 |
| Total | 133 |

| Status | Count |
| --- | --- |
| Fixed and verified (browser, script, unit or e2e) | 97 |
| Fixed, partly unverified (mostly screen-reader speech, or copy-only edits) | 5 |
| Open | 7 |
| Open, not reproduced | 1 (JRN-7) |
| Won't fix (with reason) | 16 |
| Owner/product decision (documented, unchanged) | 7 |

Open P1s:
- **PERF-2:** about 1.2 MB of recipe JSON (about 130 kB gzip) loads before first render. This is carried into the backend/data-layer sweep.
- **JRN-7:** one journal reload showed 0 entries. It has not reproduced in more than 13 runs, and the logic agent found no code path that clears data on load. It stays open as unexplained.
- **LOGIC-10** (a decision, not a fix): on first cloud sync, a same-record conflict is resolved by operation UUID without prompting. Fixing it needs a server change.

## C. Main changes

Usability and layout:
- **Mobile planner (PLAN-1):** below 720 px, the planner shows one day at a time with a day strip and prev/next buttons, defaulting to today. The empty week was about 4,490 px tall; the day view is about 1,440 px. The desktop grid is unchanged.
- **Shopping:**
  - "Clear ticked items" with a confirmation step.
  - Amounts read as kitchen measures: "⅓ tsp", "2 tbsp", "1.5 kg" instead of "1.7 ml" or "1,500 g" (Australian 20 ml tablespoon).
  - Stale generated ticks older than 28 days are pruned.
- **Recipe and Cook Mode ingredients:** amounts show as fractions ("½ tsp", "¼ tsp"). The old formatter rounded ¼ up to "0.3". There is no dangling " · " separator and no "..".
- **Custom recipes:**
  - Ingredient lines can be typed naturally ("200 g chicken breast, diced"), and the pipe format still works.
  - Category is required, with no silent chicken default.
  - Core temperature now has a food-safety minimum taken from ingredient words (poultry 74°C, mince, pork or egg 71°C, fish 63°C), not just the category.
  - Errors appear inline next to their fields.
  - Closing with unsaved edits asks for confirmation.
- **Journal:**
  - Each entry has a "Cook again" link.
  - An entry whose recipe is missing explains why it can't be edited.
  - Phone layout is fixed.
  - Form errors appear inline.
- **Explorer:**
  - Fixed the favourites view showing all 300 recipes.
  - Focus is kept on keyboard unfavourite.
  - The mobile filter panel ends with "Show N recipes".
  - Typing lag is reduced with `useDeferredValue`.
- **Settings:**
  - Theme applies immediately.
  - Import errors are plain English (no raw Zod JSON).
  - There is a "Your recipes" entry point.
- **Cook Mode:**
  - Typing a serving count no longer saves partial values on each keystroke.
  - The Done click is no longer swallowed after editing servings (COOK-7).
  - The screen-awake toggle shows its On/Off state.

Accessibility:
- Constant names with `aria-pressed` on every toggle.
- Accessible names that start with the visible text (WCAG 2.5.3).
- Live regions for toasts, the timer and the offline/update banners.
- Error toasts persist and no longer hide later confirmations.
- No focus loss while saving (`aria-busy` instead of `disabled`).
- 44 px touch targets: icon buttons, heart, toast dismiss, back link, and the whole recipe card as one tap target.
- No text under 12 px.
- One focus ring in both themes.
- No dark-mode flash on load.
- An h1 on every route, including the 404.

Design system (`DESIGN_SYSTEM.md`):
- **Control borders:** were 1.3–1.6:1 contrast; the new `--line-control` token is about 3.8:1.
- **New tokens:** `--ring`, `--text-h2`, `--text-min` and `--tap-min`.
- **Button states:** pressed and disabled now look distinct.
- **Nutrition numbers:** fixed-width digits so figures align.
- **Cleanup:** dead CSS removed.

Performance (`PERFORMANCE_AUDIT.md`), measured on production builds:

| Measure | Before | After |
| --- | --- | --- |
| Illustrations | 2.66 MB | 1.04 MB |
| LCP, mobile profile (Today / Explore / Recipe) | 6.7 / 8.6 / 5.8 s | 4.4 / 4.7 / 4.1 s |
| First-load JS, gzip | 377 kB | 296 kB |
| Precache | 4.9 MB | 3.25 MB |

The Supabase SDK and five screens are now lazy-loaded, and every lazy chunk is precached for offline use.

## D. Evidence

- Gate commands, all passing on the final tree:
  - `npm run lint`
  - `npx tsc -b`
  - `npx vitest run` (109/109)
  - `npm run validate:data`
  - `npm run build`
  - `npx playwright test` (69 + 33 visual)
- Screenshots:
  - `screenshots/curated/before/` and `screenshots/curated/after/`: 24 pairs covering 8 key routes at 375 light, 1440 light and 1440 dark.
  - The full baseline and final sweeps are reproducible with `node scripts/frontend-audit/capture.mjs <outDir> http://127.0.0.1:5173`.
- Visual regression: `tests/e2e/visual.spec.ts` with baselines in `tests/e2e/visual.spec.ts-snapshots/`. The clock, theme, viewport and motion are pinned. Baselines were reviewed by eye before acceptance and passed a second run unchanged.
- Accessibility: `tests/e2e/a11y.spec.ts` (fails on serious or critical violations) and `ACCESSIBILITY_AUDIT.md`.
- Independent review: `REGRESSION_REPORT.md`.
  - Round 1: 0 P0/P1, 2 P2 regressions (both fixed), 4 P3.
  - Round 2: 13 fixes confirmed, 0 new findings.
- Change set: a shadow git repository taken before the sweep (`~/Desktop/Raouf/.snapshots/airfuel.git`), plus a tarball of the pre-sweep project (`~/Desktop/Raouf/.snapshots/airfuel-pre-audit-2026-10-11.tgz`).

## E. Limitations, stated plainly

- **Verified complete:** all 13 routes; responsive layout from 320 to 1920 px in both themes; keyboard behaviour; axe; the critical journeys (memory, plan → shopping, cook → journal, custom recipe, backup and restore, theme); offline reopening on the production build (e2e).
- **Partly verified:**
  - No real screen reader was run. Live regions and names were checked through the DOM and the accessibility tree, not speech.
  - Wake Lock was verified only with a stub, because headless Chromium refuses it.
  - Performance was measured on emulated mobile, not real devices.
  - iOS safe-area behaviour was reasoned about rather than tested on a device.
- **Blocked or out of scope:** cloud sync against a live Supabase project (no project configured). Lighthouse was not installed.
- **Owner decisions recorded, not changed:**
  - The NSW source lists minced meat at both 71°C and (in a newer row) 75°C. The app uses 71°C for mince.
  - Manual shopping items appear in every week.
  - Every custom recipe must include safety, storage and nutrition-source fields.
  - The default profile greets "Raouf" / "Sydney" (`src/lib/schema.ts`).
- **Not claimed:** perfection. The register lists every known remaining item.
