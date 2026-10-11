# Optional cloud API

Import from `src/cloud/index.ts`. Config env: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` (legacy `VITE_SUPABASE_ANON_KEY` accepted). Never service-role/secret keys. Install `@supabase/supabase-js` and manually apply `supabase/migrations/202610110001_airfuel_sync.sql` and then `202610110002_airfuel_sync_no_force_rls.sql` and `202610110003_airfuel_sync_quota.sql` and `202610110004_airfuel_sync_byte_quota.sql` and `202610110005_airfuel_sync_row_bytes.sql` and `202610110006_airfuel_sync_accounting_hardening.sql` before use.

`cloudConfigured(): boolean`: true only for valid HTTPS project URL and public key format. No network at import or configuration check.

`useCloudStatus(): CloudStatus` returns `{phase:'unconfigured'|'signed-out'|'ready'|'syncing'|'offline'|'error', email:string|null, enabled:boolean, pending:number, rejected:number, conflicts:number, lastSyncedAt:number|null, message:string}`.

- `pending`: queued changes that will be sent on a later pass (excludes rejected ones).
- `rejected`: changes the server permanently refused, plus remote rows this app version cannot read and local rows that fail validation. Local copies are kept. A rejected change is not retried until the record is edited again. The main cases are a payload over the server's 512 KiB bound, which a very long custom recipe can reach, a new record refused by the row quota (224,006 rows including deleted records), and a write that would take the account past 64 MiB of stored bytes (the larger of the payload's text and binary sizes, plus an estimate of the id column, index and row overhead). A payload whose binary form exceeds 512 KiB is refused too. Each is refused for that record only, and the status message shows the reason.
- `conflicts`: values displaced by a same-record conflict and kept on this device.

`syncDisplayState(status): 'saved-locally'|'waiting'|'syncing'|'synced'|'failed'|'conflict'` is the state the owner should see. Priority: `failed` (phase error or any rejected item), then `conflict`, then `saved-locally` (sync off, or offline), then `syncing`, then `waiting` (queued changes), otherwise `synced`.

`signIn(email,password):Promise<void>`: existing account email/password login, explicit action. Does not upload any data. SDK stores session locally; no password is stored by this app.

`enableSync():Promise<void>`: explicit user consent to upload all local user data and download their remote data. Binds this browser's local data to this one Supabase project/account; changing accounts is blocked to prevent account mixing. Starts current-tab automatic 30-second sync plus bounded exponential retries after transient failures (30s, 60s, 120s, 240s, then 5 minutes) and an online-event retry.

`syncNow():Promise<void>`: only works after enable; updates status, retains pending operations after failures, throws a readable error for UI. Offline edits/deletes are discovered against persisted baselines on next sync.

- Transient failures (network, timeout, server) keep everything queued and retry with backoff.
- Permanent failures (constraint or payload rejections, validation) mark only that record as rejected. Other records still sync. Use `retryRejectedCloudRecords()` after the cause is fixed to re-queue them.
- Configuration failures (SQLSTATE 42501: permission or row-level-security denial) stop the pass with a message about the project's sync setup. Nothing is marked rejected, the queue is kept, and sync retries with the same backoff.
- Auth failures (expired or revoked session) stop automatic retries, set `enabled` to false and ask the owner to sign in and enable sync again. Queued changes are kept.

`listCloudConflicts(): Promise<ConflictRecord[]>` lists displaced values. Each has `key`, `entity`, `recordId`, `local` (this device's value, null if deleted), `remote` (the cloud value, null if deleted), `remoteRevision`, `remoteOperationId` and `createdAt`. Types are exported from `index.ts`: `ConflictRecord` (`unknown` payloads) and `Entity`.

`resolveCloudConflict(key, 'local' | 'remote'): Promise<void>`: keeps the chosen value as a normal local edit (it syncs on the next pass) and removes the conflict. Refused while a pass is running.

`retryRejectedCloudRecords(): Promise<number>` re-queues every record marked rejected and returns how many were re-queued. Values are kept. Refused while a pass runs.

`deleteLocalCloudState():Promise<void>`: delete-all flow only. After sign-out, removes every sync record on this device: baselines, outbox, unresolved conflict copies and the account binding. Unlike `forgetCloudCache`, it does not refuse for unresolved conflicts, because those are personal data the owner is deleting. Remote data are untouched. Refused while sync is enabled or a pass is running.

`signOut():Promise<void>`: stops automatic retries, signs out of local SDK session. Keeps local recipes and account binding, preventing accidental upload to another user. Sign-out is blocked while sync is running; try again when complete. Data remain on the device.

Settings copy (to update in `CloudSettings.tsx`): "Sync sends personal notes, preferences and cooking activity to your configured Supabase project. When two devices change the same record, one version is kept on the server and the other is kept on the device that lost, shown as a conflict for you to choose. Deletions are kept so they are not undone by old devices. Sync is not live-tested against a Supabase project in this build."

`forgetCloudCache():Promise<void>`: after sign-out, clears the sync baselines and outbox (which duplicate personal content) and keeps the non-content account binding. Local values are never removed. Unsynced local edits are re-derived on the next pass; if one conflicts with the cloud it is kept as a conflict, never silently overwritten. It is refused while sync is enabled, while a pass runs, and while conflicts are unresolved (resolve them or export a backup first). Call alongside `actions.clearUserData()` for a complete device-content reset.
