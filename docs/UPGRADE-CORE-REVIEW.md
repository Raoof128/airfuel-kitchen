# Interaction and persistence review

Reviewed and changed on 11 October 2026. This review covers database actions and their regression tests; browser and visual results belong in the main quality report.

## Confirmed defects and fixes

| Finding | Change | Regression evidence |
| --- | --- | --- |
| Favourite and tried buttons could derive repeated writes from the same React state snapshot, losing rapid toggle intent. | `toggleRecipeState` reads and inverts the current saved value within a read-write transaction and returns the resulting state. | 50 rapid toggles for each field produce 25 true and 25 false results; a further toggle produces true. |
| Ordinary timer or checklist edits could replace a different active recipe. | Routine cooking patches and checkbox writes reject a conflicting recipe. Explicit replacement goes through `startCooking` with a checked expected recipe ID. | Two simultaneous starts produce exactly one successful claim; stale replacement, checklist and timer operations leave the winning activity untouched. |
| An unconditional stop could erase cooking started in another tab. | `stopCooking` checks the expected active recipe before deleting. | A stale stop targeting chicken cannot delete the later salmon activity. |
| A delayed checkbox or timer write could recreate a cook after completion. | Interactive callers can supply the expected active recipe ID; a missing activity then rejects the write. | After saving a completed session, guarded delayed writes fail, activity stays absent, and the journal and tried/rating state remain saved. |
| A preferences update in another tab remounted the Settings form and discarded an unsaved draft. | The form retains its baseline while dirty, announces incoming changes, and saves only changed fields. An explicit discard reloads saved preferences. | Browser regression assigned to the upgrade gauntlet; no browser result claimed in this core review. |
| Backup or deletion failures inside a native dialog could leave only an outside toast behind the modal. | Errors also appear inside the relevant dialog; synchronous guards prevent repeated restore/delete submissions. | Existing malformed-backup tests remain; final browser review verifies the dialog state. |
| Temporary note drafts in sessionStorage could survive the explicit deletion of saved personal data. | Confirmed deletion clears draft keys and broadcasts a reset. A storage event fallback and non-private reset marker cover other tabs and missed broadcasts. | Four helper tests cover local clearing, cross-tab message handling, duplicate deliveries, missed broadcasts and blocked storage. |

No database schema, migration, recipe, nutrition or history format changed. Database failures and stale-operation errors reject the action promise so the interface can show the error instead of reporting a successful save.

## Public action contracts

```ts
actions.toggleRecipeState(recipeId, "favourite" | "tried")
// Promise<RecipeState>; preserves unrelated personal fields.

actions.startCooking(recipeId, servings, expectedActiveRecipeId)
// expectedActiveRecipeId: string | null; null means the caller expects no cook.
// The same recipe resumes with its checks and timer; a different recipe resets them.

actions.patchActiveCooking(recipeId, patch, defaultServings?, expectedActiveRecipeId?)
actions.setCookingCheck(recipeId, kind, index, checked, defaultServings?, expectedActiveRecipeId?)
// Pass recipeId as the expected ID for ongoing cooking interactions.
// Omitting the expected ID permits creation when the slot is empty, for compatibility.
// A different existing recipe is always rejected by these two actions.

actions.stopCooking(expectedActiveRecipeId)
// Deletes only if that recipe is still active.
```

The expected ID is checked inside the same transaction as the write. A user confirmation should pass the ID observed when the confirmation was offered, rather than silently adopting a newer recipe at submit time. Rejection text: “Cooking changed in another tab. Review your active recipe and try again.” The older `saveActiveCooking` full-record API remains for compatibility and tests; interactive start and stop controls should use the guarded actions.

## Timer and completion review

Running timers already persist an absolute `timerEndsAt`. Reopening after the deadline retains the original deadline rather than starting another countdown. Paused timers retain their remaining seconds. Existing cooking completion writes the journal and tried/rating changes atomically and clears only matching activity; a normal journal edit leaves activity intact.

The UI should calculate pause time from `Date.now()` at the click and prevent overlapping timer submissions. The database does not schedule operating-system notifications while the app is closed. Expected recipe IDs distinguish competing recipes, not separate consecutive sessions of the same recipe; there is no persisted cooking-session generation identifier.

## Verification

Run from the repository root with Node 22.12 or newer:

```sh
npm test -- tests/unit/upgrade-interactions.test.ts
npm test -- tests/unit/note-drafts.test.ts
npm test
npx eslint src/lib/db.ts tests/unit/upgrade-interactions.test.ts
npx eslint src/pages/Settings.tsx
npm run typecheck
```

Results at this review point:

- New interaction suite: **9 tests passed**; note-draft privacy suite: **4 tests passed**.
- Complete unit suite at the latest run: **58 tests passed across 9 files**, including concurrent upgrade work.
- Targeted lint and project TypeScript checks: **passed**.

The new tests include 102 alternating toggles through two connections alongside a long note, rating and view updates; closing and reopening preserves all saved fields. They also verify tried timestamps, invalid-field rejection, conditional activity replacement, resume preservation, timer deadlines and completion protection. Tests use `fake-indexeddb` with two `KitchenDB` connections; the separate browser gauntlet remains responsible for actual browser tabs, controls, reload, accessibility and rendering evidence.
