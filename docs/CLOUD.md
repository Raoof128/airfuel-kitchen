# Optional authenticated cloud sync

Status: implemented, opt-in, unconfigured. Local tests cover the client engine (fake transport), the Supabase adapter contract (fake PostgREST client) and the migration's SQL boundary in PGlite (Postgres compiled to WASM, real migration file, synthetic users). No Supabase project has been contacted. PGlite does not run PostgREST or GoTrue, so JWT verification, refresh, sign-out, API row limits and two-device behaviour on real infrastructure remain untested. Device-only functionality does not depend on this integration.

Local test files: `tests/unit/backend-sync-rls.test.ts` (database boundary, run as an owner without BYPASSRLS; the suite lives in `tests/unit` because `vite.config.ts` only includes that folder), `tests/unit/backend-sync-engine.test.ts` (queue, retries, conflicts, cache clear), `tests/unit/backend-sync-transport.test.ts` (adapter mapping, pagination, status states), `tests/unit/backend-sync-controller.test.ts` (sign-in, account change, enable, offline, configuration errors). The original `tests/unit/cloud.test.ts` still runs too.

## Setup by the project owner

1. Export your local data before enabling sync.
2. Use a Supabase project you control. Apply `supabase/migrations/202610110001_airfuel_sync.sql`, then `supabase/migrations/202610110002_airfuel_sync_no_force_rls.sql`, then `supabase/migrations/202610110003_airfuel_sync_quota.sql`, then `supabase/migrations/202610110004_airfuel_sync_byte_quota.sql`, then `supabase/migrations/202610110005_airfuel_sync_row_bytes.sql`, then `supabase/migrations/202610110006_airfuel_sync_accounting_hardening.sql`, using an administrator migration connection or the SQL editor. Do not run them against an unrelated existing application. The second migration removes `FORCE ROW LEVEL SECURITY` from the sync table. The only writer is the security-definer RPC, which the table owner runs. Client roles stay fully subject to RLS. With FORCE, the owner's RPC insert was refused for any owner without BYPASSRLS, so every write failed.
3. Enable email/password authentication and create/confirm your account through your administrative or existing account-registration process. This app provides sign-in; it does not send signup or password-reset emails.
4. Configure the build environment with `VITE_SUPABASE_URL=https://YOUR-PROJECT.supabase.co` and `VITE_SUPABASE_PUBLISHABLE_KEY=YOUR-PUBLIC-PUBLISHABLE-KEY`. Legacy `VITE_SUPABASE_ANON_KEY` with the `anon` role is accepted. Never use a service-role JWT or `sb_secret_` key. These Vite variables are intentionally public.
5. Rebuild, open Settings, sign in, then explicitly enable sync. This uploads user preferences, notes, activity, custom recipes and planning data to your configured project. Canonical recipe content is not uploaded unless a user-owned override contains it.
6. Verify the live checks below before treating cloud sync as production-qualified.

There are no cloud requests on module import or configuration inspection. Client construction happens only during an explicit sign-in/enable action. Automatic refresh is disabled; an enabled sync pass refreshes and verifies its session as needed. Enable consent is in memory, so after reloading the user must enable again. The persisted auth session can be reused by Enable. Sign-out stops retries but leaves device data and its account binding intact. Use a separate browser profile for a different cloud account; this prevents accidentally uploading one person's local kitchen to another account.

## Data and conflict semantics

The local cooking database stays independent. A second IndexedDB database stores sync baselines, a durable outbox and write-ahead receipts. Changes made offline, while sync is disabled, or while the app is closed are detected against the baseline on the next pass. Deletes become durable tombstones and are retained remotely indefinitely. Do not manually purge them while older devices may reconnect.

Each user record has a Lamport revision and a unique operation UUID. A local edit increments the latest observed revision. PostgreSQL atomically chooses the lexicographically greatest `(revision, operation_id)` pair. This is deterministic and does not depend on device wall clocks. Concurrent changes to the same record resolve as a whole record; it is not a field-by-field collaborative editor. A higher revision wins, and a UUID breaks concurrent equal revisions. Operation IDs are normalised to lower case so the client tie-break matches Postgres uuid ordering. Separate cooking-session IDs are never regenerated during sync, so identical retries do not duplicate journal entries.

