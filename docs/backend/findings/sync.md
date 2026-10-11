# Sync and Supabase security findings (agent: sync, prefix SYNC)

Scope: `src/cloud/*`, `supabase/migrations/202610110001_airfuel_sync.sql` (read only, not edited), `docs/CLOUD.md`, `src/cloud/API.md`, and tests `tests/unit/backend-sync-*.test.ts`.
Verification: full `npx vitest run` gave 351 passed, 9 expected-fail, 1 failed. The failure is `tests/unit/backend-engine-search.test.ts` (a randomised engine test that times out under load, owned by the engine agent). All sync tests pass (`backend-sync-rls` 26, `backend-sync-engine` 19, `backend-sync-transport` 13, `cloud` 10). `tsc -p tsconfig.app.json` and eslint on my files are clean. No Supabase project was contacted. Nothing was committed.

Test-location note: the brief names `tests/db/*`, but `vite.config.ts` only includes `tests/unit/**/*.test.ts`. The PGlite suite therefore lives at `tests/unit/backend-sync-rls.test.ts` so it runs in CI. Changing the include is a lead decision.

## Protocol map (as audited)

- **Outbox / pending.** `SyncDB.records` holds per-record state: `fingerprint` (validated local payload), `revision`, `operationId`, optional `pending` (outbound WireRecord), `incoming` (write-ahead receipt).
- **Revision ordering.** Lamport revision plus UUID. The server (`airfuel_apply_change`) keeps the greatest `(revision, operation_id)`. Client compare: `compareVersion`.
- **Operation IDs.** `crypto.randomUUID()` per local change. Retries reuse the same operation (idempotent acknowledgement).
- **Tombstones.** `deleted=true` with null payload; stored remotely and never purged.
- **Cursors.** None. Each pass re-reads the full owner set with sorted pagination (500 per page, 400-page cap = 200,000 records).
- **Retries.** `retryDelay`: 30s, 60s, 120s, 240s, then 300s cap; reset on success; online-event retry; Web Lock per origin.
- **Auth.** `authenticatedSession` refreshes a token within 60s of expiry and verifies it with `auth.getUser`. The pass pins its token, and an account change stops the pass (`ensureActive`).
- **Identity mapping.** Binding `${url}|${userId}` stored once per browser; a second account is refused.
- **Initial sync.** No baseline means revision 0, so each local row becomes revision 1. This is the LOGIC-10 path.

## SYNC-1: One permanently rejected record stalled every other record
- Severity: P1
- Module / file: `src/cloud/core.ts` `SyncEngine.run` (original loop over pending records).
- Reproduction: a single pending write that the server refuses (constraint or payload rejection) makes `apply` throw. The original loop had no per-record handling, so `run()` threw before the other pending records and before any pull. Every 5-minute retry repeated the same failure.
- Evidence: test `does not let one permanently rejected record block every other record (head-of-line)`. Before the change this test could not run, because the classifier did not exist yet. The defect was confirmed by reading the original loop, not by running the original code against the test.
- Root cause: no failure classification; any error was treated as retryable at the pass level.
- Fix: `classifySyncError` (transient / permanent / auth). A permanent rejection is marked `blocked` on that record. It keeps its local value and is not retried until the record changes. Transient and auth errors still stop the pass. `pending` excludes blocked records, and `rejected` reports them.
- Regression tests: `does not let one permanently rejected record block every other record (head-of-line)`, `stops retrying a permanently rejected record but keeps it and reports it`, `a rejected record stays local, and a later edit clears the block and retries`.
- Status: FIXED-VERIFIED (local tests)

