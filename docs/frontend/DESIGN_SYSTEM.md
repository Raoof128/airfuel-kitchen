# AirFuel Kitchen design system (frontend sweep, 2026-10-11)

This document describes what is actually in `src/styles/tokens.css`, `src/styles.css` and `src/styles/kitchen.css`. Where it disagrees with `docs/DESIGN_SYSTEM.md` or `design-system/airfuel-kitchen/MASTER.md`, the code wins and the difference is listed under "Reconciliation".

## Skills used

- **frontend-design** (`/Users/raoof.r12/.claude/skills/frontend-design/SKILL.md`): read. Recommended a committed, non-generic direction with distinctive type and cohesive CSS variables. Applied: Fraunces display and DM Sans body, warm paper surfaces, terracotta and forest accents. Rejected: purple gradients, glassmorphism, default system fonts.
- **ui-ux-pro-max** (`2.11.0`): read `SKILL.md`, `references/quick-reference.md` (not separately quoted), and `references/pro-rules.md`. Commands run, without `--persist` or `--force`:
  - `python3 .../scripts/search.py "recipe cooking app warm editorial" --design-system -p "AirFuel Kitchen"`. Returned an App Store landing pattern, a Claymorphism style, a Calistoga/Inter pairing and a `#9A3412` / `#059669` palette. **Rejected** for style, type and palette. The palette's warm-terracotta-plus-green note is consistent with the app, but the hex values are not used.
  - `--domain ux "dark mode contrast"`. Recommended 4.5:1 body text and no grey-on-grey. Applied and measured below.
  - `--domain typography "editorial serif body sans recipe"`. Suggested serif-plus-sans pairings. Kept Fraunces and DM Sans, which were already chosen. Caveat/Quicksand from MASTER.md was not adopted.
  - `--domain ux "touch target focus"`. Recommended 44px touch targets, visible focus rings and an 8px gap. Applied as described under Interactive states.
  - `pro-rules.md` checklist: no emoji icons (Lucide only), reduced motion, 375 and 1440 checks, dark-mode contrast tested independently.

## Aesthetic direction

Warm editorial kitchen. Recipe titles and section headings use Fraunces at a medium weight. Controls and body copy use DM Sans. Surfaces are warm paper in light mode and deep olive-charcoal in dark mode. Terracotta (`--accent`) marks action and selection. Forest (`--forest`) marks the planning card. Sage (`--sage`) marks selected states and quiet panels. Motion is brief and functional.

## Colour

Source: `src/styles/tokens.css`. Light values are on `:root`; dark values are on `:root[data-theme="dark"]`. The app sets `data-theme` from `preferences.theme` (`src/App.tsx`, the `apply` effect).

| Token | Light | Dark | Role |
|---|---|---|---|
| `--bg` | `#f8f6f0` | `#181e19` | Page |
| `--surface` | `#fffefb` | `#222b23` | Cards, inputs |
| `--soft` | `#f0f0e7` | `#2a3428` | Hover fill |
| `--sage` | `#e9eddf` | `#2e3b29` | Selected, quiet panels |
| `--ink` | `#283329` | `#f3f2e9` | Body text |
| `--muted` | `#5e6759` | `#b9c2b2` | Secondary text |
| `--line` | `#dddfd3` | `#414d3d` | Decorative dividers only |
| `--line-control` | `#7a8673` | `#78866f` | Input, select, button, search borders (new) |
| `--accent` | `#a84229` | `#f19d80` | Actions, active nav text |
| `--accent-hover` | `#89351e` | `#ffb99d` | Hover on accent |
| `--ring` | `#a84229` | `#f19d80` | Focus outline (new alias) |
| `--sage-ink` | `#445637` | `#ccdbb6` | Text on sage |
| `--forest` / `--on-forest` | `#2d4935` / `#f8f5e8` | `#2b412e` / `#f6f2e4` | Planning card |
| `--on-accent` | `#fff` | `#262b22` | Text on accent |
| `--danger` | `#a32c2c` | `#ffabab` | Errors |

### Measured contrast (WCAG 2.x, computed by `scripts/frontend-audit/tmp/designsystem/contrast.py`)

Body text requires 4.5:1. UI boundaries and focus rings require 3:1.