**Displaced values are kept (LOGIC-10).** The server keeps only the winner. When this device had an unacknowledged or unsynced value that differs from the winner, that value is written to the `conflicts` table in the sync database before the winner is applied. The same applies when an already-acknowledged value is displaced by a write at the same revision from another device. Nothing is overwritten silently. The owner chooses with `resolveCloudConflict`; the choice becomes a normal edit. Limits: a displaced acknowledged value is recorded only when the displacing write is seen at the same revision during a pull. If the record moves on again before this device pulls, that intermediate value is not recorded. Keeping displaced values on the server needs a new migration and is not implemented. Conflict copies live only on the losing device, so clearing its browser data loses them.

**Account quotas (SEC-9).** Each account may hold 224,006 sync rows, counting deleted records. Its stored bytes may total 64 MiB (67,108,864), where each row is charged an estimate of its physical size: the larger of the payload's text bytes and its binary (stored) size, plus twice the record ID (the column copy and the index entry), plus 128 bytes of overhead (migrations 0005 and 0006). Jsonb is stored in binary form, and dense structures such as long arrays are several times larger in binary than in text, so the binary size is measured too. A second bound refuses any payload whose binary form exceeds 512 KiB (`bounded_binary_payload`), in addition to the text bound. Migration 0006 also locks both tables before it recomputes the counters, so the recompute cannot interleave with writes. Its lock order (quota first, then records) matches the RPC's, which avoids a deadlock. The byte cap guards against 512 KiB payloads multiplied by the row cap. Measured with 300-character IDs, physical storage is within 1.2 times the charged amount. Both limits are enforced in the security-definer RPC under a row lock on the account's quota row. A write that would exceed a limit is refused with SQLSTATE 53400 and a clear message. Only that record is rejected, and the reason appears in the status message. Deletes, tombstones and shrinking updates free bytes. A stale or duplicate write changes nothing.

**Payload bound (decision: 512 KiB kept).** The server refuses a record payload above 524,288 bytes (`bounded_payload`). The schema allows a custom recipe of up to roughly 1 MB, so a very long custom recipe can exceed the bound. Such a record is refused with a permanent error. It stays on this device, shows as `failed` ("could not be synced") and does not sync. Raising the bound would need a new migration; this build keeps it.

**Deletion versus edit (decision confirmed).** A delete and an edit of the same record at the same revision are resolved by UUID. The losing side, whether the edit or the delete, is kept as a conflict on its device. It is never silently lost.

**Failures are classified.** Transient failures (network, timeout, server) stop the pass and retry with backoff. Nothing is pulled over unsent work. Permanent failures (constraint, row-level-security and payload rejections, and local rows that fail validation) mark only that record as rejected. It keeps its local value and is not retried until the record changes. Auth failures (expired or revoked session) stop automatic retries until the owner signs in and enables sync again. A remote row that fails validation is skipped and counted, so it cannot stall the rest. Local rows that fail validation are never uploaded and never treated as deleted.

A pass records local changes, retries pending writes, reads remote records, applies newer records, then records edits made during network calls for the following pass. Before applying remote data it compares the current local payload with the captured baseline within a local transaction. Edits made while a request is in flight are retained. Write-ahead receipts make a crash between the local database write and sync-metadata update recoverable.

Reads use sorted pagination and repeat complete reads each pass. A concurrent insertion during pagination can delay its appearance until the next pass; there is no claim of a transactionally consistent global cloud snapshot. Limits are 200,000 remote records, 500 rows per page and 512 KiB per server payload. Configure the Supabase API row limit to at least 500. Every received payload is validated against the local per-entity schema before application.

Current-tab background passes run every 30 seconds after explicit enable. Retry delays after transient failures are 30s, 60s, 120s, 240s and then 5 minutes, with an online-event retry. Individual fetches time out after 20 seconds. Pending operations stay in IndexedDB after failures or lost acknowledgements. Web Locks serialize cloud passes across tabs; unsupported browsers keep the local app usable but cannot enable sync. This is foreground browser sync, not background operating-system sync.

