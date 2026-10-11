# Backend test report (AirFuel Kitchen backend sweep)

Compiled 2026-10-11 by the backend register compiler. Numbers come from a full `npx vitest run` in the working tree, plus a JSON run for per-file counts (`/private/tmp/claude-501/airfuel-backend-vitest.json`). The test-count grep in the brief is not used: `describe` blocks and `it.each` make static counts wrong.

## Final numbers

| Check | Result | Notes |
| --- | --- | --- |
| Unit, plain full run (`npx vitest run`) | **47 files; 514 passed; 2 expected failures; 516 tests** | Matches the lead's last report except one expected failure became a passing test (RT-B6). Earlier report was 513 passed, 3 expected. |
| Unit, JSON full run | 47 files; 515 counted as passed or expected; **1 failed** | The failure is TEST-1 (`backend-storage-backup.test.ts`, "merges a conflicting record by timestamp"). Flaky, see below. |
| Unit, isolated rerun of `backend-storage-backup.test.ts` (2 runs) | run 1: 1 failed, 21 passed; run 2: 22 passed | Same test. |
| Expected failures | 2 | SEC-7 and RT-B8, listed below with reasons. |
| E2E (Playwright) | **102 of 102 (69 functional + 33 visual)** on a production build, before the red-team fixes | Lead-reported. Not re-run by this compiler (instruction: the lead runs e2e). |
| Production build | Not run by this compiler | The lead's CSP smoke on 10 routes (0 violations) is lead-reported under SEC-10. |
| Type check and lint | Not re-run by this compiler | `tests/` is not in any tsconfig (red team note); `tsc -p tsconfig.app.json` covers `src`. |

**The unit suite is not stable.** TEST-1 failed in one of the two full runs and one of two isolated reruns. Treat any "all green" claim from this suite as "green in that run" until TEST-1 is fixed.

## Expected failures (`it.fails`, pass while the defect or decision stands)

| Test | File | Why it is still an expected failure |
| --- | --- | --- |
| SEC-7: refuses to queue a record the server will reject as over 512 KB | `tests/unit/backend-security-input.test.ts:203` | The lead decided (SYNC-13) to keep the 512 KiB server bound and document it, rather than add a client byte limit. The test asserts the client-side refusal the decision did not adopt. It stays expected-fail until the decision is revisited (ARCH-6 is the same question). |
| RT-B8: the backup offered before delete-all keeps the losing value of an unresolved conflict | `tests/unit/backend-redteam-sync.test.ts:321` | The backup format is unchanged by decision (only P0/P1 fixes may change it). The Settings delete dialog now counts unresolved conflicts and warns that they are deleted and not in a backup (LEAD-B11). The test asserts the backup includes them, so it stays expected-fail. |

Tests that were expected failures in earlier reports and are now plain `it` (passing): RT-B1, RT-B2, RT-B3, RT-B4, RT-B5, RT-B6, RT-B7, SEC-1, SEC-2, SEC-3, SEC-4, SEC-6 (per the findings files).

## Flaky test (open)

| Test | File | Symptom | Cause (analysis) | Owner action |
| --- | --- | --- | --- | --- |
| merges a conflicting record by timestamp: newer wins, ties keep the local copy | `tests/unit/backend-storage-backup.test.ts:312` | `expected 'local' to be 'newer import'` in 1 of 2 full JSON-run and isolated runs | The test sets the incoming row to `local.updatedAt + 1000`, which is in the future. The RT-B2 cap clamps incoming `updatedAt` to `now - 1` at preview time. The outcome then depends on whether at least 1 ms passes between the save and the preview. This is a race in the test's clock, not a merge bug. | Storage owner: pin the clock, or put the local row's `updatedAt` in the past and set incoming to `now - 1000`. No sleeps. |

## Files and what they prove

Counts are assertions (`it`, `test`, `it.fails`) per file from the JSON run. "Area" refers to the register IDs.

