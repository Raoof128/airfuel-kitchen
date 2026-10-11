# Initial-build validation record

This is the preserved pre-upgrade baseline. The current delivery has 58 passing unit tests and 45 passing production-browser tests; see [QUALITY_REPORT.md](QUALITY_REPORT.md) for final evidence.

Validated 11 October 2026 on Node.js 24.21.0 and Chromium through Playwright. The completed catalogue contained 300 records at the production build used by this run. Exact data hashes and source crosswalks are in `research/source-register.json`.

## Results

| Check | Result |
|---|---|
| Recipe validation | **300 recipes; 0 errors; 0 warnings** |
| Primary recipe sources | **300 distinct primary URLs**, 344 total reference URLs |
| ESLint | Passed |
| Strict TypeScript and Prettier | Passed |
| Unit/integration tests | **38 passed**, 5 files |
| Production-browser tests | **19 passed**, 39.8 seconds, one worker |
| Production build | Passed, generated offline service worker |
| npm advisory audit | **0 known vulnerabilities**, runtime and complete dependency trees |

Commands used for the final acceptance run:

```sh
npm run validate:data
npm run research:index
npm run lint
npm run typecheck
npm test
CI=1 npm run test:e2e
```

The Playwright web server command runs `npm run build && npm run preview`; `CI=1` prevents reuse of a stale preview. Browser tests use isolated profiles, not the user's saved cooking data. Reports: `playwright-report/index.html`; screenshots: `docs/screenshots/`. Subsequent test runs may overwrite those generated reports.

The read-only plant audit (`python3 research/plant/validate.py`) independently reproduced all 92 calculated plant nutrition records with zero errors. Its isolated offline rebuild produced byte-identical canonical data. Both final source-register hashes were checked against the delivered files after the browser run.

The earlier keyboard scenario failed because it sent Tab before IndexedDB finished loading the app shell. The test now waits for the visible main heading, retaining the original focus assertion. It passed both the targeted rerun and this complete suite.

## Browser evidence

The acceptance journey searches and filters chicken recipes, saves tried/rating/notes/favourite state, closes Chromium completely, reopens the same browser profile, verifies saved memories, plans another meal, exports a backup and reopens cached routes offline.

Additional scenarios cover independent tried versus consumed portions; session creation/edit/deletion; selected servings and completion clearing an active cook; timer/checklist persistence; two-tab updates; validated backup preview/merge/replace; malformed import rejection; confirmed reset and restoration; pantry and shopping edits; custom recipe creation; title-only editing without metadata loss; and duplicate-submit protection.

All major routes were checked for horizontal overflow at **1440, 820, 390 and 320 pixels**. Automated WCAG 2.2 AA-oriented axe checks passed for dashboard breakpoints and recipe, search, planner, shopping, pantry, journal, settings, help, custom forms and session dialog in both themes. Keyboard skip-link navigation, Escape dismissal and focus return passed. Reduced-motion media was enabled during visual checks. Representative dashboard and recipe screenshots were inspected; no overlapping controls or clipped text were observed.

Security scenarios verify that markup in notes remains inert text, rejected imports preserve existing data and imported custom recipes cannot bypass a saved allergen exclusion. Unit tests also exercise migration, atomic rollback, backup integrity, numerical limits, dietary/safety override constraints and mocked cloud failure/recovery paths. See `QA-REVIEW.md` for the resolved findings.

## Catalogue metrics

| Category | Recipes |
|---|---:|
| Chicken and turkey | 32 |
| Beef, lamb and pork | 38 |
| Fish and seafood | 31 |
| Vegetarian | 45 |
| Breakfast | 27 |
| Quick dinners and meal preparation | 67 |
| Snacks and sides | 38 |
| Desserts | 22 |
| **Total** | **300** |

Categories describe meal types, not a guarantee about speed or protein. There are **128 mains with at least 25g protein**, 99 recipes with at least 30g, 47 with at least 40g, and 15 with at least 50g, using the recorded portion sizes. Nutrition comprises 182 ingredient calculations/hybrid calculations and 118 publisher estimates. All remain estimates.

112 recipes take 35 minutes or less, including 24 under 20 minutes. Therefore the brief's aspiration for *mostly* 10–35-minute recipes was not met across the whole collection; the fast filters expose the actual eligible subset. Required marinating, chilling, resting and sequential batches were not hidden to shorten labels. There are 37 recipes without added oil and 28 qualitative budget tags. Budget tags do not represent verified current prices.

## Build note and practical limits

Vite emitted its advisory for two recipe-data chunks slightly above 500kB uncompressed (613,392 and 603,425 bytes; approximately 66.5kB and 72.1kB when gzip-compressed). They deliberately include the complete offline catalogue. Vendor code is split separately, both data chunks are precached, and all offline acceptance checks passed. Actual deployment transfer depends on server compression. No performance benchmark on a physical low-end device was run.

Cloud sync is implemented but **unconfigured and not live-tested**. Supabase Auth, migration execution, actual RLS enforcement and two physical devices remain unverified; current cloud checks use mocks and static SQL assertions. No public deployment was performed.

Recipes are researched, originally written adaptations, not kitchen-tested outcomes. Nutrients, cooking yields and timing are not laboratory or appliance measurements. Category images are generated illustrations. Automated accessibility and desktop Chromium emulation do not replace manual screen-reader or physical iOS/Android testing. Browser storage can be cleared; backup remains necessary.
