# Security findings (SEC-*)

Owner: security agent. Summary and residual risk: `docs/backend/SECURITY_AUDIT.md`.
Regression and defect tests: `tests/unit/backend-security-input.test.ts`, `tests/unit/backend-security-integrity.test.ts`, `tests/unit/backend-security-web.test.ts`. Tests marked `it.fails` assert the safe behaviour, so they pass while the defect exists. Remove the `.fails` when the owner fixes the defect.

Line numbers are for the working tree at the time of writing (2026-10-11). Other agents were editing `db.ts`, `engine.ts` and `core.ts` during the sweep, so re-check a line before applying a diff.

---

## SEC-1: an imported override can add meat or allergens and keep the canonical dietary and allergen claims

- Severity: P1 (allergen-exclusion and dietary-exclusion bypass)
- Module / file: `src/lib/engine.ts:52-82` (`effectiveRecipes`), reachable through backup import (`src/lib/db.ts` `importBackup`), sync (`overrides` entity) and any saved override.
- Reproduction steps: the vegetarian preference is set. A backup `overrides` row replaces `air-fryer-sweet-potato-fries` with the same recipe plus `{ name: "chicken thighs" }` in `ingredients`. Run `filterRecipes(effectiveRecipes(catalogue, data), { dietary: ["vegetarian"] })`. The recipe is still returned. The same happens with `{ name: "roasted peanuts" }` under `excludeAllergens: ["peanut"]`.
- Evidence:
  - `scripts/backend-audit/tmp/security/probe-override.ts`: prints `vegetarian pref, override adds chicken: visible? true` and `peanut exclusion, override adds peanuts w/o allergen tag: visible? true`.
  - `tests/unit/backend-security-integrity.test.ts` SEC-1 (2 cases, `it.fails`): passes now.
- Root cause: the merge keeps the baseline `allergens` (union) and `dietary` (intersection) but takes the override's `ingredients`. Nothing ties the declared claims to the ingredient list. The `custom-` fail-closed rule in `filterRecipes` covers only custom ids, not overrides. The comment "An untrusted backup override must never weaken the canonical safety constraints" holds for claims but not for the ingredient list. The Explorer UI says "Your saved allergen and dietary exclusions are always applied", which is false for this path.
- Fix: needs owner (engine). Fail closed when an override's ingredient list differs from the canonical one:

```ts
// src/lib/engine.ts, inside effectiveRecipes, replacing the allergens/dietary lines
const changed =
  JSON.stringify(parsed.data.ingredients) !== JSON.stringify(baseline.ingredients);
recipes.set(override.id, {
  ...parsed.data,
  // An edited ingredient list cannot be checked against the canonical declarations,
  // so it fails closed: every allergen declared, no dietary claim.
  allergens: changed
    ? [...allergenNames]
    : [...new Set([...baseline.allergens, ...parsed.data.allergens])],
  dietary: changed
    ? []
    : parsed.data.dietary.filter((claim) => baseline.dietary.includes(claim)),
  // ...unchanged oilFree, internalTempC and safety lines
```

  `allergenNames` is already exported by `src/lib/schema.ts`; add it to the engine import. Trade-off: a user who edits ingredients of a catalogue recipe will see that recipe hidden under any allergen exclusion, the same behaviour as a custom recipe.
- Regression test: `tests/unit/backend-security-integrity.test.ts` SEC-1 (two `it.fails`). Remove `.fails` after the fix.
- Status: FIXED-VERIFIED (by owner; `it.fails` removed, assertion now passes; test: see Regression test line)

---

## SEC-2: a far-future `updatedAt` makes a row impossible to edit

Related to STO-10 (device-clock ordering, a documented decision). This is a different failure: a value at the ceiling breaks writes.

