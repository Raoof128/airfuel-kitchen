# AirFuel Kitchen: security and API/contract audit (2026-10-11)

Owner: security agent. Findings with diffs and status: `docs/backend/findings/security.md` (SEC-1 to SEC-19). Tests: `tests/unit/backend-security-input.test.ts`, `tests/unit/backend-security-integrity.test.ts`, `tests/unit/backend-security-web.test.ts`.

## Scope and baseline

- Local-first PWA: IndexedDB (Dexie) is the primary store, with zod validation, an optional Supabase sync, and one SQL migration. Build and read-only review of `src/` and `supabase/`. No edits to those trees.
- Baseline: OWASP ASVS 5.0 chapters V1 (encoding), V2 (validation), V3 (web frontend), V4 (API), V5 (file handling), V6 and V7 (authentication and sessions), V8 (authorisation), V13 (configuration), V14 (data protection), V15 (secure architecture), V16 (logging). OWASP API Security Top 10 (2023): API1 object-level authorisation, API3 property-level authorisation, API4 resource consumption, API8 misconfiguration, API10 unsafe consumption.
- Not in scope: hosting and DNS (the host is not in this repository), the Supabase project (none is configured), and live Postgres.

## Summary

| Severity | Count | IDs |
|---|---|---|
| P0 | 0 | |
| P1 | 0 open, 3 resolved | Resolved: SEC-1 (override bypass), SEC-3 (merge beyond caps), SEC-4 (UI restore limit below export ceiling; Settings now uses `maxBackupBytes`) |
| P2 | 1 open, 7 resolved | Open: SEC-7 (= SYNC-13). Resolved: SEC-2, SEC-6 (storage), SEC-8 (= SYNC-5), SEC-9 (sync quota), SEC-10 (CSP), SEC-11 (delete-all residue), SEC-14 (planner warnings) |
| P3 | 5 open, 2 resolved, 1 decision | Open: SEC-12, SEC-13, SEC-15, SEC-16, SEC-18. Resolved: SEC-5, SEC-17 (`supabase/.temp/` gitignored). Decision: SEC-19 |

Resolved in the tree during the sweep: SEC-5 (search cost; verified 4.9 ms against 918 ms before), SEC-8 (corrupt remote rows; quarantined by the sync agent, not separately tested by me).

Status totals: OPEN or NEEDS-OWNER 6 (SEC-7, SEC-12, SEC-13, SEC-15, SEC-16, SEC-18); FIXED-VERIFIED 11 (SEC-1, SEC-2, SEC-3, SEC-4, SEC-5, SEC-6, SEC-9, SEC-10, SEC-11, SEC-14, SEC-17); FIXED-UNVERIFIED 1 (SEC-8); DECISION 1 (SEC-19). SEC-9 (migration and PGlite tests), SEC-14 (browser-verified by the planning agent, 375 and 1440 px, light and dark, axe clean), SEC-10, SEC-11 and SEC-17 are fixed by their owners; I re-checked the code and tests for SEC-9 and SEC-14 and did not re-run the browser checks.

Test status: the five related files (`backend-sync-quota-backfill`, `backend-sync-rls`, `backend-security-*`) pass: 66 tests passed, 1 `it.fails` still expected to fail (SEC-7). The full suite was last run as 462 passed, 1 expected fail. `npx tsc -p tsconfig.app.json --noEmit` exits 0. `npx eslint` on the new files is clean. The full `npx vitest run` had 5 failures in other agents' files (`backend-engine-search`, `backend-storage-backup`, `backup-all-tables`). Those were 5-second timeouts under 34-worker load. Each of those files passes when run alone.

## Verified controls