Local reset and backup replacement are local operations. Once sync is enabled, deletions of previously tracked rows propagate as tombstones. An unseen remote row can still download after a local backup replacement. Export first and sign out before performing a device-only recovery if you do not want it to propagate. Clearing all browser storage also clears account binding and unsent changes; export remains necessary.

## Security model

`airfuel_user_records` has forced RLS and grants authenticated users SELECT only when `auth.uid()` matches `user_id`. Direct table writes are not granted to browser roles. The single write RPC is SECURITY DEFINER with an empty fixed search path. It derives ownership solely from `auth.uid()`, accepts no owner argument, rejects unauthenticated calls, writes only under that owner and returns only that owner's row. Table constraints limit entities, IDs, revisions, payload size and tombstone shape. Public/anonymous execution is revoked.

Every sync pass verifies its exact access token using the Auth server, then pins all data requests to that token. Another tab changing accounts cannot redirect an in-flight write into the other account. The adapter also checks returned ownership and stops further operations after account changes. A request already accepted by the server cannot be recalled by signing out.

Auth sessions contain bearer tokens and are stored by the Supabase SDK in browser storage under a project-specific key. The app never stores the password itself. XSS or a compromised browser profile can access local notes and session tokens; keep script dependencies and deployment headers maintained. No privileged key belongs in the frontend, database backup or repository. TLS protects transit; no end-to-end encryption claim is made.

## Required live qualification

- Run migration on a disposable project and prove anonymous access is denied.
- Create users A/B; test SELECT with/without filters, guessed IDs, cross-owner requests and RPC attempts. Prove A cannot read or mutate B's records.
- Prove direct INSERT/UPDATE/DELETE are denied to authenticated clients.
- Test signup provisioning, confirmed-account sign-in, expired tokens, refresh, sign-out and an account change in another tab.
- Confirm the browser-side status mapping (`syncDisplayState`) with a real account: saved locally, waiting, syncing, synced, failed and conflict.
- Run two physical browser/device profiles offline, make conflicting edits and delete a journal entry, reconnect in both orders, and verify convergence and deletion retention.
- Kill the browser around write acknowledgements and receipt application, then reopen and retry.
- Exercise pagination with more than 500 rows, server timeouts, row-limit configuration and quota failures.
- Document actual cloud evidence separately from local mocks. Do not mark these checks passed until executed against the configured project.

## Official documentation consulted

- [Supabase password authentication](https://supabase.com/docs/guides/auth/passwords)
- [Supabase Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Supabase JavaScript client initialization](https://supabase.com/docs/reference/javascript/initializing)
- [Supabase JWT access-token configuration](https://supabase.com/docs/guides/auth/jwts)
- [Dexie transaction semantics](https://dexie.org/docs/Dexie/Dexie.transaction())

For a complete device-content reset after signing out, clear both the local kitchen data and `forgetCloudCache()`. Sync baselines/outbox can duplicate personal notes until this cache is cleared. The helper retains only the non-content account binding and does not delete remote data; enabling later can download remote records again. It does not discard local values: unsent edits are re-queued on the next pass, and any that conflict with the cloud are kept as conflicts. It is refused while conflicts are unresolved. Back up before a device reset anyway.

## Deployment hardening

Some abuse cannot be fixed inside the database. Each account has its own quota, but one person can create many accounts. The following must be configured where the project is hosted.

- **Email confirmation.** Require confirmed email before an account can sign in or enable sync, so one person cannot create many accounts without a mailbox each.
- **Sign-up rate limits and CAPTCHA.** Limit sign-ups per IP address and per time window, and add CAPTCHA to sign-up. Quotas are per account, so multi-account exhaustion is an operator control.
- **API request-body limits and statement timeout.** The RPC parses the JSON payload before the database checks its size. Set the platform's request-body limit a little above 512 KiB, so oversized requests are refused before parsing. Set a `statement_timeout` for the `authenticated` role (for example `alter role authenticated set statement_timeout = '5s'`), so a slow write cannot hold a quota lock for long.
- **Hosting headers.** Serve the production headers from `docs/backend/SECURITY_AUDIT.md` ("Header set for SEC-10"), including `frame-ancestors`, which cannot be set from a meta tag. Set HSTS on the host.
- **Keys.** Only the publishable key ships to the browser. Keep the service-role key out of the build, the repository and the backups.

