# Inventory and architecture findings (prefix ARCH)

Agent: inventory. Baseline HEAD `3dea492`. Line numbers are HEAD unless marked (WT). The working tree changed during the sweep (`src/lib/db.ts`, `src/lib/engine.ts`, `src/cloud/core.ts`, `src/cloud/index.ts`, `package.json`). Section 0 has the re-run status.

Reproduction scripts (no changes to `src/`, fake-indexeddb or PGlite only):
- `scripts/backend-audit/tmp/inventory/repro.ts` (run `npx tsx scripts/backend-audit/tmp/inventory/repro.ts [r1|r2|r3|r5|r9]`)
- `scripts/backend-audit/tmp/inventory/sql-check.mjs` and `sql-check-noforce.mjs` (run `node <file>`)

## 0. Summary and re-run

| ID | Severity | Status at HEAD | Owner | One line |
| --- | --- | --- | --- | --- |
| ARCH-1 | P1 | HEAD: reproduced. WT: FIXED-VERIFIED for SQLSTATE-classified errors (R7, real adapter). Unclassified errors still halt the pass by design. | sync | One permanently rejected record blocked every other pending record. |
| ARCH-2 | P1 | OPEN, reproduced | sync + lead (copy) | Clearing sync baselines makes a newer offline edit lose to an older server revision. Same root as LOGIC-10. |
| ARCH-3 | P2 | OPEN, reproduced | storage + lead | Ticking an ingredient on Recipe Detail with nothing cooking starts a cook and blocks others. |
| ARCH-4 | P2 | OPEN, reproduced | storage | Merge import replaces the active cook without the guard. |
| ARCH-5 | P1 (latent) | OPEN, verified on PGlite | sync (SQL) | The RPC fails for every write unless the function owner bypasses RLS. Remove `FORCE`. |
| ARCH-6 | P2 | OPEN, reproduced with the bound | storage (schema) + sync | Client limits accept records the server rejects. |
| ARCH-7 | P2 | NOT REPRODUCED (code reading) | sync | Signing in as another account after sign-out shows "account changed in another tab". |
| ARCH-8 | P2 | OPEN | lead + logic | Food-safety rule and ingredient parser live in a page; the safety rule has no unit test. |
| ARCH-9 | P2 | DECISION, reproduced | lead (decision) + storage | Overrides freeze nutrition, ingredients and steps; catalogue corrections do not reach them. |
| ARCH-10 | P3 | OPEN (guard added in WT when an expected id is passed; STO-8) | storage | Two action members have no callers; `saveActiveCooking` still bypasses the guard when the expected id is omitted. |
| ARCH-11 | P3 | OPEN | lead | `eslint-plugin-react-hooks` and `prettier` declared but not used. |
| ARCH-12 | P2 | OPEN | storage + lead | Two page flows write many rows in separate transactions. |
| ARCH-13 | P3 | OPEN | sync + storage | Raw server text in sync status; "in another tab" shown in one tab. |
| ARCH-14 | P3 | OPEN | logic + lead | Duplicate bounds and two amount-formatting rule sets. |
| ARCH-15 | P3 | DEBT | storage | Unused Dexie secondary indexes; full-table read on every change. |
| ARCH-16 | P3 | OPEN | engine + storage + lead | Generated shopping rows persisted as snapshots; prefix contract is implicit. |
| ARCH-17 | P3 | OPEN | sync + lead | Sync uploads `viewedAt`, a device view log; not disclosed. |
| ARCH-18 | P3 | OPEN | lead + engine | Unchecked boundary casts and one `!` on `Intl` output. |
| ARCH-19 | P2 | OPEN (partly covered in WT) | sync | `signIn`, `enableSync`, `syncNow` scheduling and the auth listener have no unit tests. |
| ARCH-20 | P3 | Covered by STO-1 (FIXED-VERIFIED); not re-checked | storage | One invalid stored row blocks export and preview entirely. |
| ARCH-21 | P3 | OPEN | sync | `enableSync` builds a discarded engine; `engine` state only gates `syncNow`. |
| ARCH-22 | P3 | OPEN | sync | `readAll` uses offset paging; concurrent inserts can skip rows until the next pass. |
| ARCH-23 | P1 | OPEN, reproduced in WT (R6) | sync | A record classed as permanent is never retried, even after the server is fixed. 42501 (RLS or grant denial) is classed as permanent. |

Re-run status (working tree at 20:5x, before the final pass): see section 9.

Positive checks (no finding): no circular imports (`madge`); no page or component touches a Dexie table directly; zero `as any`, zero `as unknown as`, zero `eslint-disable`; the migration's `airfuel_user_records` is readable only through RLS by its owner, has no direct mutation grant, and the RPC takes its identity from `auth.uid()` with an empty `search_path` (verified on PGlite).

---

## ARCH-1: One permanently rejected record blocks every other pending record