| Pair | Light | Dark | Requirement | Result |
|---|---|---|---|---|
| ink on bg | 12.18 | 15.09 | 4.5 | pass both |
| ink on surface | 13.05 | 13.00 | 4.5 | pass both |
| ink on soft | 11.48 | 11.53 | 4.5 | pass both |
| ink on sage | 11.06 | 10.54 | 4.5 | pass both |
| muted on bg | 5.46 | 9.22 | 4.5 | pass both |
| muted on surface | 5.85 | 7.94 | 4.5 | pass both |
| muted on soft | 5.15 | 7.05 | 4.5 | pass both |
| muted on sage | 4.96 | 6.44 | 4.5 | pass both |
| accent on bg | 5.59 | 7.97 | 4.5 | pass both |
| accent on surface | 5.99 | 6.87 | 4.5 | pass both |
| accent on sage (active nav) | 5.08 | 5.57 | 4.5 | pass both |
| sage-ink on sage (selected chip) | 6.70 | 8.10 | 4.5 | pass both |
| danger on surface | 7.05 | 8.11 | 4.5 | pass both |
| on-forest on forest | 9.08 | 9.87 | 4.5 | pass both |
| on-accent on accent (primary button) | 6.04 (`#fff`) | 6.81 | 4.5 | pass both |
| accent-hover on surface | 8.03 | 8.82 | 4.5 | pass both |
| muted at 0.9 opacity, placeholder on surface | 4.67 | 6.74 | 4.5 | pass both |
| `--line-control` on surface | 3.80 | 3.78 | 3.0 | pass both |
| `--line-control` on bg | 3.54 | 4.39 | 3.0 | pass both |
| `--line` (decorative divider) on surface | 1.34 | 1.64 | exempt (decorative) | not a control boundary |
| `--ring` on surface and bg | 5.99 / 5.59 | 6.87 / 7.97 | 3.0 | pass both |

Before this sweep, `--line` was used for input and button borders at 1.34:1 in light and 1.64:1 in dark, which fails WCAG 1.4.11. Those borders now use `--line-control`. Dividers keep `--line`.

Raw literal `#fff` on accent was an earlier failure in dark mode (2.13:1). It does not occur in practice: `[data-theme="dark"] .button.primary` and `.chip.selected` both switch to `--on-accent`.

Remaining raw colours in shared CSS (not converted): `#ffffffeb` and `#ffffffed` on the image disclosure and heart button, `#18221780` scrim, and box-shadow alphas. These are overlay colours on photos and should stay literal.

## Typography

- Fonts: `@fontsource/fraunces` (400, 500, 600) and `@fontsource/dm-sans` (400, 500, 600, 700), imported in `src/main.tsx`. No remote font requests.
- Base: `body` line-height 1.55 (`kitchen.css`). Paragraphs 1.65 (`styles.css`).
- Headings: `h1` uses `clamp(34px, 3.4vw, 52px)`. `h2` now uses `var(--text-h2)`, which is `clamp(24px, 2.2vw + 14px, 30px)`. `h3` is 22px. Headings use `text-wrap: balance`.
- Floor: `--text-caption: 12px`. `--text-min: 0.75rem` is defined as an alias for page owners. Shared primitives (sidebar status, image disclosure, category labels, eyebrows, chips, stats rail, recipe meta, footer, text links) were lifted from 8 to 11px to 12px.
- Numerals: nutrition and macro figures (`.stats-rail strong`, `.nutrition-primary strong`, `.macro-row`, `.macro-row b`) use `font-variant-numeric: tabular-nums`. Number inputs do the same.
- Still below 12px: about 38 declarations on page-specific selectors. See "Needs other owner" in `docs/frontend/findings/designsystem.md`.

## Spacing, radii, shadows

- Spacing scale: `--space-xs` 4, `--space-sm` 8, `--space-md` 16, `--space-lg` 24, `--space-xl` 32, `--space-2xl` 48, `--space-3xl` 64.
- Radii: `--radius-sm` 8, `--radius-md` 14, `--radius-lg` 22. Shared controls use 8px. Cards use 10 to 12px.
- Shadows: `--shadow` (`0 3px 14px` at 6% ink) and `--shadow-raised` (`0 9px 28px` at 10%). Dark mode uses stronger alphas.
- Touch target token: `--tap-min: 44px`.

