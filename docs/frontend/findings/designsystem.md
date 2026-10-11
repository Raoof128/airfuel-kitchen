# Design system findings (DS prefix)

## DS-1: Control borders failed WCAG 1.4.11 in both themes
- Severity: P1
- File: `src/styles.css` input rule, `.button`, `.search-box`; tokens in `src/styles/tokens.css`
- Defect: input and button outlines were barely visible (1.34:1 light, 1.64:1 dark).
- Root cause: controls shared `--line`, a decorative divider colour.
- Fix: added `--line-control` (`#7a8673` light, `#78866f` dark), applied to input/select/textarea, `.button`, `.search-box`.
- Verification: `python3 scripts/frontend-audit/tmp/designsystem/contrast.py src/styles/tokens.css`. Now 3.80:1 on light surface, 3.78:1 on dark surface.
- Status: FIXED-VERIFIED

## DS-2: Focus ring inconsistent and missing on some elements
- Severity: P2
- File: `src/styles.css` focus-visible block
- Defect: `[tabindex]` and checkboxes/radios had no shared ring; buttons and inputs used a 4px offset.
- Fix: one ring on `var(--ring)` (3px, offset 3px); checkboxes and radios use a 2px offset; `[tabindex]:focus-visible` added.
- Verification: 30 captures in `docs/frontend/screenshots/agents/designsystem/` with 0 horizontal overflow. Keyboard-only run not scripted.
- Status: FIXED-VERIFIED (keyboard Tab through /explore and /settings, both themes, 1440: focused controls show 3px solid rgb(168,66,41) light / rgb(241,157,128) dark; crops in docs/frontend/screenshots/agents/designsystem/focus/)

## DS-3: Text below 12px in shared primitives
- Severity: P2
- File: `src/styles.css`, `src/styles/kitchen.css`
- Defect: 8 to 11px text in sidebar status, image disclosure, category labels, eyebrows, chips, stats rail, recipe meta, footer, text links, mobile bottom nav.
- Fix: 32 declarations on shared selectors raised to 12px by `scripts/frontend-audit/tmp/designsystem/floor12.py`.
- Verification: CSS braces balanced (styles.css 593/593, kitchen.css 294/294); 30 captures clean.
- Status: FIXED-VERIFIED (recipe 375 light and settings 1440 dark viewed by eye; 0 overflow across 30 captures; axe clean)

## DS-4: h2 fixed at 30px on phones
- Severity: P3
- Fix: `--text-h2: clamp(24px, 2.2vw + 14px, 30px)` used by `h2` and `.section-heading h2`.
- Status: FIXED-VERIFIED. Live measurement (/settings): `h2` in settings sections is 24px at 375 and 30px at 1440 (clamp range). Overrides that bypassed the token were `.section-heading h2` (31px, kitchen.css), `.settings-section h2` (29px and 27px in a narrow query, styles.css) and `.danger-section h2` (25px). All now use `var(--text-h2)`. Still page-specific: `.hero-copy h2` (clamp to 38px) and `.today-note h2` (27px fixed); route to the dashboard owner.

## DS-5: Nutrition figures not tabular
- Severity: P3
- Fix: `font-variant-numeric: tabular-nums` on `.stats-rail strong`, `.nutrition-primary strong`, `.macro-row`, `.macro-row b`.
- Status: FIXED-VERIFIED. Live computed `font-variant-numeric: tabular-nums` on `.nutrition-primary strong`, `.macro-row` and `.macro-row b` at 375 and 1440, light and dark (recipe route).

## DS-6: Active and disabled button states not distinct
- Severity: P3
- Fix: `.button:active` (sage) and `.button:disabled` (soft fill, muted text, no hover change). A later `.button.primary` rule still sets its own colours, so disabled primary buttons show the opacity fade only.
- Status: FIXED-VERIFIED. Live on the primary button in /settings. Hover: rgb(168,66,41) to rgb(137,53,30). Active (mouse down): same darker background plus `filter: brightness(0.92)`, so press is distinct from hover. Disabled (fresh element): rgb(240,240,231) background, rgb(94,103,89) text, opacity 0.6, cursor not-allowed. Fix needed: `.button.button:disabled` raised in specificity because `.button.primary` had overridden it.

## DS-7: Print hides the image disclosure
- Severity: P2 (resolved as not applicable)
- File: `src/styles.css` and `src/styles/kitchen.css` `@media print`
- Defect: printed recipes omit "Category illustration", so an illustration can read as a real dish photo.
- Root cause: `.image-disclosure` is in the print `display:none` list.
- Verification: print emulation on /recipe/air-fryer-chicken-thighs (`verify.mjs`). The only `.food-image` is hidden in print (`.recipe-hero-layout > .food-image` display none), so its disclosure is hidden with it. Nothing printed is an uncaptioned illustration.
- Fix: none needed. Disclosure stays in the print hide list.
- Status: FIXED-VERIFIED (no change required). Print PDF: docs/frontend/screenshots/agents/designsystem/print/recipe-print.pdf

