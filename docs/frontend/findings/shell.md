# Shell and shared components: findings (agent `shell`, prefix SHELL)

Scope: `src/App.tsx`, `src/components/UI.tsx`, `src/components/context.tsx`, `src/main.tsx`, `index.html`, and shell/nav/toast/404 selectors in `src/styles.css`.
Browser checks: Playwright probes in `scripts/frontend-audit/tmp/shell/` against `http://127.0.0.1:5180`. Screenshots in `docs/frontend/screenshots/agents/shell/`.

## SHELL-1: Dark-mode visitors see a light flash on every load
- Severity: P1
- Route / component / file:line: all routes. `src/App.tsx` theme effect; `index.html`
- Defect (what a user sees): with the theme set to "system" and the OS in dark mode, the page painted light, then switched to dark once the saved preference loaded from IndexedDB.
- Root cause: until `data` loads, the effect applied `data-theme="light"` (undefined preference fell through to light). Nothing set the theme before React ran.
- Fix: `index.html` has an inline script (before first paint) that reads `localStorage["airfuel-theme"]` and falls back to `prefers-color-scheme`. `App.tsx` no longer touches the theme until the preference loads, then applies it and mirrors it to that localStorage key (try/catch).
- Verification: `probe2.mjs`, MutationObserver-style rAF sampling. Before: `unset → light → dark`. After: `dark` only (light system: `light` only).
- Status: FIXED-VERIFIED

## SHELL-2: Error toasts disappeared after 12 seconds
- Severity: P1
- Route / component / file:line: `src/App.tsx` toast effect (global `run()` error path)
- Defect (what a user sees): a failed save showed a red alert that vanished after 12 seconds, so a user away from the screen could miss that the save failed.
- Root cause: the auto-dismiss timer ran for error toasts too.
- Fix: only success toasts auto-dismiss (4 s). Error toasts stay until dismissed.
- Verification: `probe3.mjs` forced an IndexedDB `put`/`add` failure, then clicked a favourite. The `.toast.error` (role=alert) was still present after 13 s. Success toast removed after 4.16 s. Dismiss button is 44x44 and removes the toast.
- Status: FIXED-VERIFIED

## SHELL-3: Favourite button announced two states at once
- Severity: P2
- Route / component / file:line: `/explore`, `/favourites`, dashboard. `src/components/UI.tsx` `RecipeCard` heart button
- Defect (what a user sees): screen readers heard "Unsave X" with "pressed" after saving, which reads as two state changes.
- Root cause: `aria-label` changed with the state while `aria-pressed` also reflected it.
- Fix: constant label `Save <title> to favourites`. State is carried only by `aria-pressed`.
- Verification: `probe2.mjs`. Before: label "Save X" → "Unsave X", pressed false → true. After: label is constant, pressed false → true, and it stays true after reload.
- Status: FIXED-VERIFIED

## SHELL-4: 404 page had no h1
- Severity: P2
- Route / component / file:line: `/does-not-exist`. `src/App.tsx` not-found branch; `src/components/UI.tsx` `Empty`; `src/styles.css` `.empty h1`
- Defect (what a user sees): no page heading for screen-reader navigation. axe: `page-has-heading-one` (moderate) on light and dark.
- Root cause: `Empty` always rendered an h2.
- Fix: `Empty` takes `level?: 1 | 2` (default 2). The 404 uses level 1. `.empty h1` styled like `.empty h2`.
- Verification: axe on `/does-not-exist` at 375, light and dark: 0 violations (was 1). `/help` axe: 0 violations light and dark.
- Status: FIXED-VERIFIED

## SHELL-5: Generic or wrong document titles
- Severity: P2
- Route / component / file:line: `src/App.tsx` title effect
- Defect (what a user sees): tab/history titles "Your kitchen" for /help, /favourites, /custom and the 404. "Your kitchen, your way" for Settings.
- Root cause: the title lookup only covered the sidebar `nav` items; everything else fell back.
- Fix: `pageTitles` map covering all routes, with "Page not found" as the fallback.
- Verification: `probe1.mjs` title dump after fix: Favourites, Kitchen guide, Your own recipes, Settings, Page not found. Other routes unchanged.
- Status: FIXED-VERIFIED

## SHELL-6: Saving a checklist item dropped keyboard focus
- Severity: P2
- Route / component / file:line: `src/components/UI.tsx` `SavedCheckbox`; used on recipe ingredients and steps, cook mode, planner shopping rows
- Defect (what a user sees): the checkbox was `disabled` while its write was pending. A keyboard user who pressed Space lost focus to the page body.
- Root cause: `disabled={pending}` on the focused input.
- Fix: removed `disabled`. A ref ignores clicks while a save is in flight. The optimistic value and rollback are unchanged.
- Verification: `probe3.mjs`. Focused the first ingredient checkbox, pressed Space: focus stayed on the same checkbox with checked=true. I did NOT measure the pre-fix focus behaviour, so the claim is limited to the after state.
- Status: FIXED-VERIFIED