## SYNC-2: First-sync and concurrent same-record conflicts silently discard the losing value (LOGIC-10)
- Severity: P1
- Module / file: `src/cloud/core.ts` `keepDisplacedValue`, `finishReceipt`, `acceptRemote`; `src/cloud/index.ts` (status counts, `listCloudConflicts`, `resolveCloudConflict`).
- Reproduction: two devices with different values for the same record, both before any sync (or both from the same revision). The UUID tie-break picks a winner, and the loser's local value was then overwritten during `acceptRemote` with no record kept.
- Root cause: the overwrite path never preserved a dirty local value that differed from the winner.
- Fix (client only, no server change): before a winner overwrites local data, the displaced value is written to a new `conflicts` table in the sync database (SyncDB version 2, a metadata store only; the Dexie schema of `KitchenDB` is unchanged). This covers (a) an unacknowledged or unsynced local value displaced by a different winner, and (b) an acknowledged value displaced by a write at the same revision from another device. The winner rule is unchanged, so convergence is unchanged. `resolveConflict(key, 'local'|'remote')` makes the owner's choice a normal edit. Status reports `conflicts`.
- Limits (documented in `docs/CLOUD.md`): the cloud keeps only the winner. A displaced acknowledged value is recorded only when the displacing write is seen at the same revision during a pull. Conflict copies exist only on the losing device.
- Regression tests: `first sync on two devices with different recipe notes keeps the losing value as a conflict`, `first sync with different preferences on two devices keeps the losing value as a conflict` (singleton `preferences`), `keeps the displaced version of a concurrent same-record edit instead of dropping it`, `converges delete-versus-edit on the same revision and keeps the displaced side`, `converges concurrent rating/favourite/notes edits ... one winner on both devices`, plus the transport test `keeps a displaced local value for the owner to restore`.
- Decision needed (lead): the server-side fix (retain displaced versions in a user-owned table, or require a base revision in the RPC) needs a new migration. It is not implemented, and the reasons are above.
- Status: FIXED-VERIFIED (local tests); server-side retention is DECISION.

## SYNC-3: A stale untrimmed local row overwrote a newer remote change
- Severity: P1
- Module / file: `src/cloud/core.ts` `finishReceipt`, `keepDisplacedValue` (comparison of raw rows against validated fingerprints).
- Reproduction: a legacy pantry row with `name: "Flour "`. zod's `trim()` makes the fingerprint `"Flour"`, while the stored raw row still has the space, so the row looked edited forever. A newer remote value ("Bread flour") from another device was skipped locally and then the stale value was pushed over it on the next pass.
- Evidence: test `does not let a stale untrimmed local copy overwrite a newer remote change` failed before the fix (`expected 'Flour ' to be 'Bread flour'`) and passes after.
- Fix: local rows are compared in their validated form (`validatedLocal`).
- Status: FIXED-VERIFIED

## SYNC-4: One invalid local row stopped all sync
- Severity: P1
- Module / file: `src/cloud/core.ts` `scanLocal` (used `parse` over every row).
- Root cause: a single row failing the strict schema threw inside the scan, so `run()` never got past it. Had the row been treated as absent, the next pass would have sent a tombstone and deleted the cloud copy.
- Fix: invalid local rows are skipped and never tombstoned. They are counted in `rejected`, and they stay on the device.
- Regression test: `keeps an invalid legacy row locally, never tombstones it, and still syncs the valid records`
- Status: FIXED-VERIFIED

## SYNC-5: One unreadable remote row aborted every pull
- Severity: P2
- Module / file: `src/cloud/supabase.ts` `readAll` (validation error thrown for the whole page).
- Root cause: a row from a newer app version, or a corrupted row, failed `validateWire` and the pass failed on every retry.
- Fix: the row is skipped, counted via `unreadableCount()`, and reported in `rejected`. The row stays in the cloud untouched. A row that belongs to another account still stops the pass (see SYNC-9).
- Regression test: `skips one invalid remote row, counts it, and still applies the rest`
- Status: FIXED-VERIFIED

