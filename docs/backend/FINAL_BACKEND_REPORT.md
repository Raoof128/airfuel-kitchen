# Final backend report: Operation Backend Zero-Defect

Date: 2026-10-11. Baseline: commit `3dea492` (the public frontend-sweep commit).
How it was run: a lead (Claude Opus 5.5) coordinated Claude Haiku 5.5 subagents with separate file ownership:
- storage
- engine
- sync
- recipedata
- security (read-only for `src`)
- inventory (read-only)
- bperf (benchmarks)
- cloudui (sync UI)
- register (documentation)
- an independent backend red-team (bredteam), run after the repairs

Front-end owners from the earlier sweep made the page-level changes. The shared brief is in `AGENT_BRIEF.md`, and the per-agent logs are in `findings/*.md`.

## 1. Architecture found (and audited as it is)

AirFuel Kitchen is **local-first with optional cloud sync**. No server was invented.
- **Primary store:** IndexedDB via Dexie (`src/lib/db.ts`, schema v1 → v2, unchanged version), validated by zod (`src/lib/schema.ts`).
- **Domain logic:**
  - `src/lib/engine.ts`: search, filters, rule-based recommendations, scaling, shopping and nutrition helpers.
  - `src/lib/customRecipe.ts`: the custom-recipe parser and food-safety minimums, moved out of the page.
  - `src/lib/noteDrafts.ts` and `src/lib/navigation.ts`.
- **Canonical catalogue:** 300 recipes in `src/data/*.json`, kept separate from personal data. Research evidence lives in `research/`.
- **Optional sync:** `src/cloud/{core,controller,index,supabase}.ts`, against one Supabase table behind a security-definer RPC. There are three SQL migrations: `0001` (the original, untouched), `0002` (no `FORCE` RLS) and `0003` (a per-account quota). No Supabase project is configured.
- **Recommendations:** deterministic rule-based scoring. Hard exclusions apply first, then soft signals. `now` and `random` can be injected. It is not machine learning.

## 2. Scope inspected

| Area | Inventory |
| --- | --- |
| Modules | 17 backend-equivalent modules plus page-level persistence callers (`BACKEND_INVENTORY.md`) |
| Functions and operations | Every exported db action, engine function, cloud API and SQL object (`FUNCTION_AUDIT.md`) |
| Dexie tables | 9 user tables + the sync database (records, outbox, conflicts, meta) |
| SQL objects | 2 tables, RLS policies, 1 security-definer RPC, grants, 3 migrations |
| Recipes | 300, all validated programmatically (`RECIPE_DATA_REPORT.md`) |

## 3. Defects (`ISSUE_REGISTER.md`, 112 rows)

| Severity | Found | Open now |
| --- | --- | --- |
| P0 | 0 | 0 |
| P1 | 15 | 0 |
| P2 | 50 | 5 (ARCH-6, a decision paired with SYNC-13; DATA-3, -4, -6, -7, which are research-owner data checks) |
| P3 | 47 | 24 (debt, wording and editorial data) |

Status totals:
- 64 fixed and verified
- 2 fixed, partly unverified
- 29 open (above)
- 13 decisions
- 4 won't-fix

### P1s fixed (all with regression tests)

- **STO-1:** one damaged record blocked export and the replace-restore that could repair it.
- **ENG-19 / SEC-1:** a backup override could add peanuts or meat yet keep its allergen and vegetarian claims, so it passed the exclusion filters. A changed ingredient list now fails closed.
- **SEC-3 / RT-B1:** merges could exceed the caps, or the 20 MB export size. The result is now checked before any write.
- **SYNC-1:** one rejected record stalled every other record.
- **SYNC-2 / LOGIC-10:** the losing value in a first-sync conflict was silently discarded. It is now kept as a conflict, with keep-this-device / keep-cloud resolution in Settings.
- **SYNC-3:** stale rows overwrote newer remote changes.
- **SYNC-4:** one invalid local row stopped sync, and its tombstone could delete the cloud copy.
- **ARCH-2:** clearing the sync cache made a newer offline edit lose to an older server copy.
- **ARCH-23:** permission errors marked records permanently rejected. They are now a configuration error that is retried, and the user can retry rejected records.
- **ARCH-5:** `FORCE ROW LEVEL SECURITY` made every RPC write fail unless the owner had BYPASSRLS. New migration `0002` turns it off. Clients remain fully bound by RLS, which 27 PGlite tests prove with a NOBYPASSRLS owner.
- **COOK-7** (front-end, found by e2e): the Done click was dropped after editing servings.

### Notable P2 fixes

- Recipe-page ingredient and step ticks no longer start a cook or block other recipes (`setRecipeCheck`; ARCH-3).
- Merge import keeps the local active cook (ARCH-4).
- Shopping writes are single transactions (`saveShoppingBatch`, `clearTickedShopping`; ARCH-12).
- Avoid-list matching handles whole words ("egg" no longer matches "eggplant"), and both the avoid list and search fold accents, zero-width characters and look-alike letters (ENG-1, ENG-21).
- Wheat and gluten are treated as one allergen (ENG-4).
- One rating no longer lifts a whole category (ENG-6).
- Recommendations no longer cycle the same 8 recipes (ENG-16).
- Future timestamps in imports are capped (RT-B2).
- A per-account sync quota (SEC-9), with the client's read bound aligned to it (RT-B6).
- Build-time CSP (SEC-10).
- Delete-all also clears the remembered search (SEC-11) and the whole sync database, conflicts included.
- The planner and shopping list warn about meals that break new exclusions (SEC-14).
- A message when another tab on an older build blocks the database upgrade (STO-5), verified in a real browser.