## SHELL-7: Toast dismiss button about 26px
- Severity: P2
- Route / component / file:line: `src/styles.css` `.toast button`
- Defect (what a user sees): small close target on mobile, under the 44px touch target.
- Fix: min 44x44, with a negative margin so the toast's visual size is unchanged.
- Verification: `probe3.mjs` measured 44x44 after fix.
- Status: FIXED-VERIFIED

## SHELL-8: Empty state markup: empty `<p>` and CTA nested in a paragraph
- Severity: P3
- Route / component / file:line: `src/components/UI.tsx` `Empty`; `src/App.tsx` 404
- Defect (what a user sees): no visible change; invalid-looking structure (`<a>` inside `<p>`, an empty `<p>` when no body text).
- Fix: body `<p>` rendered only when there is body content. The 404 CTA passed through `action`.
- Verification: axe clean on 404 (see SHELL-4). Visual check: `docs/frontend/screenshots/agents/shell/shell-notfound-320-light.png`.
- Status: FIXED-VERIFIED

## Checked, no defect found
- Bottom nav: 4 items, labels present, `aria-current` on active item, 64 px tall. At 375x812 scrolled to the bottom of `/planner`, `/help`, `/explore`, `/journal`: footer link bottom 704 px vs nav top 748 px. No content covered. Main has 76 px bottom padding.
- Mobile menu (≤900 px): `aria-expanded` true/false; Escape closes and focus returns to the menu button; Tab cycles inside the dialog (14 of 14 presses inside); body scroll locked; choosing a link closes the menu and focus lands on `main`; no scroll jump.
- Skip link: first Tab focuses it at top 10 px; Enter moves focus to `main`.
- Route change: focus moves to `main` (`preventScroll`); `scrollY` 0 after sidebar navigation.
- Sidebar active states: Favourites, the main nav items, Settings and Kitchen guide all show a sage active background.
- Horizontal overflow: scrollWidth − clientWidth = 0 at 320, 375, 768, 1024, 1440, landscape 812x375, and 720 px wide (200% of 1440).
- 320 px header: brand right edge 187 px, menu button left 258 px, no overlap.
- Modal dialogs: 320 px menu content scrolls inside its dialog (`overflow:auto`), which is acceptable.

## Needs other owner
- design-system (`src/styles.css` `.icon-button`, around line 403): `min-width: 40px; min-height: 40px`. Change to 44px to meet the ≥44 px touch-target check. The shell header already overrides it to 44 px via `.mobile-header .icon-button` (the header button measured 44x44).
- settings (`src/pages/Settings.tsx`, Help page around line 661): I only checked Help as a whole with axe (clean, light and dark, 375 px) and the shell. I did NOT audit its content or layout in depth.
- design-system or shell (dead CSS, low priority): `src/styles.css` `.sidebar.is-open` in the 700 px block is never used. App.tsx uses a Modal for the mobile menu.

## Not verified
- `beforeunload` guard: code reviewed only, not exercised.
- iOS safe-area behaviour: Chromium only. `index.html` has no `viewport-fit=cover`, so the `env(safe-area-inset-bottom)` padding on the bottom nav is inert and the layout stays inside the safe area.
- Screen-reader announcements for toasts (role=status and role=alert): not tested with a real screen reader.
- Error copy: failed-save toasts show the raw `error.message` (for example "forced failure / UnknownError: ..."). Left as is because app-thrown messages are intended to be user-facing. Worth a copy review.

## Round 2 (lead requests)

### SHELL-9: Skip-link box reported over the cook step panel
- Severity: P3 (reported as overlay; not reproduced)
- Route / component / file:line: `/cook/<slug>`, `.skip-link` in `src/styles.css`
- Defect (what a user sees): reported in a cookmode full-page capture as a "Skip to content" box over the step panel.
- Root cause: none found. `.skip-link` is `position: fixed; top: -100px` and moves to `top: 10px` only on `:focus`. Measured on `/cook/air-fryer-chicken-thighs` at 1440 and 375, live viewport, after load, after Begin cooking, after scrolling to 500/600/1500px, after route change, and after focusing `#main`: `rectTop` stayed at -100 (offscreen), not focused, no transformed ancestor. A full-page capture (`cook-fullpage-1440.png`, `cook-step-fullpage-1440.png`) shows no box. The box appears only when keyboard focus is on the link (Tab from page load, intended skip-link behaviour), so a capture taken while focused would show it.
- Fix: none needed.
- Verification: `probe8.mjs`, `probe9.mjs`, `probe10.mjs`.
- Status: WONT-FIX (screenshot artifact of keyboard focus, not an overlay)