## SYNC-6: Expired sessions were retried forever with a misleading message
- Severity: P2
- Module / file: `src/cloud/index.ts` `syncNow` and `authenticatedSession`; `src/cloud/supabase.ts` (no classification of PostgREST JWT errors).
- Root cause: an expired or revoked session produced "Cloud write failed: JWT expired" and was retried every 5 minutes with no end.
- Fix: `postgrestErrorKind` maps PGRST301/302, "Authentication required" and JWT messages to `auth`. An auth failure stops automatic retries, sets `enabled: false` and asks the owner to sign in and enable sync again. The queue is kept.
- Regression tests: `turns an expired JWT into an auth failure rather than a retryable write`, `surfaces an auth failure immediately so the caller can stop instead of retrying`, `stops the read when the signed-in account changes between pages`.
- Status: FIXED-VERIFIED (mapping is by code and message; the PGRST code list should be confirmed against the live project, see Unverified).

## SYNC-7: Mixed-case operation IDs could disagree with Postgres ordering
- Severity: P3
- Module / file: `src/cloud/core.ts` `validateWire`.
- Root cause: Postgres compares uuids case-insensitively as bytes, while `compareVersion` compares strings. The mismatch only shows with input that is not lower-case.
- Fix: operation IDs are lower-cased on validation.
- Regression test: `normalises upper-case operation IDs so the local tie-break matches the server's uuid ordering`
- Status: FIXED-VERIFIED

## SYNC-8: UI cannot tell "saved locally", "waiting", "failed" and "conflict" apart
- Severity: P2
- Module / file: `src/components/CloudSettings.tsx` (the status paragraph and its copy; UI, lead-owned); `src/cloud/index.ts` (state source).
- Current behaviour: the UI shows `status.message` and "N queued records" in every phase, and it has no state label, no rejected count and no conflict list. `phase: 'ready'` while another tab syncs is shown as synced when nothing is queued.
- Fix (backend side, done): `syncDisplayState(status)` returns `saved-locally | waiting | syncing | synced | failed | conflict`. `CloudStatus` gained `rejected` and `conflicts`. `listCloudConflicts` and `resolveCloudConflict` are exported.
- Status: NEEDS-OWNER (lead). See the diff below.

## SYNC-9: Cross-account and foreign-row guard
- Severity: n/a, audited and held
- The migration and adapter were already sound. The fix keeps the existing behaviour and changes only its classification: a foreign row (`user_id` mismatch) stops the pass as `auth`, and it is never applied. `tests/unit/backend-sync-transport.test.ts` `refuses rows that belong to another account even when the server ignores the owner filter`.
- Status: VERIFIED (no change to behaviour)

## SYNC-10: Retry delays and backoff bounds
- Severity: n/a, audited
- The original `Math.min(300000, 30000 * 2 ** Math.min(failures, 4))` was correct. It is extracted to `retryDelay` and tested for the bound (300,000 ms maximum).
- Status: VERIFIED

## SYNC-11: Deletion and tombstone retention
- Severity: n/a, audited with a DECISION
- Tombstones persist remotely, and a stale write cannot resurrect a deleted record (`never resurrects a tombstone with a stale revision`, PGlite). A concurrent edit at the same revision is not stale; the UUID tie-break decides whether it resurrects the record, and the displaced side is kept (SYNC-2). This is the documented convergence.
- Status: DECISION (confirmed by the lead: the losing side is kept as a conflict)