## Layout and navigation

- Desktop: a fixed 236px sidebar (`.sidebar`, `kitchen.css`) with `main` offset by the same width. Max content width 1500px.
- Mobile: a fixed bottom navigation (`.mobile-bottom-nav`, four destinations) and a native-dialog menu for the rest.
- Recipe grid: three columns on desktop, two on tablet, one on phone (per `DESIGN_RESEARCH.md`).

## Iconography

Lucide icons only, as inline SVG from `lucide-react`. No emoji are used as icons. Icon-only buttons have an accessible label and a 44px minimum box (`.icon-button` in `kitchen.css`).

## Cards

- `.recipe-card`: surface background, 1px `--line` border, 10px radius, `--shadow`. The image scales by 2.5% on hover, which is disabled by reduced motion.
- Card text reflows; titles keep 22px on phones.

## Interactive states

- Buttons: `.button` has a 44px minimum height (46px in `kitchen.css`), 8px radius and a `--line-control` border.
  - Hover: `--soft` fill and `--muted` border.
  - Active (new): `--sage` fill with `--sage-ink` border, not while disabled.
  - Primary: accent fill, `--on-accent` text.
  - Disabled (new rule): `--soft` fill, `--line` border, `--muted` text, opacity 0.6, `cursor: not-allowed`. Hover does not change the disabled look.
- Chips: 44px minimum height (`kitchen.css`). Selected chips use accent fill with `--on-accent` text.
- Focus (`:focus-visible`): one shared ring, 3px solid `var(--ring)`, 3px offset for buttons, links, inputs, selects, textareas, summaries and `[tabindex]`. Checkboxes and radios use a 2px offset. The ring is visible in both themes (5.6:1 to 8:1).
- Hover-only affordances are not the sole means of conveying state; selected, active and disabled states are also colour and weight changes.

## Responsive behaviour

Breakpoints (in `kitchen.css`): 365px, 600px, 900px, 1270px, 1736px. Captured in the sweep for dashboard, explore and recipe at all five widths (320, 375, 768, 1024, 1440) in light and dark: 30 captures. Horizontal overflow was measured as 0 in all 30. Only the 375 dark dashboard was reviewed visually after the change; the other captures were not inspected by eye.

## Accessibility

- Skip link (`.skip-link`), visible on focus.
- `main` is focusable with `outline: none` (`styles.css`). This is intentional: the skip link is the entry point.
- Contrast: see the table above.
- Target size: 44px for buttons, chips, icon buttons and text buttons on the current breakpoints.

## Motion

- Durations: `--motion-fast` 160ms for colour and border transitions. Easing `--ease-out`.
- Reduced motion (`styles.css`, the block at the end of the file): `*` gets `animation: none`, `transition: none` and `scroll-behavior: auto`. `cook-mode.css` has its own block.
- No scroll-triggered reveals, no GSAP. MASTER.md's scroll-reveal suggestion was rejected for a cooking tool.

## Dark mode

Set by the app via `data-theme` on `<html>`, from the preference (`system`, `light`, `dark`). In `system` mode the app listens to `prefers-color-scheme`. Dark tokens sit on `:root[data-theme="dark"]` in `tokens.css`. Dark-specific overrides exist for the primary button and selected chip text.

## Print

`@media print` in `styles.css` and `kitchen.css` hides navigation, action bars, timers and history. The recipe hero image is hidden in print, and its "Category illustration" disclosure goes with it, so a printed recipe shows no uncaptioned image (checked by print emulation).

## Reconciliation with other documents

- `design-system/airfuel-kitchen/MASTER.md` specifies Caveat and Quicksand, a terracotta and green palette with a `#FFFBEB` background, and Soft UI Evolution shadows. The code does not use these. The app keeps Fraunces and DM Sans, the warm palette in `tokens.css`, and the shadow values in tokens. The brief says to keep the existing identity, so MASTER.md was not regenerated and is not authoritative for this app.
- `docs/DESIGN_SYSTEM.md` and `docs/DESIGN.md` describe the same direction, with some stale details. This file supersedes them for implementation facts.
