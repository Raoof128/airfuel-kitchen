# Migration audit (storage sweep)

All tests use fake-indexeddb with uniquely named databases, and every database is deleted afterwards. No real user data is touched. The legacy database is built with a Dexie instance at version 1, using the v1 store definitions copied literally from the pre-version-2 code.

Test file: `tests/unit/backend-storage-migration.test.ts` (7 tests, all passing across three consecutive runs).

## The v1 to v2 upgrade

The v2 upgrade (`src/lib/db.ts`, `KitchenDB` constructor) does two things:
1. Sessions: `servingsConsumed ??= 0`. Legacy cooking logs never prove consumption, so no value is inferred from `servingsPrepared`.
2. Preferences: missing keys get `defaultPreferences` values. Existing values win.

The store definitions are unchanged between v1 and v2.

| Case | Test | Result |
|---|---|---|
| Empty v1 database | "upgrades an empty v1 database without creating any rows" | Version 2, zero rows in every table. |
| Fully populated v1 (all nine tables, partial preferences, a legacy activeCooking, a custom recipe, an override, generated shopping) | "keeps every v1 record byte-for-byte except the two intended transforms" | Sessions equal the original plus `servingsConsumed: 0`. Preferences equal defaults plus the original. Every other table is identical in JSON. |
| Consumption is not inferred | "does not infer consumed servings from prepared servings on upgraded sessions" | `servingsPrepared: 4` becomes `servingsConsumed: 0`. |
| Corrupt and thin v1 rows | "leaves corrupt and oddly-shaped v1 rows in place rather than deleting them" | `rating: "five"` and `notes: 42` survive. Thin rows gain only `servingsConsumed`. |

Note: the upgrade does not validate. A corrupt v1 row therefore opens and reads, and it is reported at export time (STO-1).

## Upgrade failure and rollback

Method: the v2 preferences step reads `Object.entries(defaultPreferences)`. A getter that throws is injected onto `defaultPreferences` for the duration of the test. The sessions step runs first and changes rows in the same versionchange transaction, so a correct rollback must undo that step as well. The injected getter is removed in a `finally` block.

| Check | Result |
|---|---|
| `open()` rejects with the injected error | Passes. |
| Database version after the failure | Still 1 (`verno` is the plain version number in Dexie 4). |
| Every table, byte-for-byte | Identical to the pre-upgrade snapshot. No `servingsConsumed` on any session. |
| Retry with the failure removed | Upgrades to version 2 and applies both transforms. |

Tests: "rolls back a failing upgrade: the v1 data and version are both untouched", "completes the same upgrade cleanly on retry after the failure is gone".

## Blocked upgrade

Method: a raw IndexedDB connection opens version 10 (Dexie v1) with no `onversionchange` handler, which simulates a stale tab that does not respond.

| Check | Result |
|---|---|
| `blocked` event fires | Yes, with `oldVersion` 10 and `newVersion` 20. Waited on with `once("blocked")`, not a timer. |
| `open()` while blocked | Stays pending. Data is not touched. |
| After the holder closes | Upgrade completes, and the session has its transform. |
| `onUpgradeBlocked(callback, db)` | Callback fires once per blocked event. Unsubscribe works. |

Test: "waits, does not corrupt data, and reports a blocked upgrade while an old connection stays open".

Context: Dexie 4.4.6 installs a default `versionchange` handler that closes a responsive old connection (`node_modules/dexie/dist/dexie.mjs`, around line 5942). Only a non-responding holder blocks. The `blocked` default handler only logs. The app has no UI for it (STO-5, lead adding the message).

## Quota and storage failures during migration-adjacent writes

| Case | Test | Result |
|---|---|---|
| Quota on a memory write | "a quota error on a memory write rejects with a readable message and writes nothing" | Readable message; nothing written. |
| Quota on a multi-table cooking save | "a quota error while cooking-session save rolls back session and tried" | Session and tried both absent. |
| Quota during replace-restore | "a quota error during restore reads as a storage message…" | Readable message (STO-3). |
| Failure on the third table during replace | "a failure mid-replace leaves the previous state fully intact" | `readKitchen` identical before and after. |
| Failure during merge | "a failure mid-merge leaves the previous state fully intact" | `readKitchen` identical before and after. |

## Backup format as a migration boundary

- The backup format is version 2 and must equal the table set (verified against `db.tables`).
- A backup with version 1 or 3 is refused. There is no version-1 backup format in git history.
- Upgrade-then-export-then-preview on the same device reports zero conflicts (test "a v1 record that was upgraded still reads as identical to its own export"). This guards the sorted-key comparison.

## Open items

- STO-5 (blocked-upgrade UI): needs the App.tsx message. The mechanism is tested.
- No v3 migration exists. The STO-6 fix (patch-based overrides) would need one, and is deferred as a decision.
