# Sweep progress by route

Updated 2026-10-11 after the final sweep, the red-team regression report and the performance pass. Sources: `findings/*.md`, `REGRESSION_REPORT.md`, `ISSUE_REGISTER.md`, `screenshots/final/report.json`, `tests/e2e/visual.spec.ts-snapshots/`.

Pipeline: DISCOVERED, BASELINED, AUDITED, FIXED, TESTED, VISUALLY VERIFIED, COMPLETE.

Rules applied:
- A stage is marked **yes** only when a file in the repo records it.
- VISUALLY VERIFIED is **yes** on the lead's evidence: the final 182-capture sweep (320, 375, 430, 768, 1024, 1440 and 1920 CSS px, light and dark; 0 overflow, 0 console errors or failed requests) and the visual regression baselines (33 snapshot files in `tests/e2e/visual.spec.ts-snapshots/`). The findings files do not record a by-eye review for each route; this stage is automated.
- COMPLETE is **pending** for every route. The final red-team round 2 has not run, and the lead's final pass is still to come.

| Route | DISCOVERED | BASELINED | AUDITED | FIXED | TESTED | VISUALLY VERIFIED | COMPLETE | Open or unverified (register IDs) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `/` Today | yes | yes (130-capture baseline) | yes (`dashboard.md`) | yes (DASH-1 to DASH-4) | yes (overflow, tab order, modes, stats after reload, axe 320) | yes (final sweep; baselines) | pending red-team round 2 and final pass | PERF-8 OPEN (hero facts layout shift). PERF-1 fixed (LCP). DASH-5 to DASH-7 WONT-FIX. |
| `/explore` | yes | yes | yes (`explorer.md`; axe in `a11y.md`) | yes (EXP-1 to EXP-8, EXP-10 via SHELL-13) | yes (probes 1 to 11; `engine.test.ts`) | yes | pending red-team round 2 and final pass | EXP-11 FIXED-UNVERIFIED. EXP-6 headless timing only. PERF-1, PERF-7 (FIXED-UNVERIFIED for CLS). |
| `/favourites` | yes | yes | yes (`explorer.md`) | yes (EXP-1, EXP-2, EXP-3, EXP-11) | yes (probes 2 to 4) | yes | pending red-team round 2 and final pass | EXP-11 FIXED-UNVERIFIED. RT-1 verified on save routes. |
| `/recipe/:slug` | yes | yes | yes (`recipe.md`; axe in `a11y.md`) | yes (REC-1, REC-2, REC-3, REC-6, REC-7; A11Y-5, A11Y-6, A11Y-10) | yes (`verify.mjs`, `fontcheck.mjs`, `a11y.mjs`, `adjust.mjs`, `logic2.mjs`, `shop.mjs`; unit notes test; e2e) | yes | pending red-team round 2 and final pass | REC-4, REC-5 WONT-FIX. LOGIC-4 DECISION. REC-6 print by CSS only. `recipe.md` cites REC-8, which has no section. RT-1 fixed (toast stacking). LEAD-2, LEAD-3 fixed. |
| `/cook/:slug` | yes | yes | yes (`cookmode.md`; axe) | yes (COOK-1 to COOK-7; A11Y-2; RT-2) | yes (`verify1` to `verify7`; `cook-mode-logic.test.ts`; axe at 320, 375, 812x375; e2e) | yes | pending red-team round 2 and final pass | COOK-2 FIXED-UNVERIFIED (Done next step not scripted). COOK-3, COOK-4 no screen reader run. RT-4 WONT-FIX (100 servings). LEAD-4 fixed. A11Y-7 cook back link not measured. |
| `/planner` | yes | yes | yes (`planning.md`; `a11y.md`) | yes (PLAN-1, PLAN-5; A11Y-1, A11Y-10, DS-8, DS-10; RT-5) | yes (`verify-fix.mjs`, `dot.mjs`, `panel-names.mjs`; targets; axe 320 to 1440) | yes | pending red-team round 2 and final pass | PLAN-1 full script not re-run after its timing fix. A11Y-11 OPEN at 320. PERF-7 FIXED-UNVERIFIED. |
| `/shopping` | yes | yes | yes (`planning.md`) | yes (PLAN-2, PLAN-3, PLAN-5; A11Y-10) | yes (`flow2.mjs`, `verify-fix.mjs`; unit `shopping-amounts`, `shopping-prune`, `shopping-tick-persistence`) | yes | pending red-team round 2 and final pass | RT-3 DECISION (accepted trade-off). PLAN-3 verified by unit tests only. PLAN-4 DECISION. LOGIC-5 OPEN. |
| `/pantry` | yes | yes | yes (`planning.md`; empty state) | yes (A11Y-10 pantry form; DS-10 pantry icon buttons) | yes (overflow and axe at 320 to 1920, empty pantry) | yes | pending red-team round 2 and final pass | Populated pantry at 320 not recorded in any findings file. |
| `/journal` | yes | yes | yes (`journal.md`) | yes (JRN-1 to JRN-4, JRN-6; DS-8, DS-10, A11Y-10 journal parts) | yes (flow1 to 3, `measure`, `select`, `a11y10`, `reload5`) | yes | pending red-team round 2 and final pass | JRN-5 DECISION. JRN-7 OPEN-UNREPRODUCED (not reproduced in 8 runs). |
| `/settings` | yes | yes | yes (`settings.md`; axe) | yes (SET-1 to SET-5, SET-7, SET-8; LOGIC-6; DS-8 settings part) | yes (`probe1` to `probe5`, `verify-batch`, `persist.mjs`; unit backup tests) | yes | pending red-team round 2 and final pass | SET-6 WONT-FIX. PERF-3 FIXED-UNVERIFIED (lazy route; bundle size not measured). |
| `/help` | yes | yes | yes (`settings.md`, `shell.md`) | yes (SET-7, SET-8; SHELL-12) | yes (`help.mjs`, axe 320, 375, 1440 light and dark) | yes | pending red-team round 2 and final pass | LEAD-1 DECISION (minced-meat temperature; figures unchanged). PERF-3 FIXED-UNVERIFIED. |
| `/custom` | yes | yes | yes (`custom.md`) | yes (CUST-1 to CUST-12; RT-6 placeholder) | yes (`verify.mjs` to `verify4`, `responsive.mjs`, `journey-custom-settings.mjs`; `custom-ingredients.test.ts` 17/17) | yes | pending red-team round 2 and final pass | CUST-2, CUST-7, CUST-8 FIXED-UNVERIFIED. RT-6 required-field count DECISION. CUST-9 WONT-FIX. |
| 404 (`/does-not-exist`) | yes | yes | yes (`shell.md`) | yes (SHELL-4, SHELL-8; SHELL-5) | yes (axe at 375 light and dark) | yes | pending red-team round 2 and final pass | None open. |

