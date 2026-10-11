# Settings findings (agent: settings, prefix SET)

Route: `/settings`. Owned: `src/pages/Settings.tsx`, `src/components/CloudSettings.tsx`.
Scripts: `scripts/frontend-audit/tmp/settings/` (probe1-5, axe.mjs, axe-modal.mjs, keys.mjs). Fixtures: `scripts/frontend-audit/tmp/settings/fixtures/`.
Screenshots: `docs/frontend/screenshots/agents/settings/`.

## SET-1: Appearance did not apply until Save
- Severity: P2
- Route / component / file:line: `/settings`, theme select, `src/pages/Settings.tsx` (theme `<select name="theme">`, form onChange)
- Defect (what a user sees): choosing Light/Dark changed nothing on screen. The theme only switched after "Save preferences", and the select then showed a dirty form.
- Root cause: theme was a regular form field, so it was applied only via the save path that updates `data.preferences` (App.tsx theme effect).
- Fix: theme select is intercepted in the form onChange and calls `changeTheme`, which persists `{ theme }` via `actions.savePreferences` immediately and syncs the form baseline. Rolls the select back if the save fails. `preferencesChangedElsewhere` now ignores `updatedAt` so the self-save does not show the "changed elsewhere" notice.
- Verification: `probe1.mjs`: after select, `data-theme` = dark with no dirty notice; reload keeps dark. `tsc` and `eslint` clean.
- Status: FIXED-VERIFIED

## SET-2: Wrong-schema backup shows raw Zod JSON
- Severity: P1 (confusing error, not data loss)
- Route / component / file:line: import input, `src/pages/Settings.tsx` (import onChange); origin `src/lib/db.ts` `previewImport`
- Defect: importing a valid JSON file that is not a backup displayed a raw JSON array of schema issues (`"code": "invalid_value", "path": ["format"] ...`).
- Root cause: `previewImport` lets the Zod error message escape unchanged.
- Fix: Settings catches errors whose message starts with `[` and shows "This file is not an AirFuel Kitchen backup. Choose a backup exported from Settings." (original error kept as `cause`).
- Needs other owner (logic): `src/lib/db.ts` `previewImport` should throw a plain Error instead of a Zod message; the Settings wrapper then becomes a fallback only. Exact change: wrap `schema.parse`/`safeParse` failures in `new Error("This file is not an AirFuel Kitchen backup...")`.
- Verification: `probe5.mjs`: message shown at 300, 900 and 1800 ms. Status of the lib change: NEEDS-OWNER.
- Status: FIXED-VERIFIED (UI layer); lib root cause NEEDS-OWNER

## SET-3: Invalid timezone shows raw Zod JSON on save
- Severity: P2
- Route / component / file:line: `src/pages/Settings.tsx` timezone input and save operation
- Defect: entering "Mars/Olympus" and saving showed `[ { "code": "custom", "path": ["timezone"], "message": "Invalid timezone" } ]` in the toast.
- Root cause: schema refinement error passed straight through `run`.
- Fix: timezone input sets `setCustomValidity` on change (native, blocks submit, plain message "Enter a timezone such as Australia/Sydney."). The save operation also replaces any remaining schema error with "Some preferences could not be saved. Check the highlighted fields and try again."
- Verification: `probe3.mjs`: no submit, `validationMessage` shows the plain text; a valid timezone saves.
- Status: FIXED-VERIFIED

## SET-4: Empty backup file reported as "not valid JSON"
- Severity: P3
- Route / component / file:line: import input, `src/pages/Settings.tsx`
- Defect: a 0-byte file gave "The backup is not valid JSON."
- Fix: explicit check: "This file is empty. Choose a backup exported from Settings."
- Verification: `probe2.mjs`: message shown for `empty.json`.
- Status: FIXED-VERIFIED

## SET-5: "Your recipes" link to /custom is not on Settings
- Severity: P3
- Update: FIXED-VERIFIED (see follow-up section below).
- Route / component / file:line: `src/pages/Settings.tsx` (no link); the only "/custom" link is in `src/pages/Explorer.tsx:131`.
- Defect: the lead's brief asked to check a "Your recipes" link to `/custom` on Settings. None exists.
- Root cause: never added to Settings.
- Fix: none at first; lead then approved a link, now added (see follow-up).
- Status: FIXED-VERIFIED (follow-up)

## SET-6: Import size limit differs between UI and lib
- Severity: P3
- Route / component / file:line: `src/pages/Settings.tsx` (10 MB check) vs `src/lib/db.ts:481` (20 MB check).
- Defect: none visible. Settings rejects files over 10 MB with a clear message; the lib would accept up to 20 MB.
- Status: WONT-FIX (intentional stricter UI limit; message matches the check)

## Verified with no defect found
- Save feedback: toast "Your kitchen preferences are saved" (role=status). Allergens, dietary, lists, avoid and oilFree persist across reload. Discard restores the saved values; dirty notice works.
- Export: downloads `airfuel-backup-<date>.json`; JSON has `format: "airfuel-kitchen"`, `version: 2` and all 9 tables plus `activeCooking`.
- Import: malformed JSON → "The backup is not valid JSON."; valid file → preview with counts; Replace is disabled until the confirmation checkbox is ticked; switching to Merge and back clears the checkbox; Escape closes; merge restore works and persists.
- Reset: "Delete everything personal" disabled until exactly `DELETE`; cleared data restores defaults after reload. Run in fresh contexts only.
- Cloud sync panel: unconfigured state shows "Local only · no data sent to a server"; zero console errors or page errors.
- Privacy and storage copy: present and accurate for this build.
- Axe (`axe.mjs`): 0 violations at 320/375/768/1440, light and dark. Modals (`axe-modal.mjs`, import and reset, light and dark): 0 violations.
- Overflow: 0 horizontal scroll at 320, 375, 768, 1440 (both themes); import modal at 320 dark has no overflow.
- Keyboard: the file input is focusable; `.file-button:focus-within` provides the focus ring (styles.css ~L1783).

