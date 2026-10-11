# Storage sweep findings (STO)

Scope: `src/lib/db.ts`, `src/lib/schema.ts`, `src/lib/noteDrafts.ts`, `src/lib/navigation.ts`, `src/lib/index.ts`, `src/lib/API.md`. Tests: `tests/unit/backend-storage-{migration,backup,invariants,active-guard}.test.ts`.

## STO-1: A damaged local record blocked export and replace-restore
- Severity: P1
- Module / file: `src/lib/db.ts` (`snapshot`, `previewImport`, `importBackup`, `exportBackup`)
- Reproduction: write `{ id: "broken", tried: "yes" }` straight into `recipeStates`, then call `previewImport` of a good backup.
- Evidence: before the fix the preview threw a raw ZodError (`expected number, received undefined` at `recipeStates.0.updatedAt`). Export threw the same raw JSON. A replace-restore, the way out, was impossible.
- Root cause: every read path validated the whole local database through `backupSchema`.
- Fix: `rawSnapshot` reads stored rows as they are. Export validates per table and names the first damaged record. Preview and import compare and fingerprint raw rows.
- Regression tests: "a corrupt record in the live database does not block replace-restore…", "export names a damaged record instead of dumping a raw validation error".
- Status: FIXED-VERIFIED

## STO-2: Opening a recipe invalidated an import preview
- Severity: P2
- Module / file: `src/lib/db.ts` (`dataFingerprint`)
- Reproduction: `previewImport`, then `patchRecipeState(id, { viewedAt })`, then `importBackup`.
- Evidence: before the fix the import rejected with "Your data changed after the preview". The documented rule is that viewing is not a change.
- Root cause: the fingerprint included `viewedAt` and view-only recipe rows.
- Fix: fingerprint ignores `viewedAt` and view-only rows (`updatedAt` 0), using the same comparison as conflict counting.
- Regression test: "opening a recipe between preview and confirm is not a data change".
- Status: FIXED-VERIFIED

## STO-3: Storage errors during import and export reached the user as raw browser text
- Severity: P2
- Module / file: `src/lib/db.ts` (`importBackup`, `exportBackup`, `previewImport`)
- Evidence: before the fix a quota failure during restore surfaced as "The quota has been exceeded.\n QuotaExceededError…". The memory actions already used `describeWriteError`; these three did not.
- Fix: all three wrap failures with `describeWriteError`. Our own sentences pass through unchanged.
- Regression test: "a quota error during restore reads as a storage message, not a raw browser error".
- Status: FIXED-VERIFIED

## STO-4: Export could produce a backup that could never be restored
- Severity: P2
- Module / file: `src/lib/db.ts` (`exportBackup`, `maxBackupBytes`)
- Evidence: `previewImport` refuses text over 20 MB, but export had no matching limit. Sessions allow 50,000 rows and notes up to 10,000 characters, so export could exceed the import limit.
- Root cause: the bound was enforced only on the import side.
- Fix: `exportBackup` refuses, without writing, output over `maxBackupBytes` (20 MB), with a readable message.
- Regression test: "refuses to export a backup that could not be restored under the 20 MB limit".
- Status: FIXED-UNVERIFIED. The guard is tested. I found the gap by reading the code and did not reproduce an over-limit export before the fix.

## STO-5: A blocked upgrade fails silently
- Severity: P2
- Module / file: `src/lib/db.ts` (`onUpgradeBlocked`); the UI is `src/App.tsx` (lead-owned)
- Evidence: a raw IndexedDB connection holding v1 open blocks the upgrade. The `blocked` event fires and `open()` stays pending. Dexie's default `blocked` handler only logs a console warning. Nothing in `src/` subscribes to `blocked`, so the app shows its loading state forever. Test: "waits, does not corrupt data, and reports a blocked upgrade…".
- Mechanism added: `onUpgradeBlocked(callback, database?)` returns an unsubscribe function. The callback fires once per blocked event, with no arguments.
- Needs other owner: `src/App.tsx`. The lead is adding the message.
- Status: NEEDS-OWNER (mechanism FIXED-VERIFIED)