- Severity: P1 (sync defect)
- Module / file:line: `src/cloud/core.ts:229-240` (`SyncEngine.run`), HEAD
- Reproduction steps + evidence: `npx tsx scripts/backend-audit/tmp/inventory/repro.ts r1`. The fake server rejects a custom recipe whose JSON exceeds 524,288 bytes (the migration's `bounded_payload` check). Two pantry rows are also pending.
  ```
  pass 1: run() rejected: Cloud write failed: new row violates check constraint "bounded_payload"
  pass 2: run() rejected: Cloud write failed: new row violates check constraint "bounded_payload"
  apply attempts: [ 'r1:customRecipes/custom-big', 'r1:customRecipes/custom-big' ]
  pantry B reached server: false
  ```
  Pantry A and B are never attempted. Sync is blocked for every record, on every pass.
- Root cause: the push loop awaits `adapter.apply` with no per-record error handling. The first throw ends the pass, and the record is retried first next time.
- Fix: catch per-record errors in the push loop, keep the failing record pending with its error, and continue. Surface the count. Re-throw only auth errors. The sync owner's working tree already has a test named "does not let one permanently rejected record block every other record (head-of-line)" (`tests/unit/backend-sync-engine.test.ts:175`). Verify that it passes against the current `core.ts`.
- Superseded in WT by SYNC-1 for classified errors. The change below is kept as the reference design.
- Needs other owner: `src/cloud/core.ts` (sync). Exact change:
  ```ts
  for (const state of await this.metadata.records.toArray())
    if (state.pending) {
      try {
        await this.acceptRemote(await this.adapter.apply(state.pending));
      } catch (error) {
        if (isAuthError(error)) throw error; // stop the pass; sign-in is needed
        failed++; // keep the record pending, keep going
      }
    }
  ```
- Regression test: the R1 script as a Vitest case with a fake adapter (see the head-of-line test above). Assert that pantry A and B both reach the server while the oversized record is retained.
- Cross-ref: ARCH-6 (the size mismatch that triggers this).
- Status: HEAD reproduced (every adapter error halts the pass). WT: a SQLSTATE-classified error such as 23514 now blocks only its own record (R7, through the real `createSupabaseAdapter`). Plain `Error`s still halt the pass (R1), which is the designed transient path. Watch the transient path: a deterministic plain error (for example "Cloud returned an unexpected write response.", `supabase.ts:144`) would stop every pass.

## ARCH-2: Clearing sync baselines makes a newer offline edit lose to an older server revision

- Severity: P1 (silent loss of a user's latest edit)
- Module / file:line: `src/cloud/index.ts:292-317` (`forgetCloudCache`), `src/cloud/core.ts:144-195` (`scanLocal`), `src/cloud/core.ts:196-228` (`acceptRemote`), HEAD. Same root as LOGIC-10 (first-sync conflicts), with a second trigger.
- Reproduction steps + evidence: `npx tsx scripts/backend-audit/tmp/inventory/repro.ts r2`
  - Device 1 writes `v1`, then `v2` (server revision 2).
  - Device 2 syncs to revision 2. It then edits to `v3` offline (newer than the server's `v2`) and does not sync.
  - `forgetCloudCache()` clears device 2's sync records. The Settings delete flow calls it, and `src/cloud/API.md` documents it as the way to clear the sync cache. Device 2 re-enables sync and runs.
  - Result: `device2 local after re-enable + run: v2 (LOST ...)`.
  - Control with no forget: the server keeps `v3`.
- Root cause: change detection needs the revision the device last saw. Once the records are cleared, every local row gets revision 1. Any server row with revision 2 or higher then wins, even when the local edit is newer. `forgetCloudCache` (documented as "Unsynced changes are discarded") deletes the outbox, but the local rows still hold the newer edit, so the overwrite is silent.
- Fix options (pick one with the lead):
  1. Refuse to forget while any record is pending, and say so in the Settings copy: "Sign in and sync first, or export a backup." This is the minimum.
  2. Keep baselines when the cache is cleared, so the next pass resumes from the last revision seen.
  3. On first sync or after a cache clear, do not overwrite a local row whose payload differs from the server's. Store a conflict record and show it. This is the LOGIC-10 fix.
- Needs other owner: `src/cloud/index.ts` (sync), copy in `src/pages/Settings.tsx` (lead). Minimum change for option 1:
  ```ts
  // src/cloud/index.ts, inside forgetCloudCache(), before metadata.records.clear()
  const pending = await metadata.records.filter((row) => !!row.pending).count();
  if (pending)
    throw new Error(
      `${pending} changes have not reached your cloud project. Sign in and sync, or export a backup, before clearing the sync cache.`,
    );
  ```
- Regression test: the R2 scenario with a fake adapter, asserting the newer local edit survives, or that `forgetCloudCache` refuses with pending records.
- Status: OPEN at HEAD (reproduced). Re-check in working tree; the sync owner's `backend-sync-engine` has a "keeps the displaced version" test, which may cover part of this.

## ARCH-3: Ticking an ingredient on Recipe Detail with nothing cooking starts a cook and blocks other recipes

- Severity: P2
- Module / file:line: `src/lib/db.ts:316-355` (`patchActiveCooking`), `:480-507` (`setCookingCheck`), HEAD; `src/pages/RecipeDetail.tsx:499-510` and `:571-580` (checkboxes shown whether or not cooking has started)
- Reproduction steps + evidence: `npx tsx scripts/backend-audit/tmp/inventory/repro.ts r3`
  ```
  activeCooking after one ingredient tick: chicken-tikka
  startCooking(other) rejected: Cooking changed in another tab. Review your active recipe and try again.
  ```
  A single checkbox on the detail page starts cooking. Starting any other recipe then fails until the user stops cooking.
- Root cause: `patchActiveCooking` creates the `active` row when none exists (`current` falls back to a new object) and does not require a start. `setCookingCheck` passes `null` as the expected id when nothing is cooking, so the guard passes.
- Second part: the rejection message says "in another tab" when the change was made in the same tab (`db.ts:283`).
- Fix: storage: `setCookingCheck` and `patchActiveCooking` (called from the checkbox path) should require an existing active row for the same recipe. Lead: RecipeDetail should disable ingredient checkboxes until cooking has started, or the first tick should start cooking on purpose. Neutral error text for the guard.
- Needs other owner: `src/lib/db.ts` (storage). Exact change for `setCookingCheck` (inside its transaction, before `patchActiveCooking`):
  ```ts
  const active = await database.activeCooking.get("active");
  if (active?.recipeId !== recipeId)
    throw new Error("Start cooking this recipe before ticking its steps.");
  ```
  And in `assertActiveCooking` change the message to "Cooking changed. Review your active recipe and try again."
- Regression test: `setCookingCheck` with no active cook throws and writes no `activeCooking` row; existing CookMode tests still pass.
- Status: OPEN (reproduced).

## ARCH-4: Merge import replaces the active cook without the single-cook guard

- Severity: P2
- Module / file:line: `src/lib/db.ts:647-663` (`importBackup` merge branch), HEAD line numbers 653-661
- Reproduction steps + evidence: `npx tsx scripts/backend-audit/tmp/inventory/repro.ts r5`
  ```
  active recipe after merge: salmon-bake
  ```
  Local was cooking `chicken-tikka`. A backup with a later `updatedAt` for `activeCooking` replaced it.
- Root cause: `activeCooking` is a single row with id `"active"`. The merge compares only `updatedAt` per row and so applies another device's cook over the current one.
- Fix: skip the `activeCooking` row when the current device is cooking a different recipe. Make the Settings copy say that the active cook is kept.
- Needs other owner: `src/lib/db.ts` (storage). Exact change in the merge branch:
  ```ts
  const cookingNow = current.activeCooking[0]?.recipeId;
  const incoming = backup.activeCooking.filter(
    (row) => !cookingNow || row.recipeId === cookingNow,
  );
  // use `incoming` for name === "activeCooking" in place of backup[name]
  ```
- Regression test: merge with a different active cook keeps the local cook; merge with the same recipe updates timers and checks.
- Status: OPEN (reproduced).

## ARCH-5: The sync RPC fails for every write unless the function owner bypasses RLS

Note: SYNC-12 reaches the same precondition and recommends a pre-flight check. This finding recommends removing `FORCE`, which removes the precondition. The lead chooses (see section 10).

- Severity: P1 (latent; becomes an outage when the migration is applied as written)
- Module / file:line: `supabase/migrations/202610110001_airfuel_sync.sql:16` (`alter table ... force row level security`), `:24-44` (RPC, `security definer`)
- Reproduction steps + evidence: `node scripts/backend-audit/tmp/inventory/sql-check.mjs` (PGlite 0.5.8, stub `auth` schema, migration run as an owner role).
  ```
  == owner role with BYPASSRLS=false
  A writes via RPC: new row violates row-level security policy for table "airfuel_user_records"
  ```
  With `BYPASSRLS=true` the same call succeeds. `sql-check-noforce.mjs` removes `FORCE ROW LEVEL SECURITY`; with that change the RPC succeeds in both owner configurations, and direct writes by `authenticated` are still denied and cross-user reads still return zero rows.
- Root cause: `FORCE ROW LEVEL SECURITY` applies RLS to the table owner too. The RPC runs as the owner (`security definer`). The table has no insert, update or delete policy, so the owner's writes are denied unless the owner role has `BYPASSRLS`. The sync owner's RLS test documents this precondition (`tests/unit/backend-sync-rls.test.ts:286`) but does not remove it.
- Fix: remove `FORCE`. Table owners then bypass RLS as normal. The `authenticated` role is still limited by its select policy and by the revoked grants, so there is no new exposure.
- Needs other owner: `supabase/migrations/202610110001_airfuel_sync.sql` (sync, lead approval). Exact diff:
  ```diff
  -alter table public.airfuel_user_records force row level security;
  ```
  Live check before applying: `select rolname, rolbypassrls from pg_roles where rolname = 'postgres';`.
- Regression test: `sql-check-noforce.mjs` assertions, moved into `backend-sync-rls.test.ts` against the PGlite database (the test currently only documents the precondition).
- Status: OPEN. The migration has not been applied anywhere, so no data is affected.

## ARCH-6: Client limits accept records that the server rejects

- Severity: P2
- Module / file:line: `src/lib/schema.ts:9-10,68-133,258-265` (recipe and custom recipe limits: 100 steps × 10,000 characters, 100 ingredients), `supabase/migrations/...sql:13` (`bounded_payload` 524,288 bytes), HEAD.
- Evidence: a custom recipe with 60 steps of 9,000 characters passes `customRecipeSchema`; the same record exceeds the server bound (ARCH-1 repro). `sql-check.mjs` shows the server rejects 600 KB payloads.
- Root cause: the two limits were set independently.
- Fix: add a serialised-size refine to `customRecipeSchema` (and the backup row schemas) so a record the server cannot store is refused at save time, with a readable message. Set the client limit below the server limit (for example 500,000 bytes of JSON).
- Needs other owner: `src/lib/schema.ts` (storage). Exact addition:
  ```ts
  export const customRecipeSchema = z
    .object({ ...metadata, recipe: recipeSchema })
    .strict()
    .refine((v) => JSON.stringify(v).length <= 500_000, "This recipe is too large to save. Shorten the method or ingredient text.")
    .refine(/* existing id checks */);
  ```
- Regression test: a custom recipe at the limit saves; one over the limit is rejected with the message and writes nothing.
- Status: OPEN. Schema change is validation only (no Dexie version change).

## ARCH-7: Account change after sign-out shows a false "account changed in another tab" error

- Severity: P2
- Module / file:line: `src/cloud/index.ts:74-98` (auth listener), HEAD
- Evidence: code reading only. Not reproduced: the listener needs Supabase auth events.
  - `enabledUserId` is set by `enableSync` (line 164) and is never cleared on `SIGNED_OUT` (lines 75-84).
  - After sign-out, `signIn` with a different account fires `SIGNED_IN` with `session.user.id !== enabledUserId`, which sets phase `error` and shows "The account changed in another tab. Cloud sync stopped to protect account isolation."
- Root cause: the stale enabled user is not reset on sign-out.
- Fix: clear `enabledUserId` on `SIGNED_OUT`. Only check the account change while `status.enabled` is true.
- Needs other owner: `src/cloud/index.ts` (sync). Exact change:
  ```ts
  if (event === "SIGNED_OUT") {
    stopLoop();
    engine = undefined;
    enabledUserId = undefined;
    update({ phase: "signed-out", enabled: false, email: null, message: "..." });
  }
  // and in the SIGNED_IN branch: `if (event === "SIGNED_IN" && status.enabled && enabledUserId && ...)`
  ```
- Regression test: a unit test around a factory-injected auth listener (depends on ARCH-19).
- Status: NOT REPRODUCED. Treat as a code finding until a Supabase-backed or mocked-listener test confirms it.

## ARCH-8: Food-safety rule and ingredient parser live in a page; the safety rule has no unit test

- Severity: P2
- Module / file:line: `src/pages/CustomRecipes.tsx:15-260` (`parseNaturalIngredient` 72, `parseCustomIngredients` 118, `categoryMinimumC` 195, `proteinMinimumC` 201, `packagedIngredient` 211, `coreTemperatureRequirement` 214), HEAD. Similar logic in `src/components/CookingTimer.tsx:10-40` (timer transitions).
- Evidence: `tests/unit/custom-ingredients.test.ts` imports `src/pages/CustomRecipes` to reach the parser. `coreTemperatureRequirement` is referenced by no unit test; the e2e spec checks only the copy "74°C" (`tests/e2e/app.spec.ts:366`).
- Root cause: the safety rule is computed inside the form component, so it cannot be tested or reused without loading the page.
- Fix: move the parser, the category and protein minimums, and `coreTemperatureRequirement` into `src/lib/` (a `safety.ts` or `ingredients.ts` module). Pages import from lib. Add unit tests for every category, each protein pattern, the packaged-ingredient exceptions and the mixed-ingredient maximum.
- Needs other owner: lead (`src/pages/CustomRecipes.tsx`, `src/components/CookingTimer.tsx`), logic (new lib module), and the custom owner's test file import path. The brief forbids editing other agents' test files, so the import change in `custom-ingredients.test.ts` needs that owner.
- Regression test: new `tests/unit/backend-safety-core-temperature.test.ts`.
- Status: OPEN.

## ARCH-9: Overrides freeze nutrition, ingredients and steps; catalogue corrections do not reach them

- Severity: P2. DECISION: the storage suite asserts this as intended (`tests/unit/backend-storage-invariants.test.ts:430`, "an override freezes a full copy of the recipe, so a later catalogue correction does not reach it").
- Module / file:line: `src/lib/db.ts:445-466` (`saveOverride` stores the full recipe), `src/lib/engine.ts:28-62` (`effectiveRecipes` merges only safety fields with the catalogue), HEAD
- Reproduction steps + evidence: `npx tsx scripts/backend-audit/tmp/inventory/repro.ts r9`
  ```
  catalogue protein: 9 -> corrected: 19 | shown after override: 9
  stale: the catalogue correction is hidden
  ```
- Root cause: the override row is the whole recipe at the moment of the first edit. `effectiveRecipes` replaces the catalogue entry with the stored copy, then re-applies safety fields (internal temperature maximum, allergen union, dietary intersection, `oilFree` AND, safety union). Non-safety fields come from the copy.
- Why it matters: a corrected nutrition figure, ingredient amount or allergen name does not reach a user who adjusted that recipe. The safety merge covers the temperature and allergen cases, so the main risk is nutrition and ingredients.
- Fix options:
  1. Keep as a documented decision. Add a line to the Help copy that personal adjustments do not follow catalogue updates.
  2. Store only the user-editable fields (`temperatureC`, `cookMinutes`, `totalMinutes`, `steps`) and merge them over the live catalogue entry in `effectiveRecipes`. This needs an overrides format change with a read fallback for existing rows.
- Needs other owner: decision by the lead. If option 2, `src/lib/db.ts` and `src/lib/engine.ts` (storage and engine).
- Regression test (option 2): a catalogue correction to `nutrition` appears in the effective recipe; the user's `temperatureC` stays.
- Status: DECISION.

## ARCH-10: Three action members have no callers; `saveActiveCooking` bypasses the cross-tab guard

- Severity: P3 (P2 if anything starts calling `saveActiveCooking`)
- Module / file:line: `src/lib/db.ts:360-361` (`deleteRecipeState`), `:367-368` (`saveSession`), `:508-519` (`saveActiveCooking`), HEAD
- Evidence: `grep` finds no call sites outside `db.ts`. `saveActiveCooking` (`db.ts:508`) unconditionally puts or deletes the `active` row; it is the only write path to `activeCooking` without an expected-id check. `tests/unit/backup-all-tables.test.ts` calls it.
- WT status: STO-8 added an expected-id guard to `saveActiveCooking`. The guard applies only when the argument is passed, so an omitted argument still bypasses it.
- Fix: remove `deleteRecipeState` and `saveSession` from the API. For `saveActiveCooking`, make the expected id required, or remove the member. Update the one test that uses it.
- Needs other owner: `src/lib/db.ts` and `tests/unit/backup-all-tables.test.ts` (storage). Exact change: delete lines 360-361 and 367-368 and the `saveActiveCooking` member.
- Status: OPEN (dead members and the omitted-argument hazard).

## ARCH-11: Declared dependencies and lint rules that are not wired

- Severity: P3
- Module / file:line: `package.json` (devDependencies `eslint-plugin-react-hooks`, `prettier`), `eslint.config.js` (no react-hooks config, no prettier config), HEAD
- Evidence: `grep` finds no import of `eslint-plugin-react-hooks` in `eslint.config.js` or `src/`; `prettier` has no config file and no script. `react-hooks` rules would catch the `useEffect` patterns in the pages.
- Fix: either wire `react-hooks` into the flat config (check the v7 flat-config export through Context7 before editing) and run lint, or remove the package. Remove `prettier` unless a formatting step is added.
- Needs other owner: lead (`eslint.config.js`, `package.json`).
- Status: OPEN.

## ARCH-12: Two page flows write many rows in separate transactions

- Severity: P2 (partial writes; recoverable by the user)
- Module / file:line: `src/pages/RecipeDetail.tsx:259-275` (`addShopping`: one `saveShopping` per ingredient), `src/pages/Planning.tsx:492-510` (`clearTicked`: one `deleteShopping` or `saveShopping` per row), HEAD
- Evidence: each `actions.saveShopping` is its own transaction and prunes the table (ARCH-16). A failure partway through leaves some rows written and some not. There is no batch action, and no test covers a mid-loop failure.
- Fix: add `saveShoppingBatch(rows)` and `deleteShoppingBatch(ids)` actions that run one `rw` transaction, and call them from the two pages.
- Needs other owner: `src/lib/db.ts` (storage) for the actions; lead for the two page call sites. Exact new action (storage):
  ```ts
  async saveShoppingBatch(rows: Input<ShoppingItem>[]) {
    return database.transaction("rw", database.shopping, async () => {
      await pruneStaleGeneratedShopping(database.shopping, localDate());
      for (const row of rows) await save("shopping", shoppingSchema, row);
    });
  },
  ```
  Note: `save` opens a nested transaction; Dexie allows this inside the same table scope.
- Regression test: a batch with one invalid row writes nothing.
- Status: OPEN.

## ARCH-13: Raw server text in sync status; same-tab cooking error says "another tab"

- Severity: P3
- Module / file:line: `src/cloud/supabase.ts:108` and `:134` (`Cloud write failed: ${error.message}`, `Cloud read failed: ...`), `src/cloud/index.ts:250-262` (status message is the raw error text), `src/lib/db.ts:283` (guard message), HEAD. Frontend LOGIC-2 covers raw text in save toasts.
- Fix: map Supabase errors to a short fixed message for the UI and keep the raw error in `cause`. Change the guard text (ARCH-3).
- Needs other owner: sync (`supabase.ts`, `index.ts`), storage (`db.ts`).
- Status: OPEN.

## ARCH-14: Duplicate bounds and two amount-formatting rule sets

- Severity: P3
- Module / file:line: `src/pages/CustomRecipes.tsx:249-260` and `src/components/SessionForm.tsx:9-16` (both define numeric bounds for servings, minutes and temperature); `src/components/context.tsx:23-43` (`formatAmount` for recipe amounts) and `src/lib/engine.ts:477-494` (`formatShoppingAmount` for shopping amounts). HEAD.
- Fix: derive form bounds from the zod schema limits (export them from `schema.ts`). Keep two amount formatters but document that recipe amounts and shopping amounts follow different rules, or share the spoon tables.
- Needs other owner: logic (`schema.ts`, `engine.ts`), lead (pages and `context.tsx`).
- Status: OPEN.

## ARCH-15: Unused Dexie secondary indexes; full-table read on every change

- Severity: P3 (debt). Do not change now: a schema change needs a version bump and the brief forbids it without a P0/P1 need.
- Module / file:line: `src/lib/db.ts:44-54` (declared indexes), `:101-121` (`readKitchen`, `useKitchen`), HEAD
- Evidence: the only indexed query in `src/` is a primary-key `startsWith` (`db.ts:140-141`). Indexes on `sessions.recipeId`, `sessions.date`, `plans.date`, `plans.recipeId`, and `updatedAt` on every table are maintained on each write and not queried. `useKitchen` re-reads all nine tables on each change.
- Fix (later, with a version bump): drop unused indexes. For reads, use `useLiveQuery` per table or a narrower query.
- Needs other owner: storage, after the lead approves a version bump.
- Status: DEBT.

## ARCH-16: Generated shopping rows persisted as snapshots; prefix contract is implicit

- Severity: P3
- Module / file:line: `src/pages/Planning.tsx:476-500` (saves full derived rows with `id: scope + row.id`), `src/lib/db.ts:127-149` (regex `^week-(\d{4}-\d{2}-\d{2}):`), `src/lib/engine.ts:437` (`generated:${key}`), HEAD
- Evidence: when a generated row is ticked or cleared, the full derived row (name, aisle, unit, quantity) is stored. Reads use only `checked` and `quantity` (`buildShoppingList`). Stored name and aisle are stale after a recipe change, and they appear in backups. The prefix `week-…:` is built in `Planning.tsx:478` and parsed in `db.ts:131`; both are needed for pruning.
- Fix: store only `id`, `quantity`, `checked`, `manual: false` for generated rows. Put the scope builder and regex in one exported helper in `engine.ts` and use it in both places.
- Needs other owner: engine (helper), storage (`db.ts`), lead (`Planning.tsx`).
- Status: OPEN.

## ARCH-17: Sync uploads `viewedAt`, a device view log

- Severity: P3 (disclosure and data minimisation)
- Module / file:line: `src/cloud/core.ts` (recipeStates payload is the whole row), `src/lib/db.ts:203-240` (`viewedAt` written on every recipe open), `src/cloud/API.md` (lists notes, preferences and cooking activity, not views). HEAD
- Evidence: `recipeStateSchema` includes `viewedAt`, and `scanLocal` sends the whole validated row. Opening a recipe creates a sync change (`updatedAt` is not bumped for `viewedAt` alone, but the payload still changes and is re-sent).
- Fix: exclude `viewedAt` from the wire payload, or disclose it in the Settings sync copy and `API.md`.
- Needs other owner: sync (`core.ts`), lead (Settings copy).
- Status: OPEN.

## ARCH-18: Unchecked boundary casts and one `!` on `Intl` output

- Severity: P3
- Module / file:line: form-data casts `src/pages/Settings.tsx:158,164,165`, `src/pages/Planning.tsx:348`, `src/pages/CustomRecipes.tsx:509,960`; `src/lib/engine.ts:505` (`parts.find(...)!.value`), HEAD
- Evidence: each cast is followed by a zod parse in the action layer, so bad values are rejected at save time, but the TypeScript type is asserted at the call site. `engine.ts:505` assumes `Intl.DateTimeFormat.formatToParts` returns each part; this holds for supported locales but is not checked.
- Fix: parse at the boundary (`preferenceSchema.shape.theme.parse(...)`) and replace the `!` with a fallback.
- Needs other owner: lead (pages), engine (`localDate`).
- Status: OPEN.

## ARCH-19: Cloud orchestration is only partly tested

- Severity: P2 (test gap that let ARCH-2 and ARCH-7 through)
- Module / file:line: `src/cloud/index.ts` (317 lines at HEAD). `tests/unit/cloud.test.ts` covers `core` and `supabase`. Since then, `tests/unit/backend-sync-transport.test.ts` (13 tests) imports `forgetCloudCache` and `syncDisplayState`. Neither `signIn`, `enableSync`, the `syncNow` backoff and offline scheduling, nor the auth listener (ARCH-7) is tested. The `forgetCloudCache` test expects the baseline reset, so it does not catch ARCH-2.
- Root cause: `index.ts` uses module singletons (`metadata = new SyncDB()`, `client`, `engine`, `status`) and reads `import.meta.env` directly, so it cannot be instantiated in a test.
- Fix: wrap the module in a factory, `createCloudController({ db, metadata, config, getClient })`, that the exported functions delegate to. Then test `signIn` refusal while running, `enableSync` without Web Locks, `syncNow` backoff and offline scheduling, `forgetCloudCache` refusal rules, and the auth-listener account check (ARCH-7).
- Needs other owner: sync (`src/cloud/index.ts`).
- Regression test: new `tests/unit/backend-cloud-controller.test.ts`.
- Status: OPEN (partly covered in WT by `backend-sync-transport.test.ts`).

## ARCH-20: One invalid stored row blocks export and preview

- Severity: P3
- Module / file:line: `src/lib/db.ts:524-533` (`snapshot` runs `backupSchema.parse` on everything), `:534-538` (`exportBackup`), HEAD
- Evidence: `snapshot` fails on the first row that does not validate. The export button then fails, so the user cannot save a backup of the rest of their data. Rows are validated on write, so this needs a row written by an older build or edited by hand; no current path is known to produce one.
- Fix: export valid rows and report the invalid ones, or quarantine them. A backup must still be valid JSON under `backupSchema`, so the export can skip invalid rows and list their IDs.
- Needs other owner: storage (decision on quarantine behaviour).
- Status: OPEN (edge case).

## ARCH-21: `enableSync` builds a discarded engine; `engine` state only gates `syncNow`

- Severity: P3
- Module / file:line: `src/cloud/index.ts:148-173` (`candidate` engine, `engine = candidate`), `:198-200` (`syncNow` checks `engine` and builds `currentEngine`), HEAD
- Fix: remove `engine` and use `status.enabled` alone as the gate, or use `engine` for the pass instead of building `currentEngine` each time.
- Needs other owner: sync.
- Status: OPEN.

## ARCH-22: `readAll` offset paging can skip rows during concurrent writes

- Severity: P3 (self-heals on the next pass)
- Module / file:line: `src/cloud/supabase.ts:122-150` (`readAll` with `.range(page*500, ...)`), HEAD
- Evidence: code reading. A row inserted by another device with a primary key that sorts before the current page shifts later rows by one, so one row can be skipped in this pass. The next pass reads all rows again.
- Fix: keyset pagination (`.gt` on `(entity, record_id)`) or a single cursor RPC.
- Needs other owner: sync.
- Status: OPEN (not reproduced).

---

## ARCH-23: A record classed as permanent is never retried; RLS denial (42501) counts as permanent

- Severity: P1 (sync defect; no self-heal on the device)
- Module / file:line: `src/cloud/core.ts:401-418` (WT: `if (!state.pending || state.blocked) continue;` and the `blocked` write), `src/cloud/supabase.ts` (WT: `postgrestErrorKind` maps `42501`, `22*` and `23*` to permanent)
- Reproduction steps + evidence: `npx tsx scripts/backend-audit/tmp/inventory/repro.ts r6` (working tree). A stub PostgREST client returns SQLSTATE 42501, the same denial ARCH-5 produces. The real `createSupabaseAdapter` is used.
  ```
  run 1 (RLS denied): rejected= 2 pending= 0
  run 2 (server fixed): attempts= [] rejected= 2 pending= 0
  still blocked on this device: needs manual recovery
  ```
  After the server is fixed, the device makes zero attempts. Both records stay blocked.
- Root cause: "permanent" means data that can never be accepted. SQLSTATE 42501 also covers missing grants and RLS denials, which are server configuration faults that can be fixed. The engine has no path that clears `blocked`. The only recovery in the code is `forgetCloudCache`, which clears the sync records and triggers the overwrite in ARCH-2.
- Fix:
  1. Split 42501 out as a separate `"config"` kind that is retried on later passes with the existing backoff, and that does not block the record.
  2. Add a user action that clears `blocked` only, so the user can retry rejected changes without clearing baselines. Show the rejected count in CloudSettings with a Retry button.
- Needs other owner: sync (`core.ts`, `supabase.ts`); lead (CloudSettings copy and button). Method for step 2 in `core.ts`:
  ```ts
  async retryRejected(): Promise<number> {
    let cleared = 0;
    for (const row of await this.metadata.records.toArray())
      if (row.blocked) {
        const { blocked: _blocked, ...rest } = row;
        await this.metadata.records.put(rest);
        cleared++;
      }
    return cleared;
  }
  ```
- Regression test: R6 as a Vitest case with a stub client. After `retryRejected()` and a healthy server, both records are sent and `rejected` is 0.
- Cross-ref: ARCH-5 (the server fault that produces this), ARCH-2 (the only current recovery path).
- Status: OPEN (reproduced in WT).

---

## 9. Re-run status (2026-10-11, about 21:00 AEDT)

HEAD column: exported with `git archive 3dea492` into `/private/tmp/claude-501/airfuel-backend/inventory/head` and run there. The live tree was not used for that column. The working-tree column was run against the live tree at the same time.

| Check | HEAD (3dea492) | Working tree | Finding status |
| --- | --- | --- | --- |
| R1 oversized record, plain `Error` from adapter | reproduced | reproduced (unclassified error still halts the pass) | ARCH-1 (see status), ARCH-6 |
| R7 SQLSTATE 23514 through the real adapter | not applicable (no classification at HEAD) | isolated: A blocked, B reached the server | ARCH-1 FIXED-VERIFIED for classified errors |
| R2 baseline reset overwrites a newer local edit | reproduced (v2 replaced v3) | reproduced | ARCH-2 OPEN |
| R6 permanently blocked records never retried | not applicable (HEAD halts the whole pass on any error) | reproduced | ARCH-23 OPEN |
| R3 ticking an ingredient starts cooking | reproduced | reproduced | ARCH-3 OPEN |
| R5 merge import replaces active cook | reproduced | reproduced | ARCH-4 OPEN |
| R9 override hides catalogue correction | reproduced | reproduced | ARCH-9 DECISION |
| SQL: owner without BYPASSRLS, migration as written | write fails (RLS) | not re-run (migration file unchanged in WT) | ARCH-5 OPEN |
| SQL: owner without BYPASSRLS, FORCE removed | write succeeds | not re-run | ARCH-5 fix verified on PGlite |
| Unit suite | 19 files, 109 tests pass | 361 tests: 356 pass, 5 fail in 4 files (new files from engine and storage owners) | not diagnosed by inventory |

Failing tests on the working tree, for the lead:
- `backend-engine-safety.test.ts`: "allergen exclusion is applied before ranking never recommends a recipe declaring an excluded allergen, in any mode, under maximum jitter" and "keeps a peanut recipe with a perfect score out of every peanut-excluding recommendation". These are safety claims, so the engine owner needs to look at them before anything ships.
- `backend-engine-scenarios.test.ts`: "diversity over a month of cooking does not feed the same recipe every day".
- `backend-engine-search.test.ts`: "filter combinations never leak every result satisfies every filter that was set, over 500 random combinations".
- `upgrade-interactions.test.ts`: "rapid and concurrent personal-memory interactions keeps unrelated edits during two-connection toggle bursts and after reopening".

Inventory did not run those tests in isolation or investigate them. They are new and may still be in progress.

## 10. Cross-references to other owners' findings (read at about 21:05 AEDT)

Other sweep agents have written `docs/backend/findings/sync.md`, `storage.md` and `engine.md`. Where they overlap, this is the mapping and the points where inventory disagrees.

| ARCH | Other finding | Relation |
| --- | --- | --- |
| ARCH-1 | SYNC-1 (FIXED-VERIFIED) | Same defect. The sync fix covers SQLSTATE-classified errors (R7 confirms). Plain `Error`s still halt the pass (R1). |
| ARCH-2 | SYNC-2 / LOGIC-10 (FIXED-VERIFIED) | SYNC-2 covers first-sync and concurrent same-record conflicts. It does not cover the `forgetCloudCache` baseline reset. R2 still reproduces in WT, so ARCH-2 stays OPEN. |
| ARCH-5 | SYNC-12 (OPEN, P3, recommendation only) | **Disagreement on the fix.** SYNC-12 confirms the same precondition and proposes a pre-flight check that the owner has `rolbypassrls`. Removing `FORCE ROW LEVEL SECURITY` (ARCH-5) makes the RPC succeed for either owner role, on PGlite, with no new exposure. The lead should choose: (a) keep `FORCE` and require `BYPASSRLS` (SYNC-12), or (b) remove `FORCE` (ARCH-5). Option (b) does not depend on the Supabase role setup. |
| ARCH-6 | SYNC-13 (OPEN, needs lead decision) | Same defect. Recommended fix is the schema-side size refine in ARCH-6, with the server bound left as is. |
| ARCH-9 | STO-6 (DECISION) | Same decision. |
| ARCH-10 | STO-8 (FIXED-VERIFIED) | Working tree `saveActiveCooking` now takes an expected id and refuses when it is passed. Omitting it still bypasses the guard, and no caller uses the member. Keep ARCH-10 for the dead members (`deleteRecipeState`, `saveSession`) and the omitted-argument hazard. |
| ARCH-15 | STO-9 (WONT-FIX, agreed by lead) | Same finding. Recorded as debt. |
| ARCH-19 | SYNC-4 (invalid local row stopped all sync, FIXED-VERIFIED) | The `scanLocal` detail in the function audit is now fixed. The test-gap part of ARCH-19 still stands: `src/cloud/index.ts` has no unit tests. |
| ARCH-20 | STO-1 (FIXED-VERIFIED) and STO-4 (FIXED-UNVERIFIED) | STO-1 covers a damaged local record blocking export and replace-restore. Treat ARCH-20 as covered; the quarantine behaviour was not re-checked here. |
| ARCH-23 | SYNC-1 and SYNC-6 (both FIXED-VERIFIED) | New. SYNC-1 made permanent errors non-blocking for other records. It did not address a permanently blocked record that is never retried. SYNC-12 notes that RLS denial becomes permanent, which is the same path. |
| ARCH-7 | SYNC-9 (VERIFIED, no change) | Different symptom. SYNC-9 checks the cross-account data guard. ARCH-7 is a stale `enabledUserId` that gives a false error message after sign-out. Not reproduced. |

Points where inventory found nothing new, so no finding: the `storage` agent's 'saveRecipeNotes' and 'toggle' guards (STO-2 and the stale-tab tests) and the `engine` agent's ENG-1 to ENG-12 fixes. Inventory did not re-verify those.

Open for the lead, from this section only:
1. ARCH-5 fix choice (remove `FORCE`, or keep `FORCE` and require `BYPASSRLS`).
2. ARCH-6 and SYNC-13 payload bound (schema refine or raised server constraint).
3. ARCH-23 retry path for permanently blocked records, including whether 42501 should be `"config"` rather than `"permanent"`.
4. The five failing tests in the working tree (section 9).
