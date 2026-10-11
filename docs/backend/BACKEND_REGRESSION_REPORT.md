# Backend red-team regression report

Scope: independent red-team review of the backend sweep against the published commit `3dea492`
(`git diff 3dea492`). Written without relying on the sweep's own summaries. Read-only for `src/`,
`supabase/` and existing tests. Added only new test files, scratch scripts and this report.

Date: 2026-10-11. Repo: AirFuel Kitchen (`/Users/raoof.r12/Desktop/Raouf/Fun`).

## 1. Totals

| Run | Files | Passed | Expected fail | Failed |
|---|---|---|---|---|
| Baseline at start of this review (`npx vitest run`) | 42 | 468 | 1 (SEC-7) | 0 |
| Final, after this review (`npx vitest run`) | 46 | 501 | 9 | 0 |

The 41 new tests are four files: 17 storage, 8 engine, 8 migration, 8 sync (one of which is a
pinning test, the rest RT-B). The 9 expected failures are the 8 RT-B defects below plus the existing
SEC-7 `it.fails`. Each RT-B test is an `it.fails`, so it stays green until its defect is fixed. When a
fix lands, the `it.fails` turns red and must be flipped to `it`.

New files (all in `tests/unit/`):

- `backend-redteam-storage.test.ts`: concurrent tabs, interrupted import, hostile backups, quota errors, merge/export size agreement, future timestamps, delete-all residue.
- `backend-redteam-engine.test.ts`: avoid-list spelling variants and allergen surfaces.
- `backend-redteam-migration.test.ts`: real v1 Dexie databases upgraded to v2, and backups across the `checks` field.
- `backend-redteam-sync.test.ts`: two simulated devices against the real three SQL migrations in PGlite, a fake Supabase client for the read cap, and the sync migration re-run.

Scratch scripts (`scripts/backend-audit/tmp/bredteam/`): `allergen-audit.mjs`, `meat-coverage.mjs`, `bench-query.ts`, `bench-query-old.ts`.

Lint: `eslint` clean on the four new test files. Not typechecked: no tsconfig includes `tests/` (`tsconfig.app.json` covers `src`, `tsconfig.node.json` covers `scripts/` and vite config). Vitest runs the files, which strips types without checking them.

## 2. Defects (RT-B), each encoded as `it.fails`

Severity follows the brief's scale. "Regression" means introduced by this sweep. "Pre-existing"
means already present at `3dea492`.

| ID | Sev | Status | Where | Test name (file: `backend-redteam-…`) | Origin |
|---|---|---|---|---|---|
| RT-B1 | P2 | OPEN | `src/lib/db.ts:854` (merge counts rows only); `db.ts:716` (export refuses over 20 MB); `src/lib/schema.ts:301` (claim) | `RT-B1 a merge whose result the 20 MB export limit would refuse is refused up front` (storage) | Regression: the 20 MB export limit and row caps are new in the sweep |
| RT-B2 | P2 | OPEN | `src/lib/db.ts:105-106` (`nextTime`), `db.ts:879` (merge keeps only a strictly larger `updatedAt`), `src/lib/schema.ts:140` (ceiling) | `RT-B2 a record stamped at the ceiling by one backup is still replaced by a genuine newer edit from another device` (storage) | Pre-existing: base `nextTime` (db.ts:90) has the same unbounded max |
| RT-B3 | P2 | OPEN | `src/lib/engine.ts:26` (`words`, splits on non-letters), `engine.ts:46-55` (`wordMatches`, `mentions`), `engine.ts:155` (avoid filter) | `RT-B3 avoiding an unaccented word also excludes its accented spelling` (engine) | Pre-existing blind spot; base matched by substring `contains` and was equally blind |
| RT-B4 | P2 | OPEN | same as RT-B3 | `RT-B4 a zero-width character inside an avoided word does not hide the ingredient` (engine) | Pre-existing (same cause) |
| RT-B5 | P2 | OPEN | same as RT-B3 | `RT-B5 a Cyrillic look-alike letter inside an avoided word does not hide the ingredient` (engine) | Pre-existing (same cause) |
| RT-B6 | P2 | OPEN | `supabase/migrations/202610110003_airfuel_sync_quota.sql:47` (quota 224,006); `src/cloud/supabase.ts:164` and `:201` (read cap 400 pages x 500 = 200,000) | `RT-B6 an account at its 224,006-row quota can still read everything it is allowed to hold` (sync) | Regression: the quota is new. The 200,000 read cap predates the sweep. The mismatch is new |
| RT-B7 | P3 | OPEN | `src/lib/db.ts:96` (fills only `undefined`); `src/pages/Explorer.tsx:103` (spreads `allergens`) | `RT-B7 the upgrade repairs a null legacy preference, not only a missing one` (migration) | Pre-existing: base upgrade identical. Needs a corrupt v1 row |
| RT-B8 | P2 | OPEN, needs a product decision | `src/cloud/core.ts:454-464` (delete-all clears conflicts); `src/pages/Settings.tsx:662` ("Export backup first") and `:691`; `src/lib/db.ts:671-676` (export reads only the nine data tables) | `RT-B8 the backup offered before delete-all keeps the losing value of an unresolved conflict` (sync) | Regression: the conflict store is new |

