# Cook mode findings (agent: cookmode, prefix COOK)

Files owned: `src/pages/CookMode.tsx`, `src/components/CookingTimer.tsx`, `src/styles/cook-mode.css`.

## COOK-1: Servings input loses focus on every keystroke and saves partial values
- Severity: P1
- Route / component / file:line: `#/cook/<slug>` · `src/pages/CookMode.tsx` servings `<input>` (was ~line 283)
- Defect (what a user sees): While a cook is active, typing into Servings wrote each keystroke to the database. The input was disabled while the save ran, so focus fell to `<body>` after one character. Clearing the field reverted it to the old value, so "3" typed after clearing produced "23".
- Root cause: `onChange` called `setPortions` directly, and `disabled={busy}` removed focus.
- Fix: Added a local `servingsDraft` string. Typing only updates the draft. The value commits on blur or Enter via `commitServingsDraft`. Empty, invalid or out-of-range values revert to the saved portions. The input is no longer disabled while busy.
- Verification: `scripts/frontend-audit/tmp/cookmode/verify1.mjs` at 375×812. Focus stays in the Servings input after typing. Enter commits "3". Blurring with "0" reverts to 3. Reload keeps the saved value. Result: pass.
- Status: FIXED-VERIFIED

## COOK-2: Controls disabled during a save drop keyboard focus
- Severity: P1 (keyboard and screen-reader users lose their place)
- Route / component / file:line: `CookMode.tsx` portion +/- buttons, "Done, next step" button; `CookingTimer.tsx` Start/Pause, Reset
- Defect: Each `disabled={busy}` removed focus from the control just activated, so keyboard users had to re-Tab after every press.
- Root cause: busy state was expressed with the native `disabled` attribute.
- Fix: Busy state now uses `aria-disabled` with the existing `submitting` / `changingWakeLock` guards in the handlers. A scoped `.cook-mode [aria-disabled="true"]` rule gives the visual disabled state. Structural disabling (no active cook, a duration that is not valid) is unchanged.
- Verification: verify1.mjs shows focus remains on "+" after pressing it (value goes 3 → 3.5) and on the timer button after Start ("Pause timer", state Running). "Done, next step" also uses `aria-disabled`; its focus moves to the step heading on success, but I did not script this case separately.
- Status: FIXED-VERIFIED for +/- and timer; FIXED-UNVERIFIED for "Done, next step".

## COOK-3: Timer status live region was removed from layout when empty
- Severity: P2
- Route / component / file:line: `src/styles/cook-mode.css` `.cook-timer-status:empty`; `CookingTimer.tsx` `<p role="status">`
- Defect: `display:none` on the empty `role="status"` element removes it from the accessibility tree. Screen readers often skip announcements for live regions inserted that way, so "Time's up" may not be announced.
- Fix: Replaced `display:none` with `margin:0`, keeping the region in the layout.
- Verification: At runtime the status element exists (count 1) and shows "Time to check your food…" after expiry under a Playwright clock. Screen-reader announcement was NOT tested.
- Status: FIXED-UNVERIFIED (no screen reader run)

## COOK-4: Toggle buttons mixed a changing label with aria-pressed
- Severity: P2
- Route / component / file:line: `CookMode.tsx` "Done, next step / Mark step as unfinished" (aria-pressed) and "Keep screen awake / Screen stays awake" (aria-pressed)
- Defect: Screen readers announced a label that describes the action together with a pressed state, e.g. "Mark step as unfinished, toggle button, pressed". This is contradictory.
- Fix: Removed `aria-pressed` from the step button, whose label already describes the action. The wake-lock button keeps one stable label, "Keep screen awake", with `aria-pressed` carrying state. The status text in the `role="status"` paragraph already explains the on/off state.
- Verification: verify1.mjs confirms the wake-lock label stays "Keep screen awake". The announcement itself was not tested with a screen reader.
- Status: FIXED-UNVERIFIED (AT announcement not tested)

