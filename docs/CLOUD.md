# Optional authenticated cloud sync

Status: implemented, opt-in, unconfigured. Mock-adapter queue/conflict tests and static SQL boundary checks run locally. No Supabase project has been contacted, no migration has been executed against a server, and live authentication/RLS/two-device isolation remain untested. Device-only functionality does not depend on this integration.

## Setup by the project owner

1. Export your local data before enabling sync.
2. Use a Supabase project you control. Apply `supabase/migrations/202610110001_airfuel_sync.sql` using an administrator migration connection or the SQL editor. Do not run it against an unrelated existing application.
3. Enable email/password authentication and create/confirm your account through your administrative or existing account-registration process. This app provides sign-in; it does not send signup or password-reset emails.
4. Configure the build environment with `VITE_SUPABASE_URL=https://YOUR-PROJECT.supabase.co` and `VITE_SUPABASE_PUBLISHABLE_KEY=YOUR-PUBLIC-PUBLISHABLE-KEY`. Legacy `VITE_SUPABASE_ANON_KEY` with the `anon` role is accepted. Never use a service-role JWT or `sb_secret_` key. These Vite variables are intentionally public.
5. Rebuild, open Settings, sign in, then explicitly enable sync. This uploads user preferences, notes, activity, custom recipes and planning data to your configured project. Canonical recipe content is not uploaded unless a user-owned override contains it.
6. Verify the live checks below before treating cloud sync as production-qualified.

There are no cloud requests on module import or configuration inspection. Client construction happens only during an explicit sign-in/enable action. Automatic refresh is disabled; an enabled sync pass refreshes and verifies its session as needed. Enable consent is in memory, so after reloading the user must enable again. The persisted auth session can be reused by Enable. Sign-out stops retries but leaves device data and its account binding intact. Use a separate browser profile for a different cloud account; this prevents accidentally uploading one person's local kitchen to another account.

## Data and conflict semantics

The local cooking database stays independent. A second IndexedDB database stores sync baselines, a durable outbox and write-ahead receipts. Changes made offline, while sync is disabled, or while the app is closed are detected against the baseline on the next pass. Deletes become durable tombstones and are retained remotely indefinitely. Do not manually purge them while older devices may reconnect.

Each user record has a Lamport revision and a unique operation UUID. A local edit increments the latest observed revision. PostgreSQL atomically chooses the lexicographically greatest `(revision, operation_id)` pair. This is deterministic and does not depend on device wall clocks. Concurrent changes to the same record resolve as a whole record; it is not a field-by-field collaborative editor. A higher revision wins, and a UUID breaks concurrent equal revisions. Separate cooking-session IDs are never regenerated during sync, so identical retries do not duplicate journal entries.

A pass records local changes, retries pending writes, reads remote records, applies newer records, then records edits made during network calls for the following pass. Before applying remote data it compares the current local payload with the captured baseline within a local transaction. Edits made while a request is in flight are retained. Write-ahead receipts make a crash between the local database write and sync-metadata update recoverable.

Reads use sorted pagination and repeat complete reads each pass. A concurrent insertion during pagination can delay its appearance until the next pass; there is no claim of a transactionally consistent global cloud snapshot. Limits are 200,000 remote records, 500 rows per page and 512 KiB per server payload. Configure the Supabase API row limit to at least 500. Every received payload is validated against the local per-entity schema before application.

Current-tab background passes run every 30 seconds after explicit enable, with exponential retry delays capped at 5 minutes and an online-event retry. Individual fetches time out after 20 seconds. Pending operations stay in IndexedDB after failures or lost acknowledgements. Web Locks serialize cloud passes across tabs; unsupported browsers keep the local app usable but cannot enable sync. This is foreground browser sync, not background operating-system sync.

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

For a complete device-content reset after signing out, clear both the local kitchen data and `forgetCloudCache()`. Sync baselines/outbox can duplicate personal notes until this cache is cleared. The helper retains only the non-content account binding and does not delete remote data; enabling later can download remote records again. It discards unsent changes, so back up first.
