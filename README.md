# AirFuel Kitchen

A private, offline-first air-fryer cooking companion built for Australian metric ingredients and a Ninja 6.7 L basket, without assuming a model number. Includes **300 researched recipes**, with original metric instructions, attributed sources and estimated nutrition. The final dataset has 128 main meals with at least 25g estimated protein per serving; "main meal" here means every category except breakfast, snacks-sides and desserts, so it includes the vegetarian category.

## Run locally

Use Node.js 22.12 or newer (tested here on Node 24.21). No API key or account is required.

```bash
npm ci
npm run dev
```

Open http://127.0.0.1:5173. To use the production build and its offline service worker:

```bash
npm run build
npm run preview
```

Open http://127.0.0.1:4173 while online and wait for the offline-ready message before disconnecting. The development server is for editing; test offline behaviour on the production preview or an HTTPS deployment. Keep the server running for first load. An installed/cached application can subsequently open offline in a supporting browser.

**Keep using the same browser profile and origin.** `localhost`, `127.0.0.1`, different ports, and another browser each have separate storage. Export a backup in Settings before changing where you open the app, then import it at the new origin. Browser-data clearing and private browsing can remove local memories.

## Everyday use

1. Search Explore recipes by dish, ingredient or tag. Try `chicken breast`, `under 20 minutes`, `no oil` or `more than 40g protein`.
2. Set servings on a recipe and choose Start cooking → Begin cooking. Cook Mode keeps your steps, ingredients and timer when you leave and return. Scale quantities, not temperature; extra portions can require additional batches.
3. Save a cooking memory when finished, or independently mark Tried, rate, favourite and save notes. Only the servings explicitly recorded as eaten contribute to logged protein.
4. Add meals to the weekly planner. Shopping combines compatible ingredient forms and can subtract matching pantry quantities. Manual items and pantry amounts are editable.
5. Set allergies, preferences, the air-fryer details and light/dark appearance in Settings. Recommendations run locally using explainable rules.
6. Export private JSON backups regularly. Import supports a validated preview, merge, or explicitly confirmed replacement.

Custom recipes live in Your recipes (Settings). They are editable and can be printed/shared by link, but a custom link works only where that recipe has been imported or synced. Bundled recipe content stays separate from personal data. Generated category artwork is explicitly labelled; it is not a photograph of the particular recipe.

## Check the project

Latest verification (frontend sweep, 2026-10-11): **109 unit tests, 69 production-browser tests and 33 visual-regression snapshots passed**, axe reported no WCAG 2.2 AA violations across 104 route/theme/width states, and 182 screen/width/theme captures (320–1920 px) showed no overflow or console errors. Data validation, lint, strict typing and a fresh production build also passed. See [the final frontend report](docs/frontend/FINAL_FRONTEND_REPORT.md) and its [issue register](docs/frontend/ISSUE_REGISTER.md); the earlier upgrade's [QUALITY_REPORT.md](docs/QUALITY_REPORT.md) remains for history.

```bash
npm run validate:data
npm run research:index
npm run lint
npm run typecheck
npm test
npx playwright install chromium
npm run test:e2e
npm run build
```

Playwright builds and starts a production preview on port 4173. Stop any unrelated preview there first, or use `CI=1 npm run test:e2e` to require a fresh server. Tests use isolated browser profiles. HTML results are in `playwright-report/`; representative screenshots are in `docs/screenshots/`.

## Structure

- `src/data/`: immutable recipe catalogue and runtime validation.
- `src/lib/`: strict schemas, Dexie database/migrations, backups, search, recommendations and shopping/nutrient calculations.
- `src/pages/`, `src/components/`: responsive React interface.
- `src/cloud/`, `supabase/migrations/`: optional authenticated sync adapter, durable queue and per-user database boundaries.
- `research/`: source verification, editorial decisions, food-composition mappings and validation evidence. Research files are not bundled into the application.
- `public/images/`: eight generated category illustrations, served locally.
- `tests/`: unit, integration, security and browser acceptance coverage.

## Deployment preparation

This is a static application. Build with `npm ci && npm run build`, then serve **only `dist/`** at the root of an HTTPS origin with correct JavaScript and Web Manifest MIME types. Hash routes do not require server route rewrites. Do not serve the repository, `.env` files, research working files or private backups. No public deployment has been performed.

Cache hashed `assets/` files for a long period; serve `index.html`, `sw.js` and the web manifest with revalidation so updates are detected. Retain old hashed assets during rolling deployments. The app offers an update prompt when a new service worker is waiting. Export data before substantial upgrades, preserve the origin, and add versioned Dexie migrations for future schema changes. See the migration and backup details below.

Cloud sync is **unconfigured and has not been tested against a live Supabase project**. Local cooking works without it. Follow [CLOUD.md](docs/CLOUD.md) if you choose to configure your own project and complete its live isolation tests. Put only a public publishable/anon key in Vite environment variables; never a privileged key.

## Documentation

- [Quality report and completion matrix](docs/QUALITY_REPORT.md), [progress](docs/PROGRESS.md) and [architecture](docs/ARCHITECTURE.md)
- [Design system](docs/DESIGN_SYSTEM.md), [executed design research](docs/DESIGN_RESEARCH.md), [UX audit](docs/UPGRADE-AUDIT.md) and [Cook Mode](docs/COOK-MODE.md)
- [Recipe provenance](docs/RECIPE_PROVENANCE.md), [nutrition method](docs/NUTRITION_METHOD.md) and [recipe contract](docs/RECIPE-CONTRACT.md)
- [Memory, migrations, search and recommendations](docs/DATA-AND-MEMORY.md)
- [Nutrition and research methodology](docs/NUTRITION-AND-RESEARCH.md) and [source register](research/source-register.json)
- [Image provenance](docs/IMAGES.md)
- [Initial-build validation record](docs/VALIDATION.md) (superseded by the upgrade quality report)
- [Optional cloud setup](docs/CLOUD.md)

Recipes were adapted from individually checked sources and have not been physically kitchen-tested in this project. Nutrition remains an estimate; times depend on food thickness, batch size and appliance. The recipe pages distinguish basket settings from thermometer safety targets, and contain their sources and method notes.
