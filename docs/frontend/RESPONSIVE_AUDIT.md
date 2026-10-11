# Responsive audit (AirFuel Kitchen frontend sweep)

Compiled 2026-10-11 from `docs/frontend/findings/*.md`. Issue IDs refer to `ISSUE_REGISTER.md`.

## Baseline result

- `scripts/frontend-audit/capture.mjs` captured **130 full-page screenshots**: 13 routes x 5 widths x 2 themes, in `docs/frontend/screenshots/baseline/`.
- Widths and viewport heights: 320x640, 375x812, 768x1024, 1024x768, 1440x900. Themes: light and dark (`colorScheme`, `reducedMotion: "reduce"`). 430 and 1920 were not in the baseline; they are covered by the final sweep below.
- `report.json`: **0 captures with horizontal overflow and 0 with console errors, warnings or failed requests.** I re-read the file to confirm.
- The baseline ran on the app before any sweep fix. Its real catalogue content does not overflow. The overflow found later (DASH-2) needed an injected 140-character unbroken title, so the baseline alone does not prove long-content safety. Long-content checks were run separately (see below).

## Widths, orientations and themes checked per route

Widths are CSS pixels. "Baseline" means the 130-capture sweep above. Other rows are what the findings files record beyond that sweep.

| Route | Widths checked (beyond baseline) | Orientation | Themes | Notes |
| --- | --- | --- | --- | --- |
| `/` Today | 320, 375 (axe, tab order) | portrait | light and dark (axe); light (modes, tab order) | Long-title overflow test at 320 (DASH-2). Visual review only at 1440 light. |
| `/explore` | 320, 375 (overflow, 20 captures with favourites); 375, 1440 (axe, all states) | portrait | light and dark | Filter panel checked at 320 and 375 (EXP-4). No visual review at 768, 1024 or 1440. |
| `/favourites` | 320, 375 (overflow); 375, 1440 (axe) | portrait | light and dark | Shares Explorer code. |
| `/recipe/:slug` | 320, 375, 768, 1440 (verify and fontcheck); 1280 (axe, light); six recipes at 320 to 1440 for the fixed-nav check | portrait | light and dark; dark at 320 by screenshot and measurement | Print checked by emulation only. |
| `/cook/:slug` | 320x640, 375x812, 812x375 (overflow, axe); 375 and 1440 (timer) | portrait and **landscape 812x375** | light and dark (axe) | Only route with a landscape check besides the shell. |
| `/planner` | 320, 375, 768, 1440 (overflow, axe, targets) | portrait | light and dark | Single-day layout below 720 px (PLAN-1). |
| `/shopping` | 320, 375, 768, 1440 (overflow, axe, targets) | portrait | light and dark | Manual row at 320 is 246 px wide, no overflow. |
| `/pantry` | 320, 375, 768, 1440 (overflow, axe, empty state) | portrait | light and dark | Empty state only. Populated pantry at 320 not verified. |
| `/journal` | 320, 375, 768 (overflow); 320, 375, 1440 (icon buttons) | portrait | light and dark (axe) | No after-fix capture at 1024 or 1440. |
| `/settings` | 320, 375, 768, 1440 (overflow, axe) | portrait | light and dark | 1024 not captured by the settings agent (baseline only). Import modal at 320 dark checked. |
| `/help` | 320, 375, 1440 (axe, overflow); 320 to 1440 (SHELL-12 overflow) | portrait | light and dark | |
| `/custom` | 320, 375 (`responsive.mjs`, axe on dialog); 1440 (error screenshot) | portrait | light and dark | 200-character title at 320: no overflow. |
| 404 (`/does-not-exist`) | 375 (axe); 320 (one screenshot cited) | portrait | light and dark (axe) | |
| App shell (all routes) | 320, 375, 768, 1024, 1440; **720** (200% zoom proxy of 1440); **812x375** landscape | portrait and landscape | light and dark (axe) | Overflow 0 at all listed widths. Bottom-nav clearance checked on every route at 375 (SHELL-10). |

Axe, all routes: `a11y.md` ran axe on 13 routes x empty and populated x light and dark x 375 and 1440 (104 page states). Zero violations. This is axe only; several responsive defects below were found by measurement, not axe.

## Responsive defects found and fixed