## STO-6: Overrides freeze a full copy of the recipe
- Severity: P2
- Module / file: `src/lib/db.ts` (`saveOverride`); `src/lib/engine.ts` (`effectiveRecipes`)
- Evidence: test "an override freezes a full copy…" shows a catalogue correction (an added step) does not reach an overridden recipe. Only allergens, dietary, oil-free and temperature are re-clamped against the catalogue.
- Decision: keep for now. Fixing it means storing a patch, which changes the override schema and needs a versioned migration. Per the brief, that requires a P0/P1. Lead decision: DECISION.
- Status: DECISION

## STO-7: Deleting a custom recipe leaves its personal rows behind
- Severity: P3
- Module / file: `src/lib/db.ts` (`deleteCustomRecipe`)
- Evidence: test "deleting a custom recipe keeps its cooking history…" shows sessions, plans and memory rows remain.
- Decision: keep. History must not vanish on a catalogue or custom-recipe delete. Nutrition reports the gap as `missingRecipes`, and the shopping list skips missing plans without throwing.
- Status: DECISION

## STO-8: Unguarded `saveActiveCooking`
- Severity: P3
- Module / file: `src/lib/db.ts` (`saveActiveCooking`); `src/lib/API.md`
- Evidence: the only caller in the repo is `tests/unit/backup-all-tables.test.ts`, which seeds an active cook on an empty database. There was no conflict guard, so a write could replace another tab's cook.
- Lead decision: because a call exists, add the guard rather than remove the method. The guard is optional, matching `patchActiveCooking` and `setCookingCheck`, so the seeding test keeps working unchanged.
- Fix: `saveActiveCooking(input, expectedActiveRecipeId?)` refuses a replace or clear when the stored recipe differs from the expected one.
- Regression tests: `tests/unit/backend-storage-active-guard.test.ts` (4 tests, including a two-tab replace and a two-tab clear).
- Status: FIXED-VERIFIED

## STO-9: Secondary indexes are unused
- Severity: P3
- Module / file: `src/lib/db.ts` (`stores`)
- Evidence: the only `where` query in `db.ts` uses the primary key (`where(":id").startsWith("week-")`). Secondary indexes on `sessions`, `plans` and `updatedAt` are maintained on every write but never queried. All reads are full `toArray()`.
- Decision: changing the store definitions is a schema change and is not justified without a P0/P1. Data volume is small.
- Status: WONT-FIX (agreed by lead)

## STO-10: Merge ordering uses device clocks
- Severity: P3
- Module / file: `src/lib/db.ts` (`nextTime`, `importBackup`)
- Evidence: `updatedAt` is `Date.now()`, made monotonic per record. A device whose clock runs fast wins every later merge against the other device.
- Decision: last-writer-wins by device clock is documented behaviour. A hybrid logical clock would need a schema and format change. Lead decision: DECISION.
- Status: DECISION

## Regression guard (not a found defect)
- Conflict comparison now uses sorted keys, because the raw-read fix (STO-1) can see the same record with keys in a different order. The v1 upgrade appends `servingsConsumed` after the old keys. Test: "a v1 record that was upgraded still reads as identical to its own export".

## Functions audited
| Function | Disposition |
|---|---|
| `readKitchen` / `useKitchen` | OK. Reads without validation, by design. Whole-table reads (STO-9). |
| `patchRecipeState` | OK. Tried and triedAt are consistent; viewing does not set tried. |
| `saveRecipeNotes` | OK. Stale-tab guard verified with two connections. |
| `toggleRecipeState` | OK. Reads inside the transaction; parity holds under 31 and 29 concurrent presses. |
| `deleteRecipeState` | OK. Unguarded delete of one row. |
| `save` (generic) | OK. Monotonic `updatedAt`. |
| `saveCookingSession` | OK. Atomic session, tried and rating; rollback verified. |
| `saveSession` / `deleteSession` | OK. Session delete keeps recipe state and other sessions. |
| `startCooking` / `patchActiveCooking` / `setCookingCheck` / `stopCooking` | OK. Guarded; two-tab races covered by the existing suite. |
| `saveActiveCooking` | FIXED (STO-8). |
| `saveShopping` / `pruneStaleGeneratedShopping` | OK. Pruning only generated rows older than 28 days. |
| `savePreferences` | OK. Partial merge verified. |
| `saveCustomRecipe` / `deleteCustomRecipe` | DECISION (STO-7). |
| `saveOverride` / `deleteOverride` | DECISION (STO-6). |
| `clearUserData` | OK. Clears every table in one transaction. |
| `exportBackup` | FIXED (STO-1, STO-3, STO-4). |
| `previewImport` | FIXED (STO-1, STO-2, STO-3). |
| `importBackup` | FIXED (STO-2, STO-3). Replace and merge both roll back on failure. |
| `onUpgradeBlocked` | NEW (STO-5). |
| `describeWriteError` / `withUserErrors` | OK. |
| `requestPersistentStorage` | OK. Returns false when unsupported. |
| `noteDrafts.ts` (draft read, write, clear, reset broadcast) | Reviewed; existing `note-drafts.test.ts` covers it. No new defect found. |
| `navigation.ts` (`rememberExplore`, `exploreReturnLocation`) | Reviewed; hash allow-list and storage fallbacks are correct. No test added. |