## COOK-5: Sub-12px text in cook mode (DS-8)
- Severity: P2
- Route / component / file:line: `src/styles/cook-mode.css` `.cook-eyebrow` (11px), `.cook-timer-state` (11px), `.cook-step-navigation > span` (11px), `.cook-topline > .cook-eyebrow` at ≤440px (9px)
- Defect: Eyebrow labels, the timer state and the step counter were 9–11px. Cook mode is read at arm's length, so this was hard to read.
- Root cause: Small uppercase sizes were used for labels and state text.
- Fix: `.cook-eyebrow` → 12px; `.cook-timer-state` → 13px; `.cook-step-navigation > span` → 13px (both the base and ≤440px rules); the ≤440px topline eyebrow → 12px.
- Verification: `scripts/frontend-audit/tmp/cookmode/verify2.mjs` at 320×640, 375×812 and 812×375. Computed sizes are 12/13/13/13px. No horizontal overflow. No text under 12px inside `.cook-mode`. Screenshots in `docs/frontend/screenshots/agents/cookmode/fontfix-*.png`. ESLint clean.
- Status: FIXED-VERIFIED

## COOK-6: Timer icon button under 44px and sub-12px timer small text (shared styles)
- Severity: P2
- Route / component / file:line: `src/styles.css` `.timer-controls .icon-button` (31px) and `.timer-panel small` / `.timer-panel .small` (10px)
- Defect: The reset icon was 31px, below the 44px touch target. The small timer text was 10px.
- Root cause: These legacy selectors were sized independently of the shared tap-target token.
- Fix: `.timer-controls .icon-button` → `var(--tap-min)` for width, min-width and min-height. `.timer-panel small` → 12px, and the ≤960px `.timer-panel .small` → 12px.
- Caveat: No current markup uses `.timer-panel` or `.timer-controls` (grep of `src/**/*.tsx` finds none). The live timer on the recipe page and in cook mode is `CookingTimer` with `.cook-timer`, which already measures 46px for its reset button and has no small text under 12px. The shared-rule edits are harmless and correct if that markup returns, but they change nothing today.
- Verification: `scripts/frontend-audit/tmp/cookmode/verify3.mjs` at 375 and 1440. The cook-mode `.cook-timer` and the recipe-page embed (`.cook-timer` on `#/recipe/air-fryer-chicken-thighs` after starting a cook) both have a 46×46 reset button, no overflow, and no text under 12px. Screenshot: `docs/frontend/screenshots/agents/cookmode/recipe-timer-375.png`.
- Status: FIXED-VERIFIED for the live timer. Follow-up: the unused `.timer-panel*` and `.timer-controls*` rules were removed from `src/styles.css` (base rules, the ≤1080px, ≤960px and ≤760px media blocks, and the `.timer-panel` entry in the reduced-motion selector list). Grep of `src/` finds no `timer-panel` or `timer-controls` references, and the brace count is balanced (593/593). The live timer re-measured unchanged at 375 and 1440 (46×46 reset button, no overflow).

## A11Y-2: Timer duration input name overridden by aria-label
- Severity: P2
- Route / component / file:line: `src/components/CookingTimer.tsx` duration `<input>` (~line 174)
- Defect: The visible label "Timer duration" was overridden by `aria-label="Timer minutes"`, so the accessible name did not match the visible label (WCAG 2.5.3 Label in Name).
- Root cause: An explicit `aria-label` replaced the `<label htmlFor>` association.
- Fix: Removed `aria-label`. The visible `<label>` now names the input. The "min" unit is linked as the description through `aria-describedby="cooking-timer-unit"` on the unit `<span>`.
- Verification: `scripts/frontend-audit/tmp/cookmode/verify4.mjs`. On `#/cook/air-fryer-chicken-thighs`, `getByRole("spinbutton", { name: "Timer duration" })` matches with description "min". The recipe-page embed also matches by name. ESLint clean on the file. `tsc` reports no errors in CookingTimer or CookMode.
- Status: FIXED-VERIFIED

## RT-2: Wake-lock toggle lost its visible on/off state (regression from COOK-4)
- Severity: P2
- Route / component / file:line: `#/cook/<slug>` · `src/pages/CookMode.tsx` wake-lock button (~line 656); `src/styles/cook-mode.css` `.cook-wake-state` and `[aria-pressed="true"]` rules
- Defect: After COOK-4 removed the changing label, the button showed no on/off state and no pressed styling.
- Root cause: COOK-4 kept only `aria-pressed` as the state carrier, with no visual equivalent.
- Fix: The stable name "Keep screen awake" and `aria-pressed` are kept. Added an `aria-hidden` On/Off pill inside the button, with a check icon when on. The button now has a bordered pill outline, and `[aria-pressed="true"]` gets a filled sage background and ink border.
- Verification: `scripts/frontend-audit/tmp/cookmode/verify5.mjs` at 375×812 with a stubbed `navigator.wakeLock`. Light and dark produced `aria-pressed=true` with pill "On" for the granted case, and `aria-pressed=false` with pill "Off" after a refused request. Screenshots are in `docs/frontend/screenshots/agents/cookmode/wake-ok-{off,after}-{light,dark}.png` and `wake-refused-*`. The refused message appears in both themes (`verify6.mjs`; the first light read was a timing race). The unsupported path is unchanged: the button only renders when `"wakeLock" in navigator`. Earlier headless runs confirmed the refused message.
- Status: FIXED-VERIFIED