## SYNC-12: Migration RLS and RPC: no defect found, precondition documented
- Severity: P3 (precondition)
- Module / file: `supabase/migrations/202610110001_airfuel_sync.sql` (not edited).
- What was checked in PGlite, against the real migration file: anonymous denial on the table and RPC; authenticated denial of direct INSERT, UPDATE and DELETE; cross-user isolation on select, update, delete and guessed IDs; the RPC has no owner argument, and an extra argument is rejected; revision ordering, UUID tie-break and tombstone non-resurrection; all constraints (entity, record ID length, revision range, payload id match, tombstone shape, payload type and 512 KiB bound); `SECURITY DEFINER` with `search_path=""`, with no `public` or `anon` execute; a caller-controlled `search_path` cannot redirect the RPC to a shadowing table or `uid()`.
- Precondition found: the function and table owner must bypass RLS (Supabase's `postgres` role does). If owned by a `NOBYPASSRLS` role, every write fails closed with 42501, which the client now marks permanent. Test: `documents the owner precondition...`. Recommended hardening, as a new migration: a `do $$` check that raises if the owner lacks `rolbypassrls`.
- Fix: NEW migration `supabase/migrations/202610110002_airfuel_sync_guard.sql` raises `42501` (message names BYPASSRLS) unless the table and function owners are superuser or BYPASSRLS. Tested in PGlite: passes for the superuser owner and a non-superuser BYPASSRLS owner; fails for a NOBYPASSRLS owner (`tests/unit/backend-sync-rls.test.ts`, 'sync guard migration').
- Status: FIXED-VERIFIED (PGlite only; the guard's attribute check is not run against a live Supabase project)

## SYNC-13: Valid custom recipes can exceed the server's 512 KiB payload bound
- Severity: P2
- Module / file: `supabase/migrations` constraint `bounded_payload`; `src/lib/schema.ts` `recipeSchema` (steps up to 100 × 10,000 characters, plus other text fields, so about 1 MB).
- Effect: a valid local custom recipe can be permanently rejected by the server. SYNC-1 now makes it visible and non-blocking, but it still does not sync.
- Fix options: raise the constraint in a NEW migration, or limit the schema. Both change shared data limits, so this is a lead decision.
- Decision (lead): keep the 512 KiB bound, no migration. Documented in docs/CLOUD.md and src/cloud/API.md; the record shows as rejected and stays local.
- Status: DECISION (kept; documented)

## SYNC-14: "Another tab is syncing" reports as synced
- Severity: P3
- Module / file: `src/cloud/index.ts` `syncNow` lock-not-acquired branch.
- Effect: `phase: 'ready'` with no queued changes displays as synced while another tab is mid-pass.
- Status: OPEN (P3, low impact; a `busy` phase would fix it)

## Functions audited and disposition

| Function | Disposition |
|---|---|
| `validateWire` | Fixed (SYNC-7), otherwise unchanged. |
| `stableStringify`, `compareVersion` | Verified. |
| `SyncDB` | Version 2 adds `conflicts`. Upgrade from a real version-1 database is NOT tested; the change is additive (a new table), but add a v1 fixture if the lead wants it proven. |
| `SyncEngine.bind`, `pendingCount` | Verified; `pendingCount` now excludes blocked records. |
| `rejectedCount`, `conflictCount`, `listConflicts`, `resolveConflict` | New (SYNC-2, SYNC-1). |
| `recoverReceipts`, `finishReceipt` | Fixed (SYNC-3). |
| `scanLocal` | Fixed (SYNC-4). |
| `keepDisplacedValue` | New (SYNC-2). |
| `acceptRemote` | Calls `keepDisplacedValue` before the write-ahead receipt. Ordering checked. |
| `run` | Fixed (SYNC-1, SYNC-5). |
| `classifySyncError`, `retryDelay`, `SyncError` | New; tested. |
| `parseCloudConfig`, `createCloudClient` | Verified by the existing suite. Unchanged. |
| `remoteRecord` | Foreign-row case now `auth` (SYNC-9). |
| `postgrestErrorKind` | New (SYNC-6). |
| `createSupabaseAdapter.apply` | Classified errors (SYNC-6). |
| `createSupabaseAdapter.readAll` | Skips unreadable rows (SYNC-5). Pagination verified (1,201 rows, 3 pages, owner filter on each request, row-limit check, account change mid-read). |
| `configuration`, `cloudConfigured`, `useCloudStatus`, `update` | Verified; unchanged. |
| `getClient`, `onAuthStateChange` guard | Verified; unchanged. |
| `authenticatedSession` | Auth errors classified (SYNC-6). |
| `signIn`, `signOut` | Verified; unchanged. |
| `enableSync` | Verified; unchanged. |
| `schedule`, `stopLoop`, `onlineRetry` | Uses `retryDelay` (SYNC-10). |
| `syncNow` | Auth stop, counts, messages (SYNC-6, SYNC-8, SYNC-14). |
| `forgetCloudCache` | Also clears `conflicts`. Tested. |
| `syncDisplayState`, `listCloudConflicts`, `resolveCloudConflict` | New (SYNC-8). |

## Needs other owner

### Lead: `src/components/CloudSettings.tsx` (UI state and copy)
1. Show the state label from `syncDisplayState(status)`: "Saved on this device", "Waiting to sync", "Syncing", "Synced", "Needs attention" (failed), "Conflict: choose a version". Import `syncDisplayState` from `../cloud`.
2. Replace the `{status.pending} queued records.` line. Show `status.pending` queued, `status.rejected` could not sync (kept on this device), and `status.conflicts` to review.
3. Add a conflict list that calls `listCloudConflicts()`. Each row shows the entity and record, the local and cloud values, and two buttons: keep this device's value (`resolveCloudConflict(key, 'local')`) and use the cloud value (`resolveCloudConflict(key, 'remote')`).
4. Replace the copy in the first paragraph ("Conflicting changes use whole-record revision ordering, so edits to the same record can supersede each other") with: "When two devices change the same record, the cloud keeps one version and this device keeps the other as a conflict for you to choose. Deletions are kept so old devices cannot undo them."

### Lead: `supabase/migrations` (new migrations only, do not edit the applied one)
- SYNC-12: done in migration 202610110002 (guard). Nothing further needed.
- SYNC-13: decided by the lead, keep the 512 KiB bound. Documented; no migration.
- LOGIC-10 server retention (optional): retain displaced versions server-side. Not required for the client fix.

### Lead: `vite.config.ts`
- `test.include` is `tests/unit/**/*.test.ts`, so `tests/db/*` never runs. The PGlite suite is in `tests/unit` for this reason.

### Engine owner (not mine): observed failure
- `tests/unit/backend-engine-scenarios.test.ts` "lowers a favourite cooked yesterday, and restores it later" fails when run in isolation (expected 35 to be close to 25). It imports nothing from `src/cloud`, so it is not caused by this change. The full run also showed timeouts in two other engine tests under load.

## Unverified (not run)
- No live Supabase project, so GoTrue refresh and sign-out, PostgREST JWT error codes (PGRST301/302 mapping), the 500-row API limit, and two-device behaviour over a real network are all unverified.
- Browser behaviour of `navigator.locks` and the 30-second timer was not exercised. `index.ts` is tested only through its pure `syncDisplayState` function and `forgetCloudCache`.
- Crash-kill around write acknowledgement was tested only through the existing `recovers a crash after receipt persistence` test, not with a real process kill.

## Inventory follow-up (ARCH items from docs/backend/findings/inventory.md)

### ARCH-2 (P1): clearing the sync cache overwrote a newer offline edit
- Reproduction (test `ARCH-2: clearing the sync cache must not overwrite a newer offline edit`): device 2 synced to server revision 2, edited offline to v3, then the baselines were cleared. Its re-sync put v3 at revision 1, lost to the server's revision 2, and v3 disappeared from the record.
- Root cause: change detection depends on baselines. With none, a local edit has no revision above the server's.
- Fix (option 3 from the inventory): `forgetSyncBaselines` (core) clears only the baselines and outbox. Local rows are never removed, so the next pass re-derives every local edit as a dirty value. A clash with the cloud is recorded as a conflict (existing LOGIC-10 path). The forget is refused while conflicts are unresolved, so no conflict copy can be discarded.
- Tests: the two ARCH-2 tests in `backend-sync-engine.test.ts` (kept as a conflict; a non-clearing control keeps v3 as revision 3) and the refusal test.
- Status: FIXED-VERIFIED (local tests). Settings copy must say "unresolved conflicts block this" (NEEDS-OWNER, cloudui/lead).

### ARCH-5 (P1 latent): FORCE ROW LEVEL SECURITY made the RPC fail for an owner without BYPASSRLS
- Decision (lead): remove FORCE instead of requiring BYPASSRLS. My SYNC-12 guard is dropped. Migration `supabase/migrations/202610110002_airfuel_sync_no_force_rls.sql` runs `alter table public.airfuel_user_records no force row level security`. The guard file I had created was removed (it had never been applied).
- Proof (PGlite, `backend-sync-rls.test.ts`): the whole RLS suite (27 tests) now runs as an owner with `NOBYPASSRLS`, and every anon, cross-user and direct-write denial still passes. A test shows FORCE alone refuses the RPC's insert with 42501; after the migration the same insert succeeds.
- Precondition found while proving it: the owner needs `USAGE` on schema `auth` and `REFERENCES` on `auth.users` (the RPC calls `auth.uid()`, and the table has a foreign key). Supabase's `postgres` role has both. Documented in the test setup.
- Status: FIXED-VERIFIED (PGlite). Not applied to any live project.

### ARCH-23 (P1): permanently rejected records never retried; RLS denial counted as permanent
- Fix: SQLSTATE `42501` is now a `config` error (`postgrestErrorKind`). A config error stops the pass, keeps the queue and retries with backoff. It never marks records rejected. A user-facing `retryRejectedCloudRecords()` re-queues records that the server refused. Values are kept.
- Tests: `classifies a row-level-security or grant denial (42501) as a config error that keeps the queue`, `retryRejected re-queues permanently rejected records after the cause is fixed`, `retryRejected does nothing when no record is rejected`, and the controller tests for the config message and `retryRejectedCloudRecords`.
- Status: FIXED-VERIFIED (local tests)

### ARCH-7 (P2): false "account changed in another tab" after sign-out and sign-in
- Verified by code reading and fixed. `enabledUserId` was never cleared on `SIGNED_OUT`, and the account check did not depend on sync being enabled. Now `SIGNED_OUT` clears it, and the check runs only while sync is enabled. Protection while enabled is kept.
- Tests: `signing in as another account after sign-out does not show the account-changed error` and `still stops sync when a different account signs in while sync is enabled` (`backend-sync-controller.test.ts`). The first test was not run against the pre-fix code.
- Status: FIXED-VERIFIED (local tests, mocked listener)

### ARCH-19 (P2): cloud orchestration untested
- Agreed. `src/cloud/index.ts` is now a thin wrapper over `createCloudController` (`src/cloud/controller.ts`), which takes its database, client factory, Web Locks, online state and online listener as options. The exported names and signatures are unchanged.
- Covered: enable without Web Locks, sync before enable, offline scheduling with no network calls, cache-clear refusal rules, configuration error handling, expired session, ARCH-7.
- Test file: `tests/unit/backend-sync-controller.test.ts` (9 tests). The inventory suggested the name `backend-cloud-controller.test.ts`; I kept the `backend-sync-` prefix from the brief.
- Status: FIXED-VERIFIED (local tests)

### ARCH-21 (P3): `enableSync` builds a discarded engine
- Not a defect: the candidate engine becomes the active `engine` on success. It is kept as is.
- Status: WONT-FIX (no defect)

## New public API (for cloudui)
- `retryRejectedCloudRecords(): Promise<number>`: re-queues rejected records; returns how many. Refused while a pass runs. Updates `status.rejected` and `status.pending`.
- `syncDisplayState(status)`, `listCloudConflicts()`, `resolveCloudConflict(key, side)`: unchanged.
- `forgetCloudCache()`: now refused while conflicts are unresolved; no longer discards unsent local values.
- `CloudStatus`: unchanged shape. A `config` error shows phase `error` with setup guidance, and `enabled` stays true.
- `SyncErrorKind` now includes `"config"` (internal to core; not used by the UI).
