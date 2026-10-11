# Optional cloud API

Import from `src/cloud/index.ts`. Config env: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` (legacy `VITE_SUPABASE_ANON_KEY` accepted). Never service-role/secret keys. Install `@supabase/supabase-js` and manually apply SQL migration before use.

`cloudConfigured(): boolean`: true only for valid HTTPS project URL and public key format. No network at import or configuration check.

`useCloudStatus(): CloudStatus` returns `{phase:'unconfigured'|'signed-out'|'ready'|'syncing'|'offline'|'error',email:string|null,enabled:boolean,pending:number,lastSyncedAt:number|null,message:string}`.

`signIn(email,password):Promise<void>`: existing account email/password login, explicit action. Does not upload any data. SDK stores session locally; no password is stored by this app.

`enableSync():Promise<void>`: explicit user consent to upload all local user data and download their remote data. Binds this browser's local data to this one Supabase project/account; changing accounts is blocked to prevent account mixing. Starts current-tab automatic 30-second sync plus bounded exponential retries after failures and online-event retry. Reload requires sign-in/enable again; existing auth session can be reused by enableSync.

`syncNow():Promise<void>`: only works after enable; updates status, retains pending operations after failures, throws readable error for UI. Offline edits/deletes are discovered against persisted baselines on next sync. No data is silently dropped after retries.

`signOut():Promise<void>`: stops automatic retries, signs out of local SDK session. Keeps local recipes and account binding, preventing accidental upload to another user. Sign-out is blocked while sync is running; try again when complete. Data remain on the device.

Settings copy: Optional cloud sync is not configured or live-tested in this build. Local storage and backup work independently. Before enabling, export a backup. Sync sends personal notes, preferences and cooking activity to your configured Supabase project. Concurrent changes use whole-record revision ordering; edits to the same record can supersede each other. Tombstones persist so deletes are not resurrected by old devices. No claim of live RLS verification.

`forgetCloudCache():Promise<void>`: after sign-out and an explicit device-only reset, clears sync baselines/outbox/receipts (which duplicate personal content) but preserves the non-content account binding. Call alongside `actions.clearUserData()` for a complete device-content reset. It rejects while sync is enabled. Unsynced changes are discarded; remote data are untouched and can download if sync is enabled later.