- Severity: P2 (recoverable inconsistency; the row is unusable until deleted or restored)
- Module / file: `src/lib/db.ts:98` (`nextTime`), `src/lib/schema.ts:135` (`timestamp` max `8640000000000000`), `importBackup` in `src/lib/db.ts:717`. Sync can deliver the same value through `validateWire`.
- Reproduction steps: import a merge backup with `pantry` row `{ id: "p1", updatedAt: 8640000000000000, ... }`, then call `savePantry` on `p1`. Also `patchRecipeState` on a recipe state with the same value.
- Evidence: `scripts/backend-audit/tmp/security/probe-timestamp.ts`. Output: `edit after import FAILS: Some details are not valid`, `favourite toggle FAILS`, `notes save FAILS`. Test: `tests/unit/backend-security-integrity.test.ts` SEC-2 (`it.fails`).
- Root cause: `nextTime(previous)` returns `previous + 1`, which is above the schema ceiling once `previous` is at the ceiling. The schema then rejects the write. The user sees only the generic "Some details are not valid" message. Any clock-skewed or hostile backup, or a sync payload, can set the value.
- Fix: needs owner (storage):

```ts
// src/lib/db.ts:98
const timestampCeiling = 8640000000000000;
const nextTime = (previous = 0) =>
  Math.min(timestampCeiling, Math.max(Date.now(), previous + 1));
```

  Optional, defence in depth: in `previewImport`, reject rows with `updatedAt > Date.now() + 86400000` with a plain sentence that names the row.
- Regression test: `tests/unit/backend-security-integrity.test.ts` SEC-2 (`it.fails`).
- Status: FIXED-VERIFIED (by owner; `it.fails` removed, assertion now passes; test: see Regression test line)

---

## SEC-3: a merge can create data that can never be exported

- Severity: P1 (broken backup: the user loses the ability to write any backup until they delete rows)
- Module / file: `src/lib/db.ts` `importBackup` (`mode: "merge"`, about line 717) and `src/lib/schema.ts:290-299` (`backupSchema` caps). The write path (`save`, `saveCustomRecipe`, `saveSession`) has no cap check either.
- Reproduction steps: device A has 600 custom recipes and device B has 600 different ones. Merge B's backup into A. The merge succeeds and holds 1,200 custom recipes. `exportBackup` then throws `Could not make a backup: the saved customRecipes table has too many records to back up. Nothing was exported`.
- Evidence: `scripts/backend-audit/tmp/security/probe-caps.ts` (`customs after merge: 1200`, `EXPORT FAILS after merge`). Test: `tests/unit/backend-security-integrity.test.ts` SEC-3 (`it.fails`). The export failure is now reported clearly by the storage agent's `damagedRecordError`, but the state is still reachable.
- Cross-reference: STO-3 added the export-side 20 MB guard and a clear message. The merge-side cap is still open.
- Root cause: the caps are checked only at export. Merge and write never check the merged count against the same limits, so the app can reach a state its own export rejects.
- Fix: needs owner (storage). Check the merged counts before writing anything, and export the caps as one map so the write path and export share them:

```ts
// src/lib/schema.ts, next to backupSchema
export const backupLimits = {
  recipeStates: 20000, sessions: 50000, plans: 20000, pantry: 10000,
  shopping: 10000, customRecipes: 1000, overrides: 1000, preferences: 1, activeCooking: 1,
} as const;

// src/lib/db.ts importBackup, inside the rw transaction, before any write
for (const name of tableNames) {
  const merged = new Set([...current[name].map((r) => r.id), ...backup[name].map((r) => r.id)]);
  if (mode === "merge" && merged.size > backupLimits[name])
    throw new Error(`This merge would leave more than ${backupLimits[name]} ${name} records, which cannot be backed up. Nothing was imported.`);
}
```

  Also apply the per-table count in `save()` before `table.put` for a new id.
- Regression test: `tests/unit/backend-security-integrity.test.ts` SEC-3 (`it.fails`).
- Status: FIXED-VERIFIED (by owner; `it.fails` removed, assertion now passes; test: see Regression test line)

---

## SEC-4: the UI restore limit is lower than the export ceiling