## 4. Database changes and migration implications

- **Dexie:** no version bump.
  - `RecipeState.checks` is a new optional, non-indexed field. Old rows and old backups remain valid; tests cover this.
  - The v1 → v2 upgrade is proven to preserve every record byte for byte, apart from its intended defaults, and to roll back cleanly when an upgrade throws midway.
  - Null preferences now get defaults (RT-B7).
- **Supabase:** two new migrations to apply in order after `0001`, documented in `docs/CLOUD.md`:
  - `202610110002_airfuel_sync_no_force_rls.sql`
  - `202610110003_airfuel_sync_quota.sql`, whose backfill is tested on an already populated database.

  The applied `0001` is unchanged.
- **Backup format:** unchanged.

## 5. Security (`SECURITY_AUDIT.md`)

Baseline: OWASP ASVS 5.0 and the OWASP API Top 10 (relevant controls only).
- **Fixed:** SEC-1, -2, -3, -4, -5, -6, -8, -9, -10, -11, -14, -17.
- **Open:** 0 P1, 1 P2 (SEC-7, the 512 KiB sync payload limit: a decision), 5 P3.
- **Verified clean:**
  - No HTML-injection sinks.
  - `javascript:` links are refused at import.
  - Prototype-pollution keys are rejected.
  - No secrets in source, build or the public git history.
  - `npm audit` reports 0 vulnerabilities (production and full tree).
  - Cross-user isolation, anon denial and direct-write denial are covered by PGlite tests against the real migrations.
- **Hosting:** `frame-ancestors` and the other header-only controls must be set by the host (the header set is in `SECURITY_AUDIT.md`).

## 6. Data integrity (`DATA_INTEGRITY_AUDIT.md`, `MIGRATION_AUDIT.md`, `RECIPE_DATA_REPORT.md`)

- **Catalogue:** 300 recipes, 0 validator errors, 113 documented warnings; 257 fully validated, 43 for manual review.
- **Claims checked:** the "128 mains ≥ 25 g protein" claim is true. Its definition, which includes vegetarian, is now stated.
- **AFCD recompute:** 179 of 182 AFCD-calculated records reproduce within 1 g and 5 kcal.
- **Food-safety rule:** it found one false positive (a salad using pre-cooked chilled chicken). The rule now exempts that case only with an explicit safety line, and raw poultry still errors.
- **Tempeh source:** re-verified live (HTTP 200).
- **Owner decision:** whether to move 26 minced, stuffed or rolled recipes from 71/74°C to the NSW 75°C row (DATA-5). Figures are unchanged.

## 7. Performance

- **Engine benchmarks** (300 recipes, 2,000 sessions, 300 states, 200 pantry items; the machine was heavily loaded, so the numbers are noisy):

  | Operation | p50 |
  | --- | --- |
  | Recommend | ≈ 2 ms |
  | Search | < 1 ms |
  | Weekly shopping aggregation | ≈ 1.2 ms |

  - A 1,500-token query went from 387 ms to 0.4 ms. The red-team reproduced the post-fix number and noted the headline gain is mostly de-duplication; distinct-token queries improved about 4×.
  - The variety selection is now linear instead of O(n² log n).
- **Front-end performance:** carried in `docs/frontend/PERFORMANCE_AUDIT.md`.
- **Data-layer benchmarks:** the dedicated benchmark agent was stopped after more than an hour without producing results. Those measurements, and PERF-2 (catalogue loading), are open and are not claimed. See `PERFORMANCE_AUDIT.md`.

## 8. Tests

| Suite | Result |
| --- | --- |
| Unit (Vitest, fake-indexeddb, PGlite) | **519 passed + 2 expected-fail, 48 files** (109 at the start of the sweep, 58 originally) |
| Expected failures | SEC-7 (512 KiB sync bound, a decision); RT-B8 (backups don't include sync-conflict copies; a decision, the delete dialog warns instead) |
| E2E (Playwright, production build) | **102/102** on the final tree (69 functional/a11y/security + 33 visual-regression snapshots) |
| Lint / typecheck / data validation / npm audit | clean / clean / 0 errors / 0 vulnerabilities |

Test quality: the red-team reverted nine claimed fixes (ENG-19, SEC-6, SEC-3, ARCH-3, DATA-1, SYNC-2, STO-1, ARCH-23, SEC-9), and each cited test failed. Sync did the same for SEC-8.

## 9. Independent review (`BACKEND_REGRESSION_REPORT.md`)

The red-team found 8 new defects.
- **Fixed:** RT-B1, RT-B2, RT-B3/4/5, RT-B6 and RT-B7.
- **Decision:** RT-B8.

It also confirmed that allergen exclusions are applied before ranking on every surface.

## 10. Limitations, stated plainly

- **No live Supabase:** GoTrue, PostgREST, JWT refresh and real two-device sync are untested. The SQL is proven on PGlite with stubbed auth, and the sync client with a fake transport.
- **Simulated concurrency:** cross-tab behaviour was tested with two Dexie instances, not real browser tabs. The blocked-upgrade path is the exception: it was checked in a real browser.
- **Research data:** DATA-3/4/6/7 need a human to re-fetch sources, weigh a cooked thigh and decide solid-ingredient densities.
- **Single writes:** not size-checked against the 20 MB export limit. Merges, the realistic path, are.

## 11. Commands

```bash
npm ci
npm run lint && npx tsc -b && npx vitest run && npm run validate:data
npm run build && npx playwright test        # production preview on 4173
# Cloud (optional): apply supabase/migrations/0001 → 0002 → 0003 in order; see docs/CLOUD.md
```