| File | Tests | What it proves | Area / IDs |
| --- | ---: | --- | --- |
| `backend-cloudui.test.ts` | 19 | Sync status UI: state labels, counts copy, conflict copy and summaries | SYNC-8 |
| `backend-custom-safety.test.ts` | 19 | Food-safety core-temperature rule by category, protein and packaged ingredients | ARCH-8, DATA-1 |
| `backend-data-catalogue.test.ts` | 26 | Catalogue invariants for the 300 recipes: shape, times, food safety, nutrition, sources, allergens, units | DATA-1 to DATA-12 |
| `backend-engine-nutrition.test.ts` | 22 | Scaling over the whole catalogue, nutrition totals, shopping aggregation and display | ENG-11, ENG-12 |
| `backend-engine-safety.test.ts` | 16 | Allergen exclusion before ranking, whole-word avoid list, dietary hard constraints, catalogue declarations | ENG-1, ENG-4, ENG-19 |
| `backend-engine-scenarios.test.ts` | 27 | Personas (new user, dislikes, history), diversity over a month, pantry explanations, repeat favourite | ENG-5, ENG-6, ENG-10, ENG-16 |
| `backend-engine-search.test.ts` | 16 | README queries on the real catalogue, filter combinations, word-start matching, hostile query length | ENG-7, SEC-5 |
| `backend-navigation.test.ts` | 3 | Explore location memory accepts only in-app fragments; forgetExploreLocation | SEC-11 |
| `backend-redteam-engine.test.ts` | 8 | Avoid-list spelling variants (accents, zero-width, Cyrillic) and allergen exclusion on every surface | RT-B3, RT-B4, RT-B5, ENG-21 |
| `backend-redteam-migration.test.ts` | 8 | v1 to v2 upgrade with legacy and corrupt rows; backups across the checks field | RT-B7 |
| `backend-redteam-storage.test.ts` | 17 | Concurrent tabs, interrupted imports, hostile backups, quota errors, merge vs export size, future timestamps, delete-all residue | RT-B1, RT-B2 |
| `backend-redteam-sync.test.ts` | 8 | Stale devices, redelivery, quota and read cap, sync migrations, delete-all with unresolved conflicts | RT-B6 (pass); RT-B8 (expected fail) |
| `backend-security-input.test.ts` | 19 | Hostile backup structure, URL schemes, text bounds, sync payload size | SEC-6; SEC-7 (expected fail) |
| `backend-security-integrity.test.ts` | 5 | Override food restrictions, far-future timestamps, merge caps, UI restore limit | SEC-1, SEC-2, SEC-3, SEC-4 |
| `backend-security-web.test.ts` | 10 | CSP inline-script hash, DOM sinks, outbound links, logging hygiene, bounded search cost | SEC-5, SEC-10 |
| `backend-storage-active-guard.test.ts` | 4 | saveActiveCooking conflict guard, including two-tab replace and clear | STO-8 |
| `backend-storage-backup.test.ts` | 22 | Backup format and coverage, restore cases, storage failures during backup and restore, limits, key order | STO-1 to STO-4; TEST-1 (flaky) |
| `backend-storage-cook-shopping.test.ts` | 15 | Ticks with nothing cooking, merge keeps local cook, batch shopping writes are one transaction | ARCH-3, ARCH-4, ARCH-12 |
| `backend-storage-invariants.test.ts` | 20 | Smart-memory invariants, write failures never reported as success, catalogue changes and referential integrity | STO-6, STO-7, STO-9 |
| `backend-storage-limits.test.ts` | 9 | Timestamp ceiling, merge caps, malformed source URL as a field issue | SEC-2, SEC-3, SEC-6 |
| `backend-storage-migration.test.ts` | 8 | v1 to v2 upgrade: empty, populated, rollback on failure, retry, blocked upgrade | STO-5 (mechanism) |
| `backend-storage-recipe-checks.test.ts` | 18 | Recipe-page checks without Cook Mode, checks in schema and backups, seeding a new cook | ARCH-3 |
| `backend-storage-sizes.test.ts` | 6 | Merge judged by export bytes, future-stamped rows, null preferences repaired | RT-B1, RT-B2, RT-B7 |
| `backend-sync-controller.test.ts` | 11 | Controller rules: sign-in after sign-out, retry on config errors, delete-all with unresolved conflicts | ARCH-7, ARCH-19, ARCH-23, LEAD-B10 |
| `backend-sync-engine.test.ts` | 25 | Offline queue, retry policy, failure classes, delete propagation, convergence, invalid rows, first-sync conflicts | SYNC-1 to SYNC-4, SYNC-7, ARCH-2 |
| `backend-sync-quota-backfill.test.ts` | 3 | Quota backfill on a populated database | SEC-9 |
| `backend-sync-rls.test.ts` | 30 | Migrations in PGlite: anon and cross-user denial, revision ordering, constraints, security-definer hardening, no-FORCE, quota | ARCH-5, SEC-9, SYNC-12 |
| `backend-sync-transport.test.ts` | 13 | PostgREST error mapping (incl. 42501 as config), paginated reads, conflicts, blocked records, status mapping | SYNC-5, SYNC-6, ARCH-23 |
| `backup-all-tables.test.ts` | 2 | Backup includes all personal data | backup coverage |
| `backup-preview-conflicts.test.ts` | 3 | Backup preview conflict counting | restore |
| `backup-schema-errors.test.ts` | 3 | Wrong-schema backup message | restore |
| `cloud.test.ts` | 10 | Optional cloud queue and conflict engine; cloud config and SQL boundary static checks (no live project) | SYNC-2, SYNC-13 config |
| `cook-mode-logic.test.ts` | 4 | Cooking timer deadlines and transitions | timer |
| `custom-ingredients.test.ts` | 17 | Custom ingredient entry and natural ingredient lines | ARCH-8, CUST |
| `db.test.ts` | 9 | IndexedDB persistence, validated backups, migration | base persistence |
| `engine.test.ts` | 8 | Strict recipes, search and recommendations, quantities and consumption | engine base |
| `format-amount.test.ts` | 3 | formatAmount fractions and ingredientDetails separator | LEAD-2, LEAD-3 |
| `integration-hardening.test.ts` | 9 | Integration regressions across db, engine and cooking | integration |
| `note-drafts.test.ts` | 4 | Temporary recipe-note privacy in sessionStorage and reset broadcast | SEC-11 (residue) |
| `notes-concurrency.test.ts` | 5 | Recipe notes across tabs: stale-tab guard | LOGIC-1 (frontend) |
| `search-words.test.ts` | 5 | Search matches whole words, folded spellings | ENG-21 |
| `session-rating.test.ts` | 2 | Session rating and recipe rating interaction | JRN-5 (frontend) |
| `shopping-amounts.test.ts` | 5 | Shopping amounts read naturally (spoons, litres) | ENG-12, ENG-13 |
| `shopping-prune.test.ts` | 2 | Stale generated shopping ticks pruned after 28 days; manual items kept | PLAN-3 (frontend), RT-3 |
| `shopping-tick-persistence.test.ts` | 3 | Manual shopping ticks persist, including with a same-name pantry item | not a backend defect (frontend tick race) |
| `upgrade-interactions.test.ts` | 9 | Rapid and concurrent personal-memory interactions, cooking activity and timer persistence | STO-1 family, ENG (cross-tab) |
| `write-errors.test.ts` | 6 | User-facing write error messages | STO-3, LOGIC-2 |

Total: 47 files, 516 tests (514 passing, 2 expected failures in the plain run; TEST-1 is flaky).

## Gaps the suite does not cover

- Live Supabase: no project is configured, so RLS, GoTrue, PostgREST error codes and the 500-row API limit are tested on PGlite and mocks only (`backend-sync-rls`, `backend-sync-transport`).
- Real browser concurrency and quota: two Dexie instances stand in for two tabs; fake-indexeddb does not reproduce browser quota limits (red team section 6).
- Dexie v1 to v2 upgrade in a real browser: covered in tests, and the blocked upgrade is browser-verified once (STO-5, lead).
- Engine and recipe data are covered on the catalogue as shipped. Custom recipes are not run through the data validator (OBS-5).