## Security findings fixed in the storage files (from docs/backend/findings/security.md)

- SEC-2 (P2) FIXED-VERIFIED: `nextTime` is clamped to `timestampCeiling` (8640000000000000). A row imported at the maximum can be saved, toggled and noted. Test: `tests/unit/backend-storage-limits.test.ts`, "saves, toggles and notes a pantry row and recipe state imported at the maximum".
- SEC-3 (P1) FIXED-VERIFIED: `backupLimits` in `schema.ts` is the one source for the caps. `importBackup` merge counts the merged ids per table before any write and refuses over the cap. `save`, `patchRecipeState` and `saveOverride` refuse a new row at the cap. Tests: 600 + 600 custom recipes refused with nothing written; a merge exactly at 1000 allowed; the 1001st custom refused; editing at the cap still allowed.
- SEC-6 (P2) FIXED-VERIFIED: the `source.url` refine in `schema.ts` catches the `new URL()` exception and returns false. Relative, protocol-relative and malformed inputs are field issues. Test: `backend-storage-limits.test.ts`, SEC-6 block.
- Security agent's `it.fails` tests for SEC-2, SEC-3 and SEC-6 (`backend-security-integrity.test.ts`, `backend-security-input.test.ts`) now fail because the bug is fixed. Those files are not storage-owned; the security agent must remove the `.fails` markers. SEC-4 is still expected to fail (Settings.tsx, lead).

## Inventory findings (docs/backend/findings/inventory.md) fixed in the storage files

- ARCH-3 (P2) FIXED-VERIFIED: `setCookingCheck` no longer creates the active cook. With nothing cooking it throws "Start cooking this recipe before ticking its steps or ingredients." A tick on another recipe keeps the existing "Another recipe is already cooking" refusal. A tick for a cook that has finished reports "Cooking changed…", as before. Tests: `tests/unit/backend-storage-cook-shopping.test.ts` (ARCH-3 block, 4 tests).
  - Open: the guard text "Cooking changed in another tab…" (`db.ts`) is still asserted by `tests/unit/write-errors.test.ts`, which is not storage-owned. Changing it needs that file updated first. Left unchanged.
  - Open: `tests/unit/integration-hardening.test.ts` > "merges simultaneous checkbox and timer edits across database instances" ticks ingredients without starting a cook. It now fails by design of ARCH-3. It needs `await a.startCooking(fixture.id, 3, null)` before the concurrent block. Not edited (not storage-owned).
- ARCH-4 (P2) FIXED-VERIFIED: the merge branch applies an incoming `activeCooking` row only when nothing is cooking locally or the recipe is the same. Replace is unchanged and still takes the backup's cook. Tests: ARCH-4 block (4 tests).
- ARCH-12 (P2) FIXED-VERIFIED: `saveShoppingBatch(rows)` runs prune and all writes in one `rw` transaction (up to 500 rows). A validation or storage failure on any row writes none. `clearTickedShopping(weekStart)` deletes ticked manual items and unticks ticked generated rows for that Monday, in one transaction. Tests: ARCH-12 block (7 tests).

Page changes needed (lead):

`src/pages/RecipeDetail.tsx`, `addShopping` (about line 259): replace the per-ingredient loop with
```ts
await run(
  () =>
    actions.saveShoppingBatch(
      scaled.map((item, index) => {
        const id = `direct-${recipe!.id}-${index}`;
        return {
          id,
          name: item.name,
          quantity: item.quantity,
          unit: item.unit,
          form: item.form,
          aisle: item.aisle,
          checked: data.shopping.find((s) => s.id === id)?.checked ?? false,
          manual: true,
        };
      }),
    ),
  "Ingredients added to your shopping list",
);
```