## Not verified
- Cross-tab "changed elsewhere" notice with a second live tab (not exercised).
- 1024 width not captured (outside the brief's 320/375/768/1440 set).
- Visual review of every screenshot; only the 375 light full page was inspected in detail.

## Help page (`/help`, `Help` in Settings.tsx)

Audit script: `scripts/frontend-audit/tmp/settings/help.mjs`. Screenshots: `docs/frontend/screenshots/agents/settings/help-{320,375,1440}-{light,dark}.png`.

### SET-7: "About the recipes" copy is unclear and says "records"
- Severity: P3
- Route / component / file:line: `/help`, `Help` in `src/pages/Settings.tsx` (About the recipes section)
- Defect: "300 records are available…" uses database jargon. The next sentence ("Instructions are written for AirFuel; source-checking is not a claim…") reads as a contradiction.
- Fix: "300 recipes are available…" and "Instructions are adapted for AirFuel. Source checks confirm the research sources, not that AirFuel's adaptation has been kitchen-tested."
- Verification: `help.mjs` renders at all six combinations with 0 axe violations and 0 overflow.
- Status: FIXED-VERIFIED

### SET-8: External NSW link does not announce that it opens a new tab
- Severity: P3
- Route / component / file:line: `/help`, NSW Food Authority link in `Help` (target=_blank)
- Defect: screen-reader users get no warning the link opens a new window.
- Fix: visually hidden " (opens in a new tab)" via existing `.sr-only`.
- Verification: link text now reads "NSW Food Authority temperature guidance (opens in a new tab)".
- Status: FIXED-VERIFIED

### Help: checked, no defect
- Axe: 0 violations at 320, 375, 1440, light and dark. No horizontal overflow. No console errors.
- Heading order: h1 then h2 per card, no skips.
- Links: NSW link (external, target=_blank, rel=noreferrer); "Set up my kitchen" → `#/settings`; footer → `#/help`.

### Help: not verified (flag for review)
- Food-safety temperatures (poultry 74°C, mince/pork 71°C, fish 63°C, egg 71°C): VERIFIED-AGAINST-SOURCE. Lead checked the linked NSW Food Authority source (Guidelines for food service to vulnerable persons, Appendix 2): poultry 74, fish 63, egg dishes 71 and minced meat 71 all match. The source also lists 75°C for minced, stuffed, rolled, boned, mechanically tenderised and brine-pumped meat. Logged as an owner decision; no change made.

## Follow-up from lead (DS-8, SET-5, Help confirmation)

### SET-5 (update): "Your recipes" section added
- Severity: P3. Status: FIXED-VERIFIED.
- Change: new Settings section "Your recipes" with a short description and an `Open Your recipes` button linking to `#/custom`, placed before the danger section.
- Verification: `verify-batch.mjs`: link present at 320/375/1440, light and dark; clicking it navigates to `#/custom`; 0 axe violations; 0 overflow; no console errors.

### DS-8: `.backup-actions .button` font size
- Change: mobile media rule in `src/styles.css` raised 11px → 12px.
- Verification: the computed size is 14px at all tested widths because `src/styles/kitchen.css` (~L1223) sets 14px for the same selector, so the effective size meets the 12px minimum.
- Status: FIXED-VERIFIED.

### `--line` → `--line-control`
- Finding: no settings-owned control selector uses `--line` for a control border. Settings inputs, selects and buttons inherit the shared control borders, which already use `--line-control` (`src/styles.css` L77, L254, L361). The remaining `--line` uses on settings-related selectors are section dividers (`.settings-section` border-bottom), which are not controls.
- Change: none. Status: WONT-FIX (no settings-owned control uses `--line`).

### /help audit
- Confirmed (see earlier SET-7 and SET-8). Axe 0 violations at 320/375/1440 light and dark; no overflow; no console errors.

## LOGIC-6: inline navigator.storage.persist() replaced with lib helper
- Change: "Protect local storage" now calls `requestPersistentStorage()` from `src/lib/db.ts`. The UI keeps its own support check first, because the helper returns `false` when unsupported and the UI needs a distinct "unavailable" message.
- Verification: `tsc` and `eslint` pass; `persist.mjs` shows the grant-denied notice in headless Chromium.
- Status: FIXED-VERIFIED

## Cleanup: dead Zod rewrite removed from Settings import
- Change: removed the `startsWith("[")` rewrite in the import onChange. `previewImport` (src/lib/db.ts ~L562-587) now throws the plain sentence itself, so the branch was unreachable. The generic `run` error toast remains the fallback.
- Verification: `probe5.mjs` shows "This file is not an AirFuel Kitchen backup. Choose a backup exported from Settings. Problem at format." for the wrong-schema fixture. `tsc` and `eslint` pass.
- Status: FIXED-VERIFIED