## DS-9: Focus ring drawn around the whole content area
- Severity: P2 (regression introduced during this sweep, fixed)
- File: `src/styles.css` focus-visible block
- Defect: a 3px orange outline around `<main id="main" tabIndex={-1}>` on route change.
- Root cause: my `[tabindex]:focus-visible` rule matched `tabIndex=-1` programmatic focus targets (main, results heading, cook step heading).
- Fix: `[tabindex]:not([tabindex="-1"]):focus-visible`. Programmatic focus targets get no ring.
- Verification: /settings 1440 dark screenshot re-read; outline gone.
- Status: FIXED-VERIFIED

## DS-10: .icon-button base was 40px in styles.css
- Severity: P2
- File: `src/styles.css` `.icon-button`; `src/styles/kitchen.css` already overrides to 44px
- Fix: base now `min-width/min-height: var(--tap-min)` (44px) in styles.css, so the source of truth is the token.
- Verification: `scripts/frontend-audit/tmp/designsystem/icons.mjs`. On /recipe at 375 and 1440, light and dark: Print, Copy link, Open navigation and Reset timer are 44px or larger. Modal "Close dialog" (mobile menu) is 44x44 at 375. Recipe action bar and mobile menu viewed at 375 light/dark and 1440 dark; screenshots in `docs/frontend/screenshots/agents/designsystem/icons/`.
- Status: FIXED-VERIFIED
- Needs other owner: page overrides still shrink icon buttons below 44px:
  - planner: `styles.css` `.timer-controls .icon-button` (31px), `.planned-meal > .icon-button` (29px wide), `.day-nav` is fine.
  - shopping: `.shopping-row .icon-button` (30x36px).
  - journal: `.journal-actions .icon-button` (28x35px at a narrow breakpoint).

## DS-11: Mobile header at 375 and 1440
- Status: FIXED-VERIFIED. At 375 the header is visible (44x44 Open navigation button, brand 177x33). At 1440 it is hidden (display none). Screenshot: `docs/frontend/screenshots/agents/designsystem/close/mobile-header-375-light.png` (and dark).

## DS-12: Dead heart-button size rules in styles.css
- Severity: P3
- Fix: removed the 36px width and height from the base `.heart-button` rule and the 32px width, height and 17px svg width from the narrow-width block in `src/styles.css`. `src/styles/kitchen.css` (44px, 20px svg) was already the effective rule. The top and right offsets in the narrow block are still set but are overridden by kitchen.css.
- Verification: `scripts/frontend-audit/tmp/designsystem/heart.mjs`. On /explore, first three hearts measure 44x44 at 375 and 1440. Brace count in styles.css balanced (605/605).
- Status: FIXED-VERIFIED

## DS-8: Page-specific text below 12px and other debt
- Severity: P2
- Defect: about 38 font-size declarations below 12px remain on page selectors.
- Status: NEEDS-OWNER

Needs other owner:
- planner: `src/styles.css` `.planned-meal > span` (9px), `.add-meal` (10px, 11px), `.plan-totals > span` (10px), `.day-panel header > span` (11px).
- journal: `.journal-date span` (8px, 10px), `.journal-summary span` (10px, 11px), `.journal-content .recipe-meta` (11px).
- recipe: `.provenance` (9px), `.safety-note p` (10px), `.ingredient-list small` (11px), `.recipe-action-bar .button` (11px), `.method-list label` (11px).
- cookmode: `src/styles/cook-mode.css` `.cook-topline > .cook-eyebrow` (9px), `.cook-eyebrow`, `.cook-timer-state`, `.cook-step-navigation > span` (11px).
- settings: `.backup-actions .button` (11px), `.results-heading select` (11px), `.results-heading label` (10px).
- All page owners: any page-specific control border still using `--line` should switch to `--line-control`.

## Axe
`axe-core` 4.10.2 (scratch install under `scripts/frontend-audit/tmp/designsystem/node_modules`, not added to the project) run on /, /explore, /recipe/air-fryer-chicken-thighs and /settings at 375 and 1440, light and dark: 16 runs, 0 violations.

## Token
`--text-min: 0.75rem` added to `tokens.css` for page owners. Still 12px in practice; `--text-caption` is the 12px floor.

## Not done
- Raw hex in `src/styles.css` (18) and `src/styles/kitchen.css` (8): mostly photo overlays and shadow alphas, left literal.
- `.heart-button` is 36px, below 44px. It belongs to the card owner.
- Visual review by eye: 375 dark dashboard, 375 light recipe, 1440 dark settings, focus crops for explore in both themes. Not every route at every width was viewed.
- `tsc`, `eslint` and unit tests were not run: no TypeScript or JavaScript was changed.
