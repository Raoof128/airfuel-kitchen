# AirFuel Kitchen design system

## Direction

Three directions were considered before implementation:

1. **Warm editorial kitchen, selected.** Food and the recipe title lead; warm paper surfaces, expressive serif headings, practical sans-serif controls, terracotta actions and olive accents support everyday use.
2. **Performance fuel.** Bold macro numbers and high-energy colour suit a training dashboard but overemphasise nutrition over cooking and discovery.
3. **Quiet cooking notebook.** Sparse ruled lists suit personal notes but under-serve a 300-recipe discovery catalogue.

The selected design applies frontend-design's coherent, deliberate aesthetic and UI/UX Pro Max's food palette, hero hierarchy, accessible targets, semantic headings, error recovery and reduced-motion guidance. The output is an application, so useful controls take precedence over marketing animation.

## Skill execution and professional overrides

Actual generator output: `../design-system/airfuel-kitchen/MASTER.md`. Actual product/style/colour/typography/UX/React search results: `DESIGN_RESEARCH.md`.

UI/UX Pro Max was run with variance 6, motion 2 and density 5, using `--design-system --persist --project-name 'AirFuel Kitchen' --output-dir /Users/raoof.r12/Desktop/Raouf/Fun --format markdown`. All referenced files were inspected before execution.

- Retain locally bundled **Fraunces + DM Sans**. The supplementary editorial typography search supports serif/sans pairing; handwritten Caveat/Quicksand from the generic generator is too casual for dense cooking instructions. No remote font dependency.
- Adapt terracotta/cream/green to contrast-tested light and dark semantic tokens. Warm muted surfaces are intentional, despite the generator's generic anti-muted-colour suggestion.
- Use brief CSS feedback, not GSAP scroll reveals. Cooking controls remain immediately available and respect reduced motion.
- Preserve honest category illustrations and their disclosure. Image failures receive a meaningful fallback; they never become fake exact-dish photographs.

## Reusable rules

- Colour, space, typography, radii, shadow and motion live in `src/styles/tokens.css`.
- Minimum interactive target 44px, with 8px gaps where adjacent controls need separation. Mobile inputs use 16px text to avoid zoom.
- Single-column mobile recipe cards preserve 22px titles, 14px metadata and readable imagery. Tablet uses two columns; desktop three. Content is never hidden to complete a row.
- Search remains visible on phones. Active filters can be removed without reopening the filter form. Filter URLs survive reload and return navigation.
- Desktop uses a calm side rail; mobile uses four stable bottom destinations and a native-dialog menu with Escape, explicit keyboard wrapping and focus return.
- Cook Mode removes the browsing rail and prioritises one step, temperature, progress and timer. Finish flows to the existing cooking memory form.
- Errors are explicit and recoverable; pending writes retain data on failure. Empty states name the missing content and provide the next action.

## Evidence

Baseline captures: `screenshots/upgrade-before/`. Final captures and measured results are linked from [QUALITY_REPORT.md](QUALITY_REPORT.md). The final 112-screen matrix and all 45 browser tests passed.