## COOK-7: Done click dropped after an uncommitted servings edit (regression from COOK-1, found by e2e)
- Severity: P1
- Route / component / file:line: `src/pages/CookMode.tsx` `toggleCurrentStep`, `setPortions`, `commitServingsDraft`
- Defect: Typing a new servings value and clicking "Done, next step" in one gesture silently dropped the click. The blur commit set the shared `submitting` guard, so the Done handler returned early. Repro: fill servings "4", click Done → still "0 of 4 complete"; a second click was needed.
- Root cause: One `submitting` ref guarded both the servings save and the step toggle, so the blur-triggered save blocked the click that caused it.
- Fix: Separate refs. `savingServings` guards only the servings save, and `servingsSave` holds its promise. `togglingStep` guards only the step toggle, and it awaits `servingsSave` before writing. The double-click guard on the same action still holds.
- Verification: `scripts/frontend-audit/tmp/cookmode/verify7.mjs` on the dev server. Fill "4" then one click on Done → "1 of 3 complete", servings 4. A double-click on Done toggles once (2 of 3, moved to step 3). After reload, the state persists. `npx playwright test tests/e2e/upgrade.spec.ts -g "focused cooking"` gets past the Done step (the Step 2 assertion passes) and then fails at line 117 on `getByLabel("Timer minutes")`. That failure is the A11Y-2 rename (now "Timer duration"), not this fix. The spec needs updating by its owner.
- Status: FIXED-VERIFIED (dev server); the e2e spec remains red until its label reference is updated.

## Checked, no defect found
- axe-core (`@axe-core/playwright`): 0 violations on the empty entry state and the active workspace at 320×640 and 375×812, light and dark, and 812×375 landscape.
- Horizontal overflow: 0px at 320, 375, and 812×375.
- Timers use wall-clock deadlines (`timerEndsAt` = Date.now()+duration). With Playwright's clock: 1 min → 30 s elapsed → reload → +10 s → 18 s remaining → expired to "Time's up". Pause/resume keeps the remaining seconds. Running state survives reload.
- Wake Lock: when unsupported or refused (headless Chromium refuses), the button shows the graceful message "Your device couldn't keep the screen awake. Cooking progress is still saved." Nothing else breaks.
- Unit tests: `npx vitest run tests/unit/cook-mode-logic.test.ts` → 4 passed.
- ESLint on the three owned files: clean. `tsc -p tsconfig.app.json`: no errors in owned files. Current errors are in `src/pages/CustomRecipes.tsx` (another owner).

## Observations, not fixed
- Under 44px targets: 5 ingredient checkboxes measure 19×19. The surrounding `<label>` is at least 44px tall, so the clickable target meets the requirement. No change made.
- The "Skip to content" box appears over the step panel in full-page screenshots. It comes from the app shell, not cook mode. Owner: app shell / design-system agent to confirm whether it is a real overlay or a screenshot artifact.

## Not verified
- Real screen-reader announcements (NVDA, VoiceOver) for COOK-3 and COOK-4.
- Successful Wake Lock acquisition (headless Chromium refuses it).
- Reduced motion: only the CSS rule exists; no animation in cook mode to observe.
- Swipe navigation: not implemented, so nothing to test. Keyboard shortcuts for next/previous: not implemented.
- Navigating away and back to the workspace (state comes from IndexedDB; not scripted separately).
- Accidental-navigation protection: the active cook is persisted in IndexedDB, so no confirmation dialog is added. Not verified against a real browser close.
- Screenshots: `docs/frontend/screenshots/agents/cookmode/` (`active-320.png`, `active-375L.png`, `probe-375.png`, `active-375D.png`, `active-320D.png`).
