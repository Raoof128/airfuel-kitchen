# Backend baseline report

Owner: inventory agent. Captured 2026-10-11, about 20:40 to 20:50 AEDT.

## Commit and tree state

- HEAD: `3dea4926f998dd05fe48588eef9da962ec983e38` (`AirFuel Kitchen: offline-first air-fryer cooking companion`).
- Tracked files were clean when the baseline commands ran. Untracked: `docs/backend/`, `scripts/backend-audit/`, and `supabase/.temp/cli-latest` (0 bytes, created by the Supabase CLI at 20:46).
- Other sweep agents edited `src/lib/db.ts`, `src/lib/engine.ts`, `src/cloud/core.ts`, `src/cloud/index.ts`, `package.json` and `package-lock.json` while this sweep ran. The results below describe HEAD. Re-run results are in section 8.
- Line numbers cited in the inventory and findings are HEAD line numbers unless marked (WT).

## Results

| Check | Command | Result |
| --- | --- | --- |
| Lint | `npm run lint` (`eslint .`) | Exit 0, no warnings or errors. |
| Typecheck | `npx tsc -b` | Exit 0, no output. |
| Unit tests | `npx vitest run` | 19 files, 109 of 109 tests passed. |
| Data validation | `npm run validate:data` | Exit 0. 300 published recipes, 344 unique source URLs, 0 errors, 0 warnings. Both minimums met (160 and 300). |
| Prod audit | `npm audit --omit=dev` | 0 vulnerabilities. 21 prod deps, 575 total. |
| Full audit | `npm audit` | 0 vulnerabilities. |
| Circular imports | `npx madge@8 --circular` over `src` | None found (29 files). |
| Unused exports | `npx ts-prune@0.10.3 -p tsconfig.app.json` | Listed in the inventory, section K. |
| Migration parity | PGlite 0.5.8 run of the SQL migration | See section 6. |
| E2E | Not run by inventory. | Last known pass at 3dea492: 69 of 69 plus 33 visual (per lead). |
| Production build | Not run (`npm run build` is out of scope for sweep agents). | |

Unit tests per file at HEAD:

| File | Tests |
| --- | ---: |
| backup-all-tables | 2 |
| backup-preview-conflicts | 3 |
| backup-schema-errors | 3 |
| cloud | 10 |
| cook-mode-logic | 4 |
| custom-ingredients | 17 |
| db | 9 |
| engine | 8 |
| format-amount | 3 |
| integration-hardening | 9 |
| note-drafts | 4 |
| notes-concurrency | 5 |
| search-words | 5 |
| session-rating | 2 |
| shopping-amounts | 5 |
| shopping-prune | 2 |
| shopping-tick-persistence | 3 |
| upgrade-interactions | 9 |
| write-errors | 6 |
| **Total** | **109** |

The unit suite runs with `fake-indexeddb/auto` (`tests/unit/*.test.ts`). It does not import `src/cloud/index.ts`, `src/lib/navigation.ts` or any sync path that calls Supabase.

## Dexie schema

- Database `airfuel-kitchen` (`src/lib/db.ts:65-87`).
- Version 1 and version 2 have the same store definitions (`db.ts:44-54`). Version 2 has an upgrade that sets `sessions.servingsConsumed ??= 0` and fills missing preference keys from defaults.
- Stores: `recipeStates`, `sessions`, `plans`, `pantry`, `shopping`, `customRecipes`, `overrides`, `preferences`, `activeCooking`.
- Sync metadata database `airfuel-kitchen-sync`, version 1 (`src/cloud/core.ts:86-93`): stores `records` (key `key`) and `meta` (key `key`).
- Schema is unchanged by this sweep. Changing it needs a versioned migration and a P0/P1 justification (AGENT_BRIEF rule).

## Migration state

- One SQL file: `supabase/migrations/202610110001_airfuel_sync.sql` (47 lines).
- Its header says it must be applied manually to the owner's Supabase project. No Supabase project is configured (`.env.example` has empty values). Nothing is applied anywhere locally.
- Dependencies: `@supabase/supabase-js` ^2.117.3 in prod; `@electric-sql/pglite` 0.5.8 was added to devDependencies during the sweep (by another agent, not in HEAD).

## Existing warnings and known gaps

- No lint, type, or validation warnings at HEAD.
- The migration has never been executed against Postgres by the project. Inventory verified it on PGlite; see section 6.
- `vite.config.ts` imports `defineConfig` from `vitest/config`. This works but ties the production config to the test tool.
- `npm audit` returning zero findings does not prove the dependency tree is clean. It reflects the advisory data available at run time.

## Sweep caveats

- Unit suite counts are for HEAD. Storage and sync agents have since added `tests/unit/backend-*.test.ts` files. Their counts are not included here.
- The frontend sweep's ISSUE_REGISTER (133 rows) is the source for cross-references. This report does not re-test those rows.

## 6. SQL migration check (PGlite)

Scripts: `scripts/backend-audit/tmp/inventory/sql-check.mjs` and `sql-check-noforce.mjs`. They run the migration on PGlite with a stub `auth` schema (`auth.users`, `auth.uid()` reading `request.jwt.claim.sub`), once as an owner role with `BYPASSRLS` and once without.

| Check | Owner with BYPASSRLS | Owner without BYPASSRLS (as migration is written) | Owner without BYPASSRLS, `FORCE` removed |
| --- | --- | --- | --- |
| User A writes via `airfuel_apply_change` | ok | **fails: new row violates row-level security policy** | ok |
| Direct insert by `authenticated` | denied (no grant) | denied | denied |
| User B reads A's rows | 0 rows | 0 rows | 0 rows |
| Anonymous RPC | "Authentication required" | same | same |
| Equal revision, greater operation id wins | accepted | not reached | accepted |
| Revision 0 | rejected by check | not reached | rejected by check |
| Tombstone with payload | rejected by `valid_tombstone` | not reached | rejected |
| 600 KB payload | rejected by `bounded_payload` | not reached | rejected |

Conclusion: the RPC works only if the function owner role has `BYPASSRLS` or the table is not `FORCE ROW LEVEL SECURITY`. Finding ARCH-5.

Check on a live project before relying on the first: `select rolname, rolbypassrls from pg_roles where rolname = 'postgres';`. The second is decided by the migration text.

## 8. Re-run status (about 21:00 AEDT)

- Unit suite, working tree: 361 tests, 356 pass, 5 fail in 4 files. The failing files are new engine and storage tests (`backend-engine-safety`, `backend-engine-scenarios`, `backend-engine-search`, `upgrade-interactions`). Not diagnosed by inventory. HEAD: 109 of 109.
- Reproductions and SQL checks: see section 9 of `docs/backend/findings/inventory.md`. HEAD was checked from `git archive 3dea492` in scratch space, not from the live tree.
- Lint and typecheck were run only at HEAD (clean tree). They were not re-run on the working tree.