### SHELL-10: Bottom-nav clearance on every route at 375 (scrolled to bottom)
- Severity: P2 (checked)
- Route / component / file:line: all routes; `main` bottom padding in `src/styles/kitchen.css` (≤900px block: 76px)
- Defect: none. The last visible content sits above the nav on every route except cook mode, where the nav is hidden by design (`.cooking-shell .mobile-bottom-nav { display: none }`).
- Evidence: the scroll-to-bottom screenshots `bottom-favourites-375-light.png` and `bottom-recipe-…` show the footer clear of the nav. Footer top 609 on `/favourites`, and the nav starts at 748 px. Recipe scroll reached the document bottom (scrollY = docH − innerH) with footer top 608. `/does-not-exist` and `/custom` also clear.
- Status: FIXED-VERIFIED (checked; no change)

### SHELL-11: Heart-button hit area and focus
- Severity: P2
- Route / component / file:line: `RecipeCard` heart button, `src/components/UI.tsx`; cascade in `src/styles.css:629` and `src/styles/kitchen.css:415`
- Lead note said 36px. Live computed size: 44×44 at 320, 375, 768, 1024 and 1440 on `/` and `/explore`. The 36px base (`styles.css:629`) and 32px mobile rule (`styles.css:2366`) are overridden by `kitchen.css:415` (`width/height: 44px`), which loads later with equal specificity. Those two `styles.css` rules are dead; the design-system owner can delete them.
- Accessible name: `Save <title> to favourites`, with `aria-pressed` false/true. Name stays constant after a toggle and after reload (see SHELL-3).
- Focus: `:focus-visible` outline 3px accent with 3px offset. Screenshots `heart-focus-375-light.png` and `heart-focus-375-dark.png` show a visible ring over the photo in both themes. The heart (top 12px, right 12px) does not overlap the "Category illustration" label (bottom-right); checked by rectangle intersection.
- Status: FIXED-VERIFIED (already 44px in the live app; accessible name and focus verified)

### SHELL-12: Help page audit
- Severity: P3
- Route / component / file:line: `/help`; `Help` in `src/pages/Settings.tsx` (settings owner). CSS in `src/styles.css` `.help-grid li`
- Defect: list items in the Help cards were 13px muted text, the smallest body copy in the app.
- Fix (help CSS only): `.help-grid li` font-size 13px → 15px.
- Verification: no horizontal overflow at 320/375/768/1024/1440; axe at 375 has 0 violations; full-page captures `help-full-1024-light.png`, `help-full-375-dark.png`. Heading order h1 → h2 is correct.
- Status: FIXED-VERIFIED (CSS only)

Needs other owner: settings. No change to `src/pages/Settings.tsx` is required by the shell audit. The Help copy looked consistent: AU measurements (tbsp 20 ml, tsp 5 ml) and food-safety temperatures are present and unchanged. The content itself was not reviewed for accuracy beyond reading it.
Needs other owner: design-system. `src/styles.css:629-642` and `src/styles.css:2366-2374` (`.heart-button` base and mobile rules) are dead, overridden by `kitchen.css:415`. Remove them, or make them agree with 44px.

## Round 3 (lead requests)

### Confirmation of SHELL-9 and SHELL-11 (lead message)
- Skip link, live viewport: `.skip-link` rect top stayed at -100px (offscreen) and unfocused after load, after route change (`location.hash` set to another route), and after `App` focuses `#main` (`probe5.mjs`, cook and explore). It is visible only when focused (top 10px).
- Heart button: 44×44 in the live app at every width measured (see SHELL-11).

### SHELL-13: Recipe card title link touch target about 30px
- Severity: P2 (routed from explorer, EXP-10)
- Route / component / file:line: `/explore`, `/`, `/favourites`. `RecipeCard` title link in `src/components/UI.tsx`; CSS in `src/styles.css` near `.recipe-card h3 a:hover`
- Defect (what a user sees): on mobile, only the title text was tappable, about 30px tall, below 44px.
- Fix: stretched link. `.recipe-card h3 a::after { position:absolute; inset:0 }` makes the whole card the link target (`.recipe-card` already `position: relative`). `.recipe-card .heart-button { z-index: 1 }` keeps the heart on top and independently clickable. Tab stops: title link, then heart (image link stays `tabIndex -1`). Focus: `.recipe-card:has(h3 a:focus-visible)` draws a 3px accent outline around the card, plus the title link's own outline.
- Verification (`card.mjs`, `hit.mjs`):
  - Hit test at 50% width at 10/50/90% height on the first card returns the recipe URL at 375 and 1440.
  - Clicking the description navigates to `#/recipe/air-fryer-pork-loin` at 375 and 1440.
  - Clicking the heart toggles `aria-pressed` false→true and keeps the hash on `#/explore`.
  - Tab after the heart lands on the title link.
  - axe is clean (0 violations) on `/explore` and `/` at 375 and 1440.
  - Element screenshot `card-focus-375.png` shows the title link's outline. The card-level ring lies outside the element's box, so the element screenshot clips it; the computed outline is `rgb(168,66,41) solid 3px`.