- Severity: P1 (broken restore for a size band the app itself produces)
- Module / file: `src/pages/Settings.tsx:470` (`if (file.size > 10 * 1024 * 1024)`) against `src/lib/db.ts:601` (`maxBackupBytes = 20 MB`) and `previewImport`. `exportBackup` pretty-prints (2-space indent), so a file of about 9 MB of data can be near the 10 MB UI limit.
- Reproduction steps: create about 11–19 MB of data (for example 12 custom recipes with long steps, or many long session notes). Export. The file is written. Import it from Settings: the UI rejects it with "Backup files must be smaller than 10 MB". `previewImport` alone would accept it.
- Evidence: `scripts/backend-audit/tmp/security/probe-import.ts` (an 18.1 MB backup previews in 157 ms, so the engine accepts it). Test: `tests/unit/backend-security-integrity.test.ts` SEC-4 (`it.fails`).
- Root cause: two independent literals (10 MB in the page, 20 MB in the library) with no shared constant.
- Fix: needs owner (lead, `src/pages/Settings.tsx` is a UI file):

```tsx
// src/pages/Settings.tsx: import { maxBackupBytes } from "../lib/db"
if (file.size > maxBackupBytes)
  throw new Error("Backup files must be smaller than 20 MB.");
```

- Regression test: `tests/unit/backend-security-integrity.test.ts` SEC-4 reads the Settings source and compares the limit (`it.fails`).
- Status: FIXED (by lead; reported fixed, see SECURITY_AUDIT.md)

---

## SEC-5: a long search query froze the tab (quadratic filter cost)