`src/pages/RecipeDetail.tsx`, ingredient and step checkboxes (about lines 499-510 and 571-580): disable the checkboxes until this recipe is the active cook (`data.activeCooking?.recipeId === recipe.id`), or show "Start cooking to tick steps" beside them. ARCH-3 means a tick now fails with a toast when nothing is cooking.

`src/pages/Planning.tsx`, `clearTicked` (about lines 492-520): replace the loop over `tickedRows` with
```ts
const okay = await run(
  () => actions.clearTickedShopping(week[0]),
  "Ticked items cleared",
);
```
Keep the surrounding `setClearing` and close-modal code. `week[0]` is the Monday string from `weekDates`.

Settings copy (lead, ARCH-4): a merge keeps the local active cook when one is running; say so in the merge confirmation.

## ARCH-3 revised: recipe-page checks (lead decision)

Refusing ticks when nothing is cooking broke a real flow: people tick ingredients on the recipe page without starting Cook Mode. The revised shape:
- `recipeStates.checks` (optional) `{ ingredients: number[]; steps: number[] }`. Indexes 0-99, at most 100 per list. Optional, so older rows and backups stay valid. No Dexie version bump, because the field isn't indexed. Schema rejects extra keys inside `checks`.
- `setRecipeCheck(recipeId, kind, index, checked, length?)` writes only `recipeStates` in one transaction. It never touches `activeCooking`. With `length` (the recipe's ingredient or step count) an index at or beyond it is refused. The storage layer does not know recipe lengths, so the page passes them.
- `startCooking` seeds a new cook's checklist from `recipeStates.checks`. Resuming a cook already running for that recipe keeps its own checklist. A cook's ticks do not write back to the recipe page.
- `setCookingCheck` keeps the refusal when nothing is cooking, with the same message as before.
- Tests: `tests/unit/backend-storage-recipe-checks.test.ts` (27 tests across the recipe-page, schema/backup and seeding cases). `tests/unit/integration-hardening.test.ts` got the `startCooking` precondition the lead authorised.
- Status: FIXED-VERIFIED

## Red-team findings (docs/backend/BACKEND_REGRESSION_REPORT.md)

- RT-B1 (P2) FIXED, test marker still expected-fail: an import (merge or replace) now builds the full result first and refuses if the result, serialised the way export writes it, is over `maxBackupBytes`. The refusal names the size and writes nothing. Two 12 MB backups now merge once and refuse the second, with export still working. Tests: `backend-storage-sizes.test.ts` (RT-B1 block, 2 tests).
  - Not flipped: `backend-redteam-storage.test.ts` > RT-B1. Its body merges twice and expects the second merge to succeed, which the invariant now forbids. The body needs `await expect(mergeInto(target, { ...base, recipeStates: notesHeavy("b") })).rejects.toThrow(/MB of data/);` before the export assertion. That line is outside the `it.fails` marker, so I did not edit it. Needs lead approval.
  - Single writes: not guarded. Checking the serialised size on every write means serialising the whole database each time, which is not cheap. A single write can add at most one row's worth (10 KB notes, a 100-ingredient recipe). Reaching the limit by writes alone takes about 2,000 maximum-size notes. Merges are the realistic path, and they are guarded.
- RT-B2 (P2) FIXED-VERIFIED, flipped: incoming `updatedAt` values above the current time are capped at `now - 1` when a preview is made. A later genuine edit is strictly newer, so it wins a merge. Cap has no skew allowance on purpose: a 5-minute allowance would leave a poisoned row winning until the allowance passed. Local edits already stamp above any stored value (`nextTime`), including a future one written directly; tested. Stamps already stored above the current time (from before this fix) are not repaired by this change.
- RT-B7 (P3) FIXED-VERIFIED, flipped: the v2 upgrade replaces `null` preference values with defaults, the same as `undefined`. No preference column is nullable. Tests: `backend-storage-sizes.test.ts` (RT-B7 block) and the flipped `backend-redteam-migration.test.ts` > RT-B7.