- Status: FIXED-VERIFIED
- Note: a first click test at 375 hit the card's own description text and reported a BUTTON at 80% height. That was an off-screen geometry artifact (the card was below the fold). Re-tested after scrolling each target into view.

## Round 4: context memoisation (logic request)
- `src/App.tsx` `Kitchen`: `navigate` and `run` are `useCallback` (stable, since they only use setState and a ref). `recipes = useMemo(() => data ? effectiveRecipes(catalogue, data) : [], [data])`. `appValue = useMemo(() => data ? {data, recipes, run, navigate} : null, ...)`. All hooks are declared before the `!data` loading return.
- Verification: `tsc -p tsconfig.app.json` clean; `eslint src/App.tsx src/components/UI.tsx` clean; `vitest run tests/unit` 13 files, 90 tests passed; smoke probes (`probe1`, `probe2`, `probe3`, `probe4`): menu open/Escape/focus return, route navigation with focus on main, favourite toggle persists after reload, error toast persists, skip link hidden.
- Status: FIXED-VERIFIED

## Round 5: A11Y-9 and A11Y-8 (cross-check from a11y agent)
- A11Y-9 (offline and update notices not announced), App.tsx `main`: the two `.notice` banners now sit inside a `<div role="status" aria-live="polite">` rendered on first paint, so the region exists before its content changes. Verified: with `setOffline(true)` plus the `offline` event, the same region node received the message (one mutation, text "You’re offline. Your saved kitchen still works."). tsc and eslint clean. Status: FIXED-VERIFIED (the update-ready banner shares the region; not exercised because it needs a service-worker update).
- A11Y-8 (card title link 17px tall): RESOLVED by the Round 3 stretched link. The title link's hit area is now the whole card (`.recipe-card h3 a::after`, inset 0). Hit tests at 50% width and 10/50/90% height return the recipe URL at 375 and 1440, so the target is the card (about 335×399 at 375), not the 17px text line. Status: FIXED-VERIFIED.

## Round 6: PERF-3 / PERF-4 lazy routes, PERF-7 image size
- `src/App.tsx`: Planner, Shopping, Pantry (one module), Journal, SettingsPage, Help, CustomRecipes and CookMode are `lazy()` with named-export mapping. Dashboard, Explorer and RecipeDetail stay eager. A single `<Suspense>` wraps `{page}` inside `main`, with an inline `<p class="route-loading" role="status">Opening this page…</p>` fallback (`.route-loading` in `src/styles.css`, no min-height, so no reserved box).
- Route focus and title: the focus-on-route effect runs before the chunk resolves; `main` persists and keeps focus. Verified in-app: clicking Settings and Planner from the sidebar gives `activeElement = main`, the right title and h1, `scrollY 0`, and no lingering fallback.
- Fresh loads (`/#<route>`, 375px, dev server, 13 routes incl. deep links to `/settings`, `/help`, `/cook/<slug>`, `/planner`): every route rendered its h1 and title, no console errors or page errors, fallback gone after load.
- Not verified: first-load bytes (Supabase out of initial chunk) and the service-worker precache list. The precache glob is `**/*.{js,...}` (vite.config), so emitted lazy chunks match it by pattern. I did not run a production build (brief forbids `npm run build`), so this is a config reading, not a build check.
- Pre-existing, not changed: on a fresh deep-link load, focus does not move to `main`, because the route effect runs while the loading screen is shown (main not yet mounted). Only in-app navigation moves focus.
- `src/components/UI.tsx` `FoodImage` `<img>`: `width={1200} height={800}` added (PERF-7). CSS still sizes the image. Rendered Explore image at 1440 is 358×217 (ratio 1.65, the CSS box), not the 1.5 intrinsic ratio, so CSS controls the box and the attribute only reserves space before the file loads.
- Checks: tsc clean; eslint clean on App.tsx and UI.tsx; `vitest run tests/unit` 17 files, 102 tests pass.
- Status: FIXED-VERIFIED for lazy routes (dev-server behaviour, focus, titles, errors); precache and bundle-size effects NOT VERIFIED (needs a build by an owner allowed to run one).