Detail for the three P2 items that matter most:

- **RT-B1.** Writes and merges check row counts, while export checks bytes. `schema.ts:301` says "the app can never reach a state its own export refuses", and that is not true. Each backup below is about 12 MB, under the 20 MB import limit. Merging two of them gives about 25 MB of local data. `importBackup` accepts the merge because it counts only rows (`db.ts:854`). The next `exportBackup` then throws "too large … nothing was exported". Consequence: a notes-heavy user can reach a state where backups fail, and the delete-all dialog's "Export backup first" also fails. Suggested fix (owner decision): count serialised bytes in `importBackup` merge and in `save`, or raise the export limit to match the sum of the caps.

- **RT-B6.** A sync account can be allowed to write rows that the same app can no longer read. The quota allows 224,006 rows (tombstones included, and they are never freed). `readAll` throws at 200,000 (`supabase.ts:201`). Past that point pull fails on every pass with "exceeds the supported 200,000-record limit". Local data is safe, but that account's sync is dead. The mismatch is reachable by churn: import about 112,000 records, delete them, import another set. Suggested fix: raise the page cap to at least 224,006 (`page < 450`), or lower the quota to 200,000 with the migration.

- **RT-B8.** The delete-all flow removes unresolved conflict copies (`deleteAllSyncState`, `core.ts:454`). A conflict copy holds the losing side of a same-record edit, which the local table no longer has. The "Export backup first" step does not include it, because `exportBackup` reads only the nine data tables. There is no warning or refusal in the dialog. This is deliberate in the code comment ("Sync conflict copies are personal data too"), but it is silent loss from the user's view. Suggested fix: either include unresolved conflicts in the export, or show the unresolved count in the delete dialog and require resolving them first (the way `forgetSyncBaselines` already refuses at `core.ts:465`).

## 3. Observations without a failing test

| ID | Sev | Finding | Evidence |
|---|---|---|---|
| OBS-1 | P3 | Quota counter can double-count under concurrency. Two devices inserting the same new record can both pass the `not exists` check and both increment `record_count`. Only one row is written, so the counter drifts upward and is never corrected. Regression (new). | `202610110003_airfuel_sync_quota.sql:40-48`. Reasoned from SQL. PGlite is single-connection, so not reproduced. |
| OBS-2 | P3 | Tombstones count toward quota forever, so delete-and-recreate churn permanently consumes capacity. This matches the documented design (CLOUD.md, API.md) but has no user-facing message. | `supabase/migrations/202610110003_airfuel_sync_quota.sql` header; `src/cloud/API.md:10`. |
| OBS-3 | P3 | `saveActiveCooking(null)` with no expected recipe deletes whatever cook is active. No UI caller found, so it is latent. | `src/lib/db.ts:627-646`. The `expectedActiveRecipeId` guard is optional. |
| OBS-4 | P3 | Status drift in docs. `SECURITY_AUDIT.md` lists SEC-9 as OPEN, yet the quota migration exists and its three mutation-checked tests pass. `inventory.md` lists ARCH-23 as OPEN, yet `postgrestErrorKind` now maps 42501 to `config` (`supabase.ts:89`). | `docs/backend/SECURITY_AUDIT.md:17,22,74`; `docs/backend/findings/inventory.md:35,365`. |
| OBS-5 | P3 | DATA-1 coverage gap, latent. The meat regex does not name pancetta, prosciutto, goat, rabbit, venison, brisket, sirloin and similar, so the core-temperature rule cannot see them. A scan found no such ingredient in the 300 catalogue recipes. Custom recipes are not run through this validator. | `scripts/data-rules.ts:48-49` (`MEAT_RE`). Scan: `scripts/backend-audit/tmp/bredteam/meat-coverage.mjs`, result 0. |
| OBS-6 | P3 | The engine doc overstates the headline. The 1,500-token example in `docs/backend/findings/engine.md:66,114-115` is mostly the `Set` dedup of repeated tokens, not the word cache. Distinct-token queries improved about 4x. | Benchmark: `scripts/backend-audit/tmp/bredteam/bench-query.ts`, `bench-query-old.ts` (table in section 5). |
| OBS-7 | P3 | Allergen exclusion depends only on each recipe's declared `allergens`, not on ingredient text. The catalogue scan found no undeclared allergen keyword. The only hits were judgement calls: vinegar read as a sulphite source (5 recipes plus variants), coconut milk and almond butter read as dairy, and "cream-style mustard". These are lead decisions, not defects. | `scripts/backend-audit/tmp/bredteam/allergen-audit.mjs`, 300 recipes, 22 hits, all in that list. |
| OBS-8 | P3 | Non-idempotent migrations. A re-run of the sync migration on a populated database fails safely and changes nothing, because `create table` fails inside the transaction. Verified. | `backend-redteam-sync.test.ts` "re-running the sync migration…" (passes). |

