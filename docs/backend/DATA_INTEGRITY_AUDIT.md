# Data integrity audit (storage sweep)

Scope: the Dexie schema in `src/lib/db.ts`, the zod contracts in `src/lib/schema.ts`, and the actions API. Findings with IDs are in `docs/backend/findings/storage.md`.

## Table inventory

| Table | Primary key | Secondary indexes (unused) | Required fields | Enums | Canonical or personal | Notes |
|---|---|---|---|---|---|---|
| `recipeStates` | `id` = recipe id | `updatedAt` | `tried`, `triedAt`, `favourite`, `rating` 1-5 or null, `notes` ≤10,000, `viewedAt` | none | personal | View-only rows have `updatedAt` 0. |
| `sessions` | `id` (uuid) | `recipeId`, `date`, `updatedAt` | `recipeId` slug, `date` ISO, `servingsPrepared`, `servingsConsumed` ≥0 | `rating` 1-5 | personal | Journal. Multiple per recipe by design. |
| `plans` | `id` (uuid) | `date`, `recipeId`, `updatedAt` | `recipeId`, `date`, `slot`, `servings` | `slot`: breakfast, lunch, dinner, snack | personal | No uniqueness on date+slot+recipe. Duplicates are allowed. Observation only. |
| `pantry` | `id` | `updatedAt` | `name`, `quantity`, `unit`, `form` | unit: g, ml, each, tsp, tbsp | personal | |
| `shopping` | `id` (deterministic for generated rows) | `updatedAt` | as pantry + `aisle`, `checked`, `manual` | as pantry | personal (manual) / derived (generated) | Generated rows pruned after 28 days; manual rows never pruned. |
| `customRecipes` | `id` (must start `custom-`) | `updatedAt` | full `recipeSchema` | recipe enums | personal | Only custom content. |
| `overrides` | `id` = catalogue recipe id | `updatedAt` | full `recipeSchema` | recipe enums | personal | Full copy, not a patch (STO-6). |
| `preferences` | `"preferences"` (singleton) | none | all keys, IANA timezone | theme, dietary, allergens | personal | Upgrade fills defaults. |
| `activeCooking` | `"active"` (singleton) | none | `recipeId`, `servings`, checklists ≤100, timer ≤86,400 s | none | personal | Replace or clear only with the expected recipe (STO-8). |

Schema version 2. Store definitions and backup format version 2 are unchanged by this sweep.

## Referential integrity

- No foreign keys exist. Sessions, plans, recipe states and overrides reference recipe ids that may come from the catalogue, from custom recipes, or from nothing (after deletion or an id change).
- Catalogue update: `effectiveRecipes` builds from the bundled catalogue and stored data, so a catalogue change never deletes personal rows. Test: "personal records for a recipe that disappears from the catalogue survive untouched".
- Missing recipe in nutrition: `consumedNutrition` counts it in `missingRecipes` and adds zero, so it never reads as zero protein silently. Test: "nutrition counts a session for a missing recipe as missing…". Note: `missingRecipes` is a count, not a list.
- Missing recipe in shopping: `buildShoppingList` skips the plan without throwing. Test: "a plan that points at a missing recipe is skipped…".
- Custom recipe deletion: history is kept, and memory and plans are left behind (STO-7, DECISION).
- Override base removed: the override row remains and is ignored by `effectiveRecipes`. Nothing reads it, and it is not cleaned up (P3 observation, covered by STO-7's decision).

## Smart-memory invariants (test-backed)

| Invariant | Test |
|---|---|
| Opening a recipe does not mark it tried | "opening a recipe does not mark it tried" |
| Tried persists across reopen; undo clears tried and triedAt; re-try sets a new triedAt | "tried persists across reopen, and undo clears it…" |
| Cooking the same recipe twice creates two sessions | "cooking the same recipe twice creates two distinct sessions…" |
| Session rating sets recipe rating; clearing the session keeps it | "a session rating sets the recipe rating…" |
| Editing a note leaves tried, favourite, rating and triedAt alone | "editing a note does not overwrite tried, favourite or rating" |
| Deleting one session keeps recipe state and other sessions | "deleting one session keeps the recipe state…" |
| Tried is not consumed: no eaten servings means no protein | "tried is not consumed…" |
| Rapid toggles from two tabs converge to the press parity (31 + 29 = even → false) | "rapid toggles from two tabs converge…" |
| Two stale tabs saving notes: one wins, the other is refused | "two stale tabs saving notes…" |
| `updatedAt` stays strictly increasing even if the clock moves back | "an update that restarts the clock…" |

## Write failures and validation

| Case | Test |
|---|---|
| Quota on a memory write rejects with a readable message; nothing written | "a quota error on a memory write…" |
| Quota during cooking-session save rolls back session and tried | "a quota error while cooking-session save rolls back…" |
| Validation error is rejected once, not retried, and never reaches storage | "a validation error is rejected once…" |

The app has no retry logic anywhere (`grep retry` finds only a comment and a Settings URL revoke timer), so permanent validation errors cannot be retried.

## Backup and restore

- Format, version, export timestamp, and table coverage: "names every user table…" and "writes format, schema version and export timestamp…". The export keys equal the live Dexie tables exactly.
- No credentials: "contains no credentials, tokens or cloud settings" (key-name and JWT-shape scan of the export).
- Version handling: versions 1 and 3 are refused. No version-1 backup format exists in git history, so "older supported version" does not apply.
- Restore cases: empty (both modes), duplicate IDs in one file, corrupt JSON, unexpected field, missing field with path hint, 20 MB bound refused before `JSON.parse`, conflicts with newest-wins and tie-keeps-local, cancelled preview, stale or reused preview, viewing between preview and import.
- Failure injection: a failure on the third table write during replace, and a failure during merge, both leave the previous state byte-for-byte identical (`readKitchen` before and after).
- Limits: export refuses over 20 MB (STO-4). Import refuses over 20 MB.
- Merge vs replace: merge applies rows that are new or have a newer `updatedAt`. Replace clears every table and writes the backup, in one transaction.

## Decisions for the lead

- STO-6 (overrides as full copies): fixing it needs a patch-based override schema and a versioned migration. Not done.
- STO-7 (custom recipe deletion keeps history): kept on purpose. A later cleanup could remove orphan memory rows, but history must stay.
- STO-10 (device-clock ordering): documented last-writer-wins. A hybrid logical clock needs a format change.
- STO-9 (unused secondary indexes): WONT-FIX. Revisit only if a read path starts filtering by index.