| ID | Route | Width | Defect | Fix | Verified |
| --- | --- | --- | --- | --- | --- |
| DASH-2 | `/` | 320 | Unbroken 140-character title pushed the page 171 px past the viewport | `overflow-wrap: anywhere` on three heading selectors | overflow 0 (was 171) |
| JRN-1 | `/journal` | 320, 375 | Notes squeezed to 217 px (320) and 264 px (375); one card 1090 px tall at 375 | Single column below 600 px | 288 px and 335 px content; card 851 px at 375 |
| JRN-2 | `/journal` modal | 320, 375 | Rating select 110 px at 375; "Not rated" clipped | Single column for the session form below 600 px | select 295 px at 375; 240 px at 320; 768 unchanged |
| PLAN-1 | `/planner` | below 720 | Empty week about 4500 px tall at 375 | One day at a time with a 7-day strip below 720 px | 63 of 64 checks in one run (failing check was a timing artifact; re-checked) |
| EXP-4 | `/explore` | 320, 375 | Open filter panel about 1000 px tall with no exit | "Show N recipes" button closes the panel and moves focus to results | no overflow at 320 or 375 |
| COOK-5 | `/cook` | 320, 375, 812x375 | Eyebrows, timer state and step counter at 9 to 11 px | 12 to 13 px | computed sizes; no overflow |
| COOK-6 | `/cook`, `/recipe` timer | 375, 1440 | Timer reset icon 31 px | Uses 44 px tap token | 46x46 live timer at 375 and 1440 |
| DS-10 | planner, shopping, journal, cook | 320 to 1440 | Icon buttons 28 to 36 px on several pages | Tap token (44 px) | 44x44 at 320, 375, 1440 |
| SHELL-7 | all (toasts) | 375 | Toast dismiss button about 26 px | 44x44 | measured 44x44 |
| SHELL-13 (from EXP-10, A11Y-8) | `/`, `/explore`, `/favourites` | 375, 1440 | Only the title text was tappable (17 to 30 px tall) | Stretched link covers the whole card | hit tests at 10, 50, 90% height return the recipe URL |
| A11Y-7 | `/recipe`, `/cook` | 375 | Back link 19 px tall | Min-height 44 px | 44 px tall (recipe); cook back link not measured |
| DS-3 | all | 320, 375 | 8 to 11 px text in shared primitives | 12 px floor on 32 declarations | 30 captures clean |
| DS-11 | all | 375 and 1440 | Mobile header: visibility and button size | Verified: visible at 375 (44x44 button), hidden at 1440 | screenshots light and dark |
| DS-9 | all | all | **Regression introduced by the sweep**: 3 px ring around `main` on every route change | Focus rule excludes `tabindex="-1"` | ring gone (settings, 1440 dark) |

## Open responsive items

| ID | Route | Width | Status | Why |
| --- | --- | --- | --- | --- |
| A11Y-11 | `/planner` | 320 | OPEN | One sweep measured day chips past 320 px (342 to 361 px right edges). Not reproduced in isolation. The seven chips now scroll horizontally inside the strip at 320 by design (PLAN-1). No document overflow. Whether in-strip scrolling is acceptable under WCAG 1.4.10 is a judgement for the lead. |
| REC-4 | `/recipe` | 320, 375 | WONT-FIX | Reported as covering the protein headline. The baseline capture was a full-page artifact of the fixed bottom nav. Not reproduced in a live viewport. |
| REC-5 | `/recipe` | 320 | WONT-FIX | Action bar wraps to three staggered rows. Nothing clipped; cosmetic. |
| SHELL-9 | `/cook` | all | WONT-FIX | Skip link appears in a full-page capture only when focused. Not an overlay. |

## Final sweep (430 and 1920 now covered)

- `screenshots/final/`: **182 captures**: 13 routes x 7 widths x 2 themes. Widths: 320, 375, 430, 768, 1024, 1440, 1920. Output in `screenshots/final/report.json`.
- Result: **0 captures with horizontal overflow and 0 with console errors, warnings or failed requests.**
- Visual regression baselines (33 snapshot files) in `tests/e2e/visual.spec.ts-snapshots/`. Full e2e suite 69/69 (lead).
- The final sweep is automated. Findings do not record a by-eye review of each width, so treat the visual check as pixel-baseline based.

## Responsive defects found and fixed (addition)

| ID | Route | Width | Defect | Fix | Verified |
| --- | --- | --- | --- | --- | --- |
| RT-1 | any saving route (verified on `/recipe`) | 375, 1440 | A failed-save error toast stayed up and hid a later success confirmation | Error toast has its own slot; confirmation stacks above it using measured error height | `scripts/frontend-audit/tmp/lead/rt1.mjs`; `screenshots/redteam/rt1-fixed-375.png` |

## Gaps: widths and states not checked

- **430 px and 1920 px: now covered** by the final sweep (overflow and errors only; see above).
- **1024 px:** covered by the final sweep for overflow and errors. No by-eye review and no after-fix pixel check was recorded by the owners for journal or settings at 1024.
- **Landscape: only 812x375.** Checked on cook mode and the shell. Other routes were not checked in landscape.
- **200% zoom:** the 720 px proxy was run on the shell only. No route-level checks at 720 px.
- **Reflow at 320 CSS px:** `a11y.md` reports no document overflow on 12 of 13 routes. The planner is the exception (A11Y-11).
- **Long content:** long titles were tested on dashboard (140 characters, injected) and custom (200 characters). Long notes were tested on journal only. The 18-ingredient `dal-with-air-fryer-tofu` recipe was in the six-recipe overflow check at 320, 375, 768 and 1440 (REC-4 evidence). The red team tested a 100-character custom name at 1440 only.
- **Populated pantry at 320:** not verified; only the empty state was captured.
- **Dark theme visual review:** most dark-theme checks are overflow and axe. Dashboard, explorer, planner, shopping and pantry were not reviewed by eye in dark at all widths.
- **Print:** emulated only (REC-1, REC-6, DS-7). No printed PDF was produced or checked.
- **Touch and screen reader:** no real device or screen reader run. Hit areas are measured in Chromium only.
- **Offline (RT-7):** covered by the e2e offline-reopening test on the production build (lead). Not checked on the dev server, which does not register a service worker.
