# Backend sweep: shared agent brief (2026-10-11)

Project: AirFuel Kitchen, `/Users/raoof.r12/Desktop/Raouf/Fun`. This is a git repo: `main` is pushed to a PUBLIC GitHub repo. Never commit or push; the lead does that.
A frontend sweep just finished (see `docs/frontend/FINAL_FRONTEND_REPORT.md`, `docs/frontend/ISSUE_REGISTER.md`, especially LOGIC-*, PLAN-*, PERF-*). Don't redo it; build on it.

## The real architecture (audit THIS; don't invent a server)
- Local-first. Primary store: IndexedDB via Dexie, in `src/lib/db.ts` (schema versions 1 and 2, actions API, backup/import, active cooking, notes concurrency). Validation: zod in `src/lib/schema.ts`.
- Domain logic: `src/lib/engine.ts` (search, filters, recommendations, scaling, shopping aggregation, nutrition helpers, `formatShoppingAmount`); `src/lib/noteDrafts.ts`; `src/lib/navigation.ts`.
- Canonical catalogue: `src/data/recipes-savoury.json` + `src/data/recipes-plant.json` (300 recipes), loaded by `src/data/catalogue.ts`. Research evidence is in `research/`, and `scripts/validate-data.ts` (`npm run validate:data`) validates it.
- Optional cloud sync: `src/cloud/{core,index,supabase}.ts`, plus a single SQL migration at `supabase/migrations/202610110001_airfuel_sync.sql` (table `airfuel_user_records`, RLS, security-definer RPC `airfuel_apply_change`). No Supabase project is configured, so there are no credentials.
- UI consumers are in `src/pages/*`, `src/components/*` and `src/App.tsx`. These are NOT backend files.

## Rules
- Edit ONLY the files you own (listed in your task). For changes elsewhere, write them under "Needs other owner" in your findings with the exact diff. UI files (`src/pages`, `src/components`, `src/App.tsx`, CSS) are lead-owned during this sweep.
- Every behaviour change needs a unit test (Vitest + fake-indexeddb, in `tests/unit/`). Name new test files after your area, e.g. `tests/unit/backend-<area>-*.test.ts`. Don't edit another agent's test files.
- Never weaken or delete a valid test to make it pass. No arbitrary sleeps. Find the race.
- Never touch real user data. Use only fake-indexeddb, fresh Playwright contexts and fixtures you create.
- Do NOT change the Dexie schema version, the store definitions or the backup format unless the change is essential to fix a P0/P1. If so, implement a versioned migration with tests and flag it prominently.
- Do NOT edit `src/data/*.json` or `research/`. Report data defects with evidence; the lead decides.
- Don't start servers on 5180/4173. A dev server is already running at http://127.0.0.1:5180 if you need a browser (Playwright, fresh contexts, scripts in `scripts/backend-audit/tmp/<agent>/`). Do NOT run `npx playwright test` (the lead runs the e2e suite) or `npm run build` (use `npx vite build --outDir /private/tmp/claude-501/airfuel-backend/<agent>` if you need a production build).
- Fast checks you may run in parallel: `npx tsc -p tsconfig.app.json --noEmit`, `npx eslint <files>`, `npx vitest run <files>`; run the full `npx vitest run` before you finish.
- Use current docs where it matters (Dexie versioning/upgrade, Supabase RLS, OWASP ASVS 5.0). The Context7 MCP tools (`mcp__claude_ai_Context7__resolve-library-id`, `mcp__claude_ai_Context7__query-docs`) or WebFetch are available; load them via ToolSearch.

## Reporting
Write findings progressively to `docs/backend/findings/<agent>.md`:

```
## <PREFIX>-<n>: <title>
- Severity: P0|P1|P2|P3   (P0 data loss/cross-user exposure/destructive migration; P1 broken persistence, sync defect, duplicate records, broken restore, allergen-exclusion bypass; P2 missing validation, recoverable inconsistency, wrong ranking, incomplete error handling; P3 debt)
- Module / file:line
- Reproduction steps + evidence (test name, script, output)
- Root cause
- Fix (what changed) or "Needs other owner: <file> + exact diff"
- Regression test
- Status: FIXED-VERIFIED | FIXED-UNVERIFIED | OPEN | NEEDS-OWNER | WONT-FIX (reason) | DECISION
```
Also list functions/operations you audited with a one-line disposition (the lead compiles `FUNCTION_AUDIT.md`).
Final reply to the lead: counts by severity and status, files changed, needs-owner items, and anything you could NOT verify. Be honest; never claim a check you didn't run.