- Severity: P3 (local resource DoS; a crafted `#/explore?q=` link)
- Module / file: `src/lib/engine.ts` `filterRecipes` (the per-token `words(searchable(recipe))` was recomputed for every recipe and token). `src/pages/Explorer.tsx:188-190` takes the query with no `maxLength`.
- Reproduction steps: open `#/explore?q=chicken%20chicken%20…` with 8,000 tokens (about 64 KB), or paste that text into the search box.
- Evidence (before the engine change): `scripts/backend-audit/tmp/security/probe-search2.ts`: `chicken x8000 (~64KB) 918.3 ms`, `under x40000 1201.2 ms`.
- Evidence (current tree, after the engine agent's change): the same probe prints `chicken x8000 (~64KB) 4.9 ms`, `under x40000 15.1 ms`. Status is therefore FIXED-VERIFIED for timing. A guard test `tests/unit/backend-security-web.test.ts` ("finishes a 64 KB query within 5 s") keeps the bound.
- Root cause: work per token times work per recipe, with the recipe's word list rebuilt on every token.
- Fix (already applied by the engine agent): precompute the word list once per recipe. The remaining hardening is optional: cap the query at 200 characters in `Explorer.tsx` (`maxLength={200}` on the search input) and in `filterRecipes`.
- Regression test: `tests/unit/backend-security-web.test.ts`.
- Status: FIXED-VERIFIED (timing, current tree).

---

## SEC-6: a non-absolute source URL throws inside the schema and surfaces "Invalid URL" to the user

- Severity: P2 (validation hygiene: unhandled exception, raw message, no field-level error)
- Module / file: `src/lib/schema.ts:81-88` (`refine((v) => new URL(v).protocol === "https:")`), reached from `save()` in `src/lib/db.ts`, `saveCustomRecipe`, `previewImport`, and `validateWire` in sync.
- Reproduction steps: save a custom recipe with source URL `not a url`, `/relative` or `//example.com/recipe`.
- Evidence: `scripts/backend-audit/tmp/security/probe-url.ts`. For those three inputs `recipeSchema.safeParse` throws `TypeError: Invalid URL`. `saveCustomRecipe` then rejects with `save error: Invalid URL`, which `describeWriteError` passes through to the toast. `javascript:` gives the field-level message, which is correct. Tests: `tests/unit/backend-security-input.test.ts` SEC-6 (`it.fails.each`, 3 cases).
- Root cause: `new URL()` is called unguarded inside `refine`. A zod refinement that throws escapes as an exception, not as an issue.
- Fix: needs owner (storage):

```ts
// src/lib/schema.ts:81-88
url: z
  .string()
  .max(2000)
  .refine((v) => {
    try {
      return new URL(v).protocol === "https:";
    } catch {
      return false;
    }
  }, "HTTPS sources only"),
```

- Regression test: `tests/unit/backend-security-input.test.ts` SEC-6 (`it.fails.each`).
- Status: FIXED-VERIFIED (by owner; `it.fails` removed, assertion now passes; test: see Regression test line)

---

## SEC-7: the client queues a custom recipe that the server will reject for size

- Severity: P2 (a legitimate custom recipe is accepted locally and then never syncs). Same defect as SYNC-13 in `docs/backend/findings/sync.md`; this entry adds the test and diff.
- Module / file: `src/cloud/core.ts:76` (`validateWire`) against `supabase/migrations/202610110001_airfuel_sync.sql:13` (`octet_length(payload::text) <= 524288`).
- Reproduction steps: a custom recipe with 60 steps of 9,000 characters (about 540 KB). `validateWire` accepts it. The server rejects it with check_violation 23514.
- Evidence: test `tests/unit/backend-security-input.test.ts` SEC-7 (`it.fails`). The server rejection (check_violation 23514) is classified as `permanent` in `src/cloud/supabase.ts` `postgrestErrorKind`, so the record is marked `blocked` (SYNC-1) and other records keep syncing. The record still never syncs and the message is the raw server text.
- Root cause: the client has no byte limit that matches the server. The jsonb text form is larger than `JSON.stringify`, so the margin must be built in.
- Fix: needs owner (sync), `src/cloud/core.ts` `validateWire`:

```ts
// Mirrors airfuel_user_records.bounded_payload. Leaves room for jsonb's extra spacing.
const maxPayloadBytes = 480 * 1024;
// ...inside validateWire, after validators[row.entity].parse(row.payload)
if (new TextEncoder().encode(JSON.stringify(row.payload)).length > maxPayloadBytes)
  throw new Error("This record is over 480 KB and cannot be synced. Shorten it to sync it.");
```

- Regression test: `tests/unit/backend-security-input.test.ts` SEC-7 (`it.fails`).
- Status: NEEDS-OWNER (sync; lead decision on the limit per SYNC-13). OPEN.

---

## SEC-8: a corrupt remote row could stall every other remote row

- Severity: P2 as found, now RESOLVED in the tree (SYNC-5)
- Module / file: `src/cloud/supabase.ts` `readAll` (the `unreadable` counter, about lines 180-195) and `src/cloud/core.ts` `run()`.
- Evidence: the sync agent changed `readAll` to count a row that fails `ZodError` as unreadable and continue, and changed `run()` to isolate rejected writes. I read the code; I did not run a separate test for this.
- Status: FIXED-UNVERIFIED (by security; sync agent owns the test coverage).

---

## SEC-9: no per-user row or storage quota on the sync table

- Severity: P2 (operator cost and availability; an authenticated user can fill the project database)
- Module / file: `supabase/migrations/202610110001_airfuel_sync.sql` (`airfuel_apply_change`, table `airfuel_user_records`). No count, rate or total-bytes limit. Each row can be up to 512 KB. `revision` accepts up to 2^53 - 1, so a user can lock their own later writes (self-DoS, P3 on its own).
- Evidence: static review of the migration. Not run against Postgres.
- Fix: needs owner (sync). Add a per-user cap in the security-definer function, using a counter table rather than `count(*)`, which scans each time:

```sql
-- Example only. A counter table avoids a count(*) scan on every insert.
create table public.airfuel_user_quota (user_id uuid primary key references auth.users(id) on delete cascade, rows_used integer not null default 0);
-- In airfuel_apply_change, before the insert: insert the quota row on first use,
-- increment rows_used when a new (user_id, entity, record_id) is created, and raise
-- errcode '53400' when rows_used would exceed 200000.
```

  Also set an API-gateway or Edge rate limit on the RPC (deployment setting).
- Status: NEEDS-OWNER (sync) and deployment. OPEN.

---
- Status: FIXED (sync; migration `202610110003_airfuel_sync_quota.sql` adds a per-account counter with backfill and SQLSTATE 53400; PGlite tests in `backend-sync-quota-backfill.test.ts`; reported by lead). Rate limiting at the gateway remains a deployment setting.


## SEC-10: no Content-Security-Policy, frame-ancestors or HSTS in the app or the preview server

- Severity: P2 (defence in depth; the app has no HTML sinks today, so the impact is limited)
- Module / file: `index.html` (no CSP meta), `vite.config.ts` (`preview` has no `headers`), and the host, which is not defined in the repo.
- Evidence: `index.html` has one inline script (the pre-paint theme script). Its hash is `sha256-SWBdsqYEHBmK389/G9qy3RcvA1Yrg+dbSyD6dt+AbKs=`, checked by `tests/unit/backend-security-web.test.ts`. The bundle, styles and fonts are all self-hosted (`@fontsource`). No third-party script, analytics or remote font.
- Fix: needs owner (lead for `index.html`, deployment for headers). Suggested production policy. `frame-ancestors` cannot be set in a meta tag, so it must be a header:

```
Content-Security-Policy: default-src 'self'; script-src 'self' 'sha256-SWBdsqYEHBmK389/G9qy3RcvA1Yrg+dbSyD6dt+AbKs='; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'self' https://YOUR-PROJECT.supabase.co; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Strict-Transport-Security: max-age=31536000
```

  Notes: the Vite dev server injects inline scripts for HMR, so apply this to production only. Drop `connect-src` Supabase when sync is not configured. If the inline theme script ever changes, the hash guard test fails and the CSP must change in the same commit.
- Regression test: `tests/unit/backend-security-web.test.ts` (hash equality and no inline handlers).
- Status: FIXED (by lead; reported fixed, see SECURITY_AUDIT.md)

---

## SEC-11: "Delete personal data" leaves personal residue in browser storage

- Severity: P2 (privacy scope gap; the search text is personal and survives the delete for the life of the tab)
- Module / file: `src/lib/navigation.ts:2-5` (`rememberExplore` writes `airfuel-explore-location` to sessionStorage, including the full query string), `src/App.tsx:166` (`airfuel-theme` in localStorage), `src/lib/noteDrafts.ts:27-35` (`airfuel-note-draft-reset` marker in localStorage). Sync metadata `binding` (`${url}|${userId}`) is kept by `forgetCloudCache` (`src/cloud/index.ts:292-317`) by design.
- Reproduction steps (live, fresh Playwright context, `scripts/backend-audit/tmp/security/delete-scope.mjs`): open `#/explore?q=peanut allergy test`, go to Settings, run "Delete personal data" with the confirmation. Then `sessionStorage["airfuel-explore-location"] = "#/explore?q=peanut+allergy+test&sort=relevance"` still exists. `localStorage["airfuel-theme"] = "system"` and `airfuel-note-draft-reset` remain.
- Assessment per key: `airfuel-explore-location` holds the user's search text and is the real issue. `airfuel-theme` holds only the enum `light|dark|system`, and App re-mirrors the default after delete, so it is WONT-FIX (acceptable residue). The reset marker holds only a UUID, also acceptable. The sync binding holds the Supabase project URL and user UUID, which is a pseudonymous identifier. Keep it, but disclose it, or clear it when the user asks to delete everything.
- Fix: needs owner (lead for the Settings handler; storage helper in `src/lib/navigation.ts`):

```ts
// src/lib/navigation.ts
export function forgetExploreLocation() {
  try {
    sessionStorage.removeItem("airfuel-explore-location");
  } catch {
    // Nothing to clear when storage is unavailable.
  }
}
```

  Call it from the reset handler in `src/pages/Settings.tsx` (after `clearRecipeNoteDrafts()`), and make the Settings privacy text say that the sync account binding remains until sync is signed out.
- Regression test: none yet (needs a sessionStorage stub). The live probe is the evidence.
- Status: FIXED (by lead; reported fixed, see SECURITY_AUDIT.md)

---

## SEC-12: sign-out is local-only, and the Supabase session persists in localStorage

- Severity: P3
- Module / file: `src/cloud/index.ts:319` (`auth.signOut({ scope: "local" })`), `src/cloud/supabase.ts` (`persistSession: !accessToken`, so the session is kept in localStorage under `airfuel-supabase-auth:<host>`).
- Assessment: a copied refresh token stays valid at the server after "Delete personal data" on a shared device. This is the ASVS V7 session-termination concern. The persisted session is intentional ("reuse saved session") and the app has no HTML sinks, so the XSS exposure is limited (see SEC-10 for the CSP).
- Fix: needs owner (sync). When the user asks to delete all data and is online, sign out with `{ scope: "global" }` and fall back to local when offline, and tell the user which happened.
- Status: NEEDS-OWNER (sync). OPEN.

---

## SEC-13: catalogue allergen declaration may be incomplete (data; verify)

- Severity: P3 (data accuracy; verify before acting)
- Module / file: `src/data/recipes-savoury.json`, recipe `air-fryer-nachos`. Ingredient "salted tortilla chips" is declared `allergens: ["milk"]`. Tortilla chips are often wheat-based, and the `wheat`/`gluten` exclusion would not hide this recipe.
- Evidence: `scripts/backend-audit/tmp/security/probe-allergens.ts` heuristic. Across all 300 recipes it found no other undeclared allergen keywords and no dietary-claim contradictions after I excluded false positives ("almond butter", "cream-style mustard", "vegetarian sausages", "vegetable stock").
- Fix: data owner (lead) must check the product label or change the ingredient to a named gluten-free corn chip, then declare `gluten` and `wheat` if it contains wheat. Not edited by me (brief: do not edit `src/data/*.json`).
- Status: NEEDS-OWNER (lead, data). OPEN (verify).

---

## SEC-14: the planner keeps and shops recipes that break newly set exclusions, with no warning

- Severity: P2 (allergen safety UX)
- Module / file: `src/pages/Planning.tsx:130-132` (exclusions applied only to the list of choices), with planned entries rendered and shopped without a check (`src/pages/Planning.tsx` around lines 245 and the shopping build).
- Reproduction steps: plan a peanut recipe, then add "peanuts" to the allergen preferences. The planner still shows the entry and the shopping list still includes its ingredients, with no warning.
- Evidence: `grep -n allergen src/pages/Planning.tsx` returns only line 132.
- Fix: needs owner (lead). Mark planned entries whose recipe declares an excluded allergen or breaks a dietary claim, and show a warning on the planner and shopping list. Do not remove them silently.
- Status: FIXED (by lead; reported fixed, see SECURITY_AUDIT.md)

---

## SEC-15: error text from lower layers reaches the user unchanged

- Severity: P3
- Module / file: `src/lib/db.ts` `describeWriteError` (passes any `Error` message through), `src/cloud/supabase.ts` (`Cloud write failed: ${error.message}` in older paths), `previewImport` (a non-ZodError is reported as "not an AirFuel Kitchen backup").
- Assessment: this exposed "Invalid URL" in SEC-6. Server text could reach the UI in the same way. Not a leak of secrets (I checked the messages), but it is misleading.
- Fix: needs owner (storage). Pass through only messages the app creates. Map other errors to the generic sentence and keep the raw error in `cause`.
- Status: NEEDS-OWNER (storage). OPEN.

---

## SEC-16: an import holds several copies of the whole backup in memory

- Severity: P3 (performance and availability on low-memory devices)
- Module / file: `src/lib/db.ts:711` (`knownPreviews.set(preview, JSON.stringify(preview))` keeps a second full copy), `dataFingerprint` (serialises the whole database at preview and at import).
- Evidence: `scripts/backend-audit/tmp/security/probe-import.ts`: an 18.1 MB file previews in 157 ms with a heap increase of about 56 MB (Node).
- Fix: needs owner (storage). Store a SHA-256 digest of the fingerprint (`crypto.subtle.digest`) instead of the full JSON, and compare digests.
- Status: NEEDS-OWNER (storage). OPEN.

---

## SEC-17: `supabase/.temp/` is untracked and not ignored

- Severity: P3 (secret hygiene: the Supabase CLI writes link metadata there)
- Module / file: `.gitignore` (no entry), directory `supabase/.temp/` (currently an empty `cli-latest`).
- Fix: needs owner (lead). Add `supabase/.temp/` to `.gitignore` before the next commit.
- Status: FIXED (by lead; reported fixed, see SECURITY_AUDIT.md)

---

## SEC-18: URL numeric filters are unvalidated

- Severity: P3 (no security impact; wrong results)
- Module / file: `src/pages/Explorer.tsx:43-46` (`protein`, `time`, `calories` stored as raw strings, then `Number(...)`). `dietary` takes any string.
- Assessment: `Number("abc")` gives `NaN`, which excludes everything. Filters can only narrow results, so there is no bypass. Consistency only.
- Fix: needs owner (lead). Validate with the same bounds as the filter inputs, and drop unknown values.
- Status: NEEDS-OWNER (lead). OPEN.

---

## SEC-19: sync payloads are stored in plaintext on the server

- Severity: P3 (residual risk; disclosed in the UI)
- Module / file: `supabase/migrations/202610110001_airfuel_sync.sql` (`payload jsonb`). The UI says that sync "sends cooking notes, preferences and other personal records".
- Assessment: the project operator and anyone with database access can read notes, preferences and custom recipes. Row-level security protects one user from another, not the operator from the data.
- Status: DECISION (owner). Options: accept and keep the disclosure, or add client-side encryption with a key that never leaves the device. No change made.

---

## Verified controls (no defect found)

| ID | Control | Evidence |
|---|---|---|
| V-1 | No HTML injection sinks (`dangerouslySetInnerHTML`, `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `eval`, `new Function`) in `src` | grep = 0; guard test in `backend-security-web.test.ts` |
| V-2 | Markup in custom recipe title and description renders as text | Playwright: `scripts/backend-audit/tmp/security/xss-import.mjs` A: no `window.__xss`, no injected `img`/`svg`, text shown as `<img src=x …>` |
| V-3 | `javascript:` source URL refused at import with a field hint | Playwright B: "Problem at customRecipes.0.recipe.sources.0.url"; unit: `backend-security-input.test.ts` |
| V-4 | `target="_blank"` always has `rel="noreferrer"` | guard test; `RecipeDetail.tsx:764` and `Settings.tsx:775` |
| V-5 | `__proto__` and `constructor` keys refused; `Object.prototype` untouched | `backend-security-input.test.ts` |
| V-6 | Unknown fields rejected (`.strict()`) at every backup, sync and recipe level | `backend-security-input.test.ts`; existing `backend-storage-backup.test.ts` |
| V-7 | Size bounds: 20 MB text before parse, row-count caps, 10,000-char text, 100-item lists | `backend-security-input.test.ts`; probe-import |
| V-8 | Hash-route `servings` bounded (finite, 0.5–100) before use | `CookMode.tsx:41-47` |
| V-9 | Explorer category, allergen, sort and status are whitelisted; allergen URL parameters are additive only | `Explorer.tsx:17-40` |
| V-10 | Allergen exclusions apply to every suggestion and search path (`recommendRecipes`, Explorer, Planner choices); custom recipes fail closed under any exclusion | `engine.ts` `filterRecipes`; `backend-engine-safety.test.ts` |
| V-11 | Recipe-link opener refuses non-fragment targets (`rememberExplore`, `exploreReturnLocation`) | `navigation.ts:2-19` |
| V-12 | No console logging of user data from `src` | guard test |
| V-13 | No secrets in the build, the source, the tests or the git history (one commit). The one `sb_secret_` string is a test placeholder (`cloud.test.ts:257`) | greps in this report |
| V-14 | Supabase config: publishable key or anon JWT only; `service_role`, `sb_secret_`, HTTP and credentialed URLs rejected | `cloud.test.ts` (existing); `parseCloudConfig` |
| V-15 | RPC: `security definer`, `set search_path = ''`, `auth.uid()` as the only owner, execute revoked from `public` and `anon`, table without mutation grants, FORCE RLS | migration; `backend-sync-rls.test.ts` (sync) |
| V-16 | Owner role bypasses RLS on Supabase, so the RPC works with FORCE RLS | Supabase docs, Context7 `/websites/supabase`: "the owner (postgres on Supabase) has bypassrls" |
| V-17 | npm audit: 0 vulnerabilities (production and full tree) | `npm audit --omit=dev --json`, `npm audit --json` |
| V-18 | No third-party script, analytics, remote font or markdown renderer | `index.html`, `package.json` |
| V-19 | Cross-user: `remoteRecord` rejects a row whose `user_id` differs; `apply` verifies the winner | `src/cloud/supabase.ts`, `backend-sync-*.test.ts` |
| V-20 | Delete-all clears every Dexie table, sync cache rows (except binding) and this tab's note drafts; drafts are not persisted to IndexedDB | `db.ts` `clearUserData`; `noteDrafts.ts`; live probe (SEC-11 for residue) |

## Functions and operations audited

| Operation | Location | Disposition |
|---|---|---|
| `previewImport` | `db.ts` (about 646) | Safe: size before parse, strict schema, duplicate-id check. SEC-6, SEC-16 |
| `importBackup` | `db.ts` (about 717) | Fingerprint guard, replace/merge. SEC-2, SEC-3 |
| `exportBackup` / `snapshot` | `db.ts` (about 584) | Validates every row, 20 MB guard. SEC-3, SEC-4 |
| `save` (generic) | `db.ts` (about 184) | Parses with the entity schema before write. SEC-2, SEC-3 |
| `patchRecipeState`, `saveRecipeNotes`, `toggleRecipeState` | `db.ts` | Enum and length checked; note concurrency guarded. SEC-2 |
| `startCooking`, `patchActiveCooking`, `setCookingCheck`, `stopCooking` | `db.ts` | Validated; cannot replace another active cook. OK |
| `saveOverride` | `db.ts` | Strict parse; merges against baseline. SEC-1 (engine merge) |
| `saveCustomRecipe` | `db.ts` | Strict parse. SEC-6, SEC-15 |
| `savePreferences` | `db.ts` | Strict and partial; timezone validated. OK |
| `saveShopping` | `db.ts` | Strict; prunes only generated items. OK |
| `effectiveRecipes` | `engine.ts:52` | SEC-1 |
| `filterRecipes` | `engine.ts` | Fail-closed custom recipes; SEC-5 fixed |
| `recommendRecipes` | `engine.ts` | Applies exclusions to all modes. OK |
| `rememberExplore`, `exploreReturnLocation` | `navigation.ts` | Fragment-only; OK. SEC-11 residue |
| Note draft read, write, clear, receive, reset parse | `noteDrafts.ts` | Length and message validation. SEC-11 residue |
| `parseCloudConfig`, `createCloudClient` | `cloud/supabase.ts` | Key and URL policy; 20 s fetch bound. SEC-12 storage |
| `remoteRecord`, `createSupabaseAdapter` (`apply`, `readAll`) | `cloud/supabase.ts` | User check; unreadable rows quarantined. SEC-8 resolved |
| `validateWire` | `cloud/core.ts:76` | Strict; no byte limit. SEC-7 |
| `SyncEngine.run`, `acceptRemote`, `finishReceipt` | `cloud/core.ts` | Revision order, receipts, rejected records isolated. OK |
| `signIn` | `cloud/index.ts` | Email and length checked; one generic failure message. OK |
| `signOut` | `cloud/index.ts:313` | Local scope only. SEC-12 |
| `enableSync` | `cloud/index.ts:148` | Verifies the user with the server (`getUser`). OK |
| `forgetCloudCache` | `cloud/index.ts:292` | Clears records, keeps the binding. SEC-11 |
| `airfuel_apply_change` (SQL) | migration | Owner from `auth.uid()`, ordered upsert. SEC-9 |
| `airfuel_user_records` RLS | migration | Select own rows only; no mutation grants. OK |
| Route parser, `servings` | `App.tsx:108-245`, `CookMode.tsx:41-47` | Bounded. OK |
| Explorer query parser | `Explorer.tsx:17-90` | Whitelists; SEC-18 numbers |
| Custom recipe form submit | `CustomRecipes.tsx:590-640` | Zod per-field errors; SEC-6 |
| Settings export and import | `Settings.tsx:109-120, 455-480` | Blob download; file-size check. SEC-4 |
| Recipe "Copy link" | `RecipeDetail.tsx:404-411` | Copies the in-app hash only; no recipe payload in URLs, so no share-link injection surface |