- **No HTML sinks.** Zero matches for `dangerouslySetInnerHTML`, `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `eval`, `new Function` in `src`. Live check in a fresh Playwright context (`scripts/backend-audit/tmp/security/xss-import.mjs`): a custom recipe with `<img src=x onerror=…>` in its title and description imports, shows as literal text, and sets no `window.__xss`.
- **Unsafe URLs refused.** `javascript:`, `data:`, `http:`, `vbscript:` source links are refused at import. The live probe showed the field-level message.
- **Prototype pollution.** `__proto__` and `constructor` keys are refused (`.strict()`); `Object.prototype` is untouched.
- **Strict schemas everywhere.** Backup, sync wire, recipe, session, preferences and override all reject unknown fields.
- **Bounded inputs.** 20 MB before parse, row-count caps, 10,000-character text fields, 100-item lists, 2,000-character URLs.
- **Allergen and dietary exclusions** apply to recommendations, Explorer and planner choices. Custom recipes fail closed under any exclusion. Catalogue declarations match ingredient keywords across all 300 recipes (one doubtful item, SEC-13).
- **Cloud configuration.** Only publishable keys and `anon` JWTs are accepted. `service_role`, `sb_secret_`, HTTP and credentialed URLs are rejected (existing `cloud.test.ts`).
- **RPC and RLS.** `airfuel_apply_change` is `security definer` with `search_path = ''`, takes its owner from `auth.uid()`, has execute revoked from `public` and `anon`, and the table has no mutation grants. Supabase's documentation confirms the owner role (`postgres`) has `bypassrls`, so FORCE RLS does not break the RPC.
- **No secrets.** `dist/`, `src/`, `tests/`, `docs/`, `supabase/` and the one git commit contain no keys. The single `sb_secret_` string is a test placeholder. `.env.example` is empty.
- **Dependencies.** `npm audit --omit=dev` and `npm audit` both report zero vulnerabilities.
- **Logging.** No `console` calls in `src`.
- **Links.** Every `target="_blank"` carries `rel="noreferrer"`.

## Findings by theme

### Trust boundaries and validation

- SEC-1 (P1): an override can add a meat or peanut ingredient and keep the canonical dietary and allergen claims. Confirmed for vegetarian and peanut exclusions.
- SEC-2 (P2): a backup row with `updatedAt` at the schema ceiling makes that row impossible to edit. Confirmed for pantry, recipe state and notes.
- SEC-6 (P2): a non-absolute source URL throws inside the schema, so the user sees "Invalid URL".
- SEC-7 (P2, = SYNC-13): the client accepts a custom recipe the server rejects for size (over 512 KB as jsonb). The record is blocked without a clear message and never syncs.

### Sizes, caps and restore

- SEC-3 (P1): a merge can exceed the custom-recipe cap. Export then fails permanently. Confirmed with 600 + 600 recipes.
- SEC-4 (P1): Settings rejects files over 10 MB, but export and the engine allow up to 20 MB. A 10–20 MB backup can be written and not restored.
- SEC-16 (P3): an 18 MB import holds several copies in memory (about 56 MB heap increase in Node).

### Injection and rendering

- No findings. Verified controls V-1 to V-4 in the findings file.
- SEC-15 (P3): raw error text reaches the toast in some paths.
- SEC-5 (resolved): long query cost. The guard test keeps the bound.

### Configuration and headers

- SEC-10 (P2): no CSP, `frame-ancestors` or HSTS. The app has one inline script, its hash is `sha256-SWBdsqYEHBmK389/G9qy3RcvA1Yrg+dbSyD6dt+AbKs=`, and everything else is self-hosted. A suggested production policy is in the findings file. It must be sent as a header for `frame-ancestors`, and it should apply to production only because the Vite dev server injects inline scripts.
- SEC-17 (P3): `supabase/.temp/` is not in `.gitignore`.

### Privacy and data lifecycle

- SEC-11 (P2): "Delete personal data" leaves the search text from the Explorer in `sessionStorage` (`airfuel-explore-location`). Reproduced in a fresh browser context. The theme mirror and the reset marker are acceptable residue. The sync binding (project URL and user UUID) is kept by design.
- SEC-19 (decision): sync payloads are plaintext on the server. Row-level security protects one user from another, not the operator. The UI discloses this.

### Supabase

- SEC-9 (P2, fixed): no per-user quota. Fixed by migration `202610110003_airfuel_sync_quota.sql` (per-account counter, backfill, SQLSTATE 53400). A rate limit at the gateway is still a deployment setting.
- SEC-12 (P3): sign-out is local-scope only, and the session is kept in localStorage. Delete-all should revoke globally when online.
- Cross-check with the sync agent: their `backend-sync-rls.test.ts` covers the RLS and RPC cases listed above. Their note on the owner precondition matches the Supabase documentation.

### Availability and DoS

- SEC-5 (resolved): search cost.
- SEC-9 (above, fixed): storage quota.
- SEC-16 (above): import memory.

### Product and data

- SEC-13 (P3, verify): `air-fryer-nachos` lists "salted tortilla chips" with only `milk` declared. The chips may contain wheat. Data is not edited by me.
- SEC-14 (P2, fixed): the planner flagged recipes that break a newly set exclusion. Fixed in `Planning.tsx` (`exclusionConflicts`, and the shopping-list note).
- SEC-18 (P3): hash-route numeric filters are not validated. No bypass, only wrong results.

## Header set for SEC-10 (set at the host; `frame-ancestors` cannot be set from a meta tag)

```
Content-Security-Policy: frame-ancestors 'none'
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Strict-Transport-Security: max-age=31536000
```

The build-time CSP meta from the Vite plugin in `vite.config.ts` covers the script, style, connect and other directives. Keep the host header for `frame-ancestors`.

## Residual risk

- A malicious or mistaken backup file can change catalogue recipe steps and temperatures (`temperatureC`, `cookMinutes`, `steps`). Only `internalTempC` and `safety` are constrained. Import preview shows counts, not content changes. Recommend the preview show which canonical recipes an override changes (lead decision).
- The Supabase project settings are outside the repository: password policy, email confirmation, rate limits, API row limit (the client requires at least 500), and which key is published. Each needs a live check before enabling sync.
- Browser storage is not encrypted. A device with local access reads the IndexedDB notes.
- Sign-in tokens live in localStorage until sign-out. Mitigated by the absence of HTML sinks and the CSP (SEC-10).
- Live Supabase behaviour (RLS against a real project, `bypassrls` on the configured owner, check constraints) was not run. The sync agent's tests describe the expected behaviour.

## What I could not verify

- A production build with the CSP applied. Only the hash was computed, from `index.html` and the built output.
- Postgres behaviour: the migration was reviewed, not executed.
- Headers on any real host. None is defined in this repository.
- The full Playwright e2e suite (the lead runs it). I ran two fresh-context probes only (XSS via import, delete-all residue).
- Exact memory use on a phone. The 56 MB figure is from Node.

## Commands run

- `npx tsx scripts/backend-audit/tmp/security/probe-schema.ts`, `probe-search.ts`, `probe-search2.ts`, `probe-allergens.ts`, `probe-diet.ts`, `probe-override.ts`, `probe-timestamp.ts`, `probe-import.ts`, `probe-caps.ts`, `probe-url.ts`
- `node scripts/backend-audit/tmp/security/xss-import.mjs`, `xss-js-debug.mjs`, `delete-scope.mjs` (Playwright, dev server on 5180, fresh contexts)
- `npm audit --omit=dev --json`, `npm audit --json`
- Secret greps over `src`, `tests`, `docs`, `supabase`, `dist`, and `git log -p --all`
- `npx vitest run tests/unit/backend-security-*.test.ts`, `npx vitest run` (full), `npx tsc -p tsconfig.app.json --noEmit`, `npx eslint` on the new files

## Scripts and fixtures

All probes and fixtures are under `scripts/backend-audit/tmp/security/` (the brief's scratch location). The `fixtures/` folder holds generated backup files. They contain no real user data.