## 4. Claims checked

Claimed fixes checked by reverting each fix in a scratch copy and running the cited tests (script:
`/private/tmp/claude-501/bredteam-mut/mutate.py`):

| Claim | Revert applied | Cited test fails on revert? |
|---|---|---|
| ENG-19 override ingredients fail closed | allergens fall back to baseline when ingredients change | Yes: "an override that changes ingredients fails closed…" |
| SEC-6 non-absolute source URL | `try/catch` removed from the URL refine | Yes: at least 6 tests, including "SEC-6 reports //example.com/recipe as a validation issue instead of throwing" |
| SEC-3 merge beyond caps | row-cap refusal in merge disabled | Yes: "refuses a merge that would exceed the custom-recipe cap, and writes nothing" |
| ARCH-3 no active cook created by a tick | "start cooking" guard disabled | Yes: "setCookingCheck with no active cook throws and writes no activeCooking row" |
| DATA-1 exemption | exemption branch removed | Yes: "exempts a recipe whose only poultry is already cooked…" and "has no core-temperature violation beyond the known defect ledger" |
| SYNC-2 displaced local value kept | conflict recording disabled | Yes: at least 6 tests across `backend-sync-engine` and `backend-sync-transport` |
| STO-1 damaged record named on export | damaged rows exported raw | Yes: "export names a damaged record instead of dumping a raw validation error" |
| ARCH-23 42501 is config, not permanent | 42501 mapped to `permanent` | Yes: "maps each error shape to exactly one retry policy" |
| SEC-9 quota refuses a new record at the cap | cap check disabled | Yes: 3 tests in `backend-sync-quota-backfill` and `backend-sync-rls` |

All nine cited test sets fail on revert, so none is a mirror-only test for these claims. I did not
read every cited test for mirroring; that is a narrower claim than "all tests are behaviour tests".

Other claims:

- **Allergen exclusion before ranking.** Confirmed. `recommendRecipes` filters candidates (`engine.ts:237-255`) before any score (`engine.ts:274+`). Every surface was traced: Explorer (`Explorer.tsx:103`), Surprise me (`Explorer.tsx:221-224`, runs on the already-filtered list), Dashboard (`Dashboard.tsx:38-43`), Planning choices (`Planning.tsx:150-152`). All pass the profile allergens through the same filter. No bypass found by code path.
- **Custom recipes fail closed for allergens.** Confirmed (`engine.ts:150-153`). They are excluded whenever the user has any allergen or dietary restriction.
- **Override cannot weaken canonical allergens.** Confirmed (`engine.ts:80-101`). The only gap is avoid-list spelling (RT-B3 to RT-B5), which is not an allergen path.
- **Sync stale-device resurrection.** Confirmed by test (sync: "a device that deleted a record online…"). A stale edit is refused and kept as a conflict, and the tombstone stays.
- **Duplicate cooking sessions on redelivery.** Confirmed by test (sync: "a cooking session whose response was lost…"). The operation id is reused, so the server treats the retry as a no-op.
- **Two-tab writes.** Confirmed by tests: 30 interleaved toggles keep the right parity, 40 interleaved ticks keep every index, and two concurrent cook starts yield exactly one.
- **Hostile backups.** Confirmed by tests: prototype-pollution keys are rejected at top level and in rows; the 10,000 shopping-row cap accepts and 10,001 refuses; future timestamps beyond the ceiling are refused; `javascript:` and relative source URLs are refused. Failed merges and replaces roll back in full (both by spy-induced failure).
- **Quota error text.** Confirmed by test: a storage-full error reaches the user as the storage message and changes nothing.
- **42501 config handling.** Confirmed by the mutation above and by `postgrestErrorKind` mapping (test: "maps every server error class to the retry policy the controller relies on").
- **Migrations applied in order to an empty database.** Confirmed in PGlite (the sync suite's `beforeAll`). Populated-database backfill is covered by the existing `backend-sync-quota-backfill` test.
- **Legacy v1 to v2 upgrade.** Confirmed for missing and null-valued `servingsConsumed`, partial preferences, and reopen idempotency. Null preferences are the RT-B7 exception.
- **Delete-all residue (IndexedDB).** Confirmed: after `clearUserData`, all nine tables are empty. Sync DB is cleared by `deleteAllSyncState`. Session storage and local storage: the note-draft reset marker in `localStorage` is intentional (`noteDrafts.ts`). I did not verify residue in a real browser.
- **RLS cross-user reads and writes.** Not re-tested here. The existing `backend-sync-rls` suite covers it and I ran it under the same owner setup (non-BYPASSRLS).

## 5. Performance spot-check (engine.md)

Claim (`docs/backend/findings/engine.md:66`): a 1,500-token query went from 387 ms to 0.42 ms.

Measured here, same machine, load average about 4 to 11 during the run, 30 runs each, p50:

| Query shape | Published engine (`3dea492`) | This sweep |
|---|---|---|
| "chicken " x1500 (repeated, deduplicated) | 153.7 ms | 0.34 ms |
| 1500 distinct non-matching tokens | 1.19 ms | 0.28 ms |
| 1500 distinct tokens, 2 matching | 1.16 ms | 0.25 ms |
| "chicken rice" (short) | 1.11 ms | 0.06 ms |

The direction and the post-fix number reproduce. The pre-fix figure is lower here (154 ms against the claimed 387 ms), which fits the claim's note about load. The headline is mostly the dedup `Set` (OBS-6). The word-cache gain for ordinary queries is about 4x. Status: confirmed in direction, with the wording overstated.

## 6. Could not verify

- Blocked-upgrade behaviour in a real browser. `upgrade-interactions.test.ts` covers the Dexie events, not a cross-tab block.
- Quota errors under real concurrency. fake-indexeddb does not reproduce browser quota limits, and PGlite is single-connection. OBS-1 is reasoned only.
- Live Supabase behaviour: PostgREST row limits, GoTrue JWT handling, Supabase role setup. The sync suite states this scope itself.
- The rest of the RLS matrix beyond the existing suite.
- Playwright end-to-end (not run, by instruction).
- Real-browser residue (session storage, service worker caches). Only IndexedDB and the sync database were checked.
- Concurrency across real OS processes or separate browser profiles. Two Dexie instances in one process stand in for two tabs.

## 7. Recommended owner actions (priority order)

1. RT-B8: decide whether unresolved conflicts go into the export or block delete-all. This needs a product decision, then a test flip.
2. RT-B1: count bytes in the merge check (or align export with the row caps). Then flip RT-B1.
3. RT-B6: align `readAll` with the quota (raise the page cap to 450 or lower the quota). Then flip RT-B6.
4. RT-B3 to RT-B5: fold accents (NFKD and strip marks), remove format characters, and map common confusables before word matching. Apply the same normalisation to stored ingredient text.
5. RT-B2: bound merge clock skew, or reject incoming `updatedAt` more than a small margin ahead of the importing clock. Then flip RT-B2.
6. RT-B7: make the upgrade repair `null` as well as `undefined` for preference keys.
7. Docs: fix SEC-9 and ARCH-23 status (OBS-4), and reword the engine benchmark (OBS-6).

Files changed: none under `src/`, `supabase/` or existing tests. New files only, as listed in section 1.