## Cross-cutting, not a route

| Area | Status | Evidence |
| --- | --- | --- |
| Shell (App, nav, toasts, skip link, lazy routes) | fixed and tested; lazy routes FIXED-UNVERIFIED for bundle size | `shell.md` (Round 6); SHELL-1 to SHELL-14; RT-1 |
| Design system (tokens, primitives) | fixed and tested | `designsystem.md`; DS-1 to DS-12. DS-8 fixed per owner, no global recount |
| Logic and persistence | fixed and tested (unit); cloud sync not run against live Supabase | `logic.md`; LOGIC-10 DECISION |
| Accessibility | axe 0 violations across 104 page states; manual items fixed; e2e contract updated | `a11y.md`; A11Y-1 to A11Y-11; E2E-1 |
| Red team | RT-1 and RT-2 (P2) fixed; RT-5 (P3) fixed; RT-3 and RT-6 DECISION; RT-4 and RT-7 WONT-FIX (RT-7 covered by the e2e offline test). Round 2 pending | `REGRESSION_REPORT.md`; RT-1 to RT-7 |
| Performance | fixes for images, lazy routes, vendor chunks; catalogue loading, precache and font preload open | `findings/perf.md`; PERF-1 to PERF-10 |
| End-to-end and visual | full suite 69/69 plus 33 visual baselines (lead) | `tests/e2e/`; E2E-1, COOK-7 |

Note on perf file changes: `public/images/*.webp` (8 illustrations) were re-encoded to 1200 px WebP by the perf agent (PERF-1). Originals are kept at `/private/tmp/claude-501/airfuel-perf/orig-images/` per `perf.md`, so the earlier open question about whether originals were replaced is answered.
