# Frontend sweep: shared agent brief (2026-10-11)

Project: AirFuel Kitchen, `/Users/raoof.r12/Desktop/Raouf/Fun` (React 19 + Vite + Dexie, hash routing in `src/App.tsx`).
Several agents work in parallel. Read this whole brief before starting.

## Environment
- A Vite dev server with HMR is ALREADY running at `http://127.0.0.1:5180`. Routes are hash routes: `http://127.0.0.1:5180/#/explore`.
  Do NOT start, stop or restart servers on 5180 or 4173. Do NOT run `npm run build`, `npm run test:e2e` or `npm run dev`.
- Routes: `/`, `/explore`, `/favourites`, `/recipe/<slug>`, `/cook/<slug>`, `/planner`, `/shopping`, `/pantry`, `/journal`, `/settings`, `/help`, `/custom`, unknown → not-found. Sample slugs: `air-fryer-chicken-thighs`, `air-fryer-beef-joint`.
- Theme: `preferences.theme` = system/light/dark; with "system" the Playwright `colorScheme` option controls it.
- Browser checks: write throwaway Playwright scripts (ESM, `import { chromium } from "@playwright/test"`) in `scripts/frontend-audit/tmp/<your-agent-name>/` and run them with `node`. Each script uses a fresh browser context, so no real user data is touched. For axe: `import AxeBuilder from "@axe-core/playwright"`.
- Reference screenshots of the untouched app: `docs/frontend/screenshots/baseline/<route>-<width>-<light|dark>.png` (widths 320/375/768/1024/1440). Capture helper: `scripts/frontend-audit/capture.mjs`.
- Your own after-fix screenshots go in `docs/frontend/screenshots/agents/<your-agent-name>/`.
- To create populated states, drive the real UI (favourite, mark tried, rate, add to planner, save a cook memory …) or use Settings → import with a fixture file you create under your tmp folder. Never write to real browser profiles.

## Checks you may run (fast, safe to run in parallel)
- `npx tsc -p tsconfig.app.json --noEmit`
- `npx eslint <the files you changed>`
- `npx vitest run <relevant test file>` (unit tests in `tests/unit/`)

## Editing rules (critical: parallel agents)
- Edit ONLY files you own (listed in your task). If a fix needs a file you don't own, write it in your findings file under "Needs other owner" with the exact change you want. Don't edit it yourself.
- Shared CSS (`src/styles.css`, `src/styles/kitchen.css`): page agents may edit selectors that are clearly specific to their own page (for example `.planner-*` for the planner agent). Shared primitives (`.button`, `.card`, `.chip`, inputs, tokens, `.app-shell`, nav) belong to the design-system agent. Use the Edit tool with small, unique replacements, and re-Read the exact region right before each edit, because other agents edit these files too. Never rewrite or reformat a whole CSS file.
- Do NOT edit `src/data/*.json` (researched recipe catalogue) or `research/`. Report data/display defects instead.
- Do NOT change the Dexie schema or migrations, backup format, or `src/cloud/*` unless you are the logic agent, and then only with unit tests.
- Keep behaviour and existing features unless something is a defect. Don't hide food-safety information for aesthetic reasons.
- Match the existing code style: TypeScript strict, function components, lucide-react icons, CSS in the existing stylesheets (no Tailwind, no new dependencies).
- Follow the design system in `design-system/airfuel-kitchen/MASTER.md` and the existing tokens in `src/styles/tokens.css` (premium food editorial × wellness companion × cooking utility: warm surfaces, Fraunces display + DM Sans body, terracotta/forest accents, restrained motion). No random gradients, glassmorphism, emoji icons or heavy shadows.

## Process
1. Read your owned files fully. Look at the baseline screenshots for your routes.
2. Audit in a real browser: light + dark, widths 320/375/768/1440 (more around breakpoints when you see problems), keyboard-only operation, axe scan, empty AND populated states, long content, every interactive control's real outcome (does it persist after reload?), console errors.
3. Fix issues as you find them (P0/P1 first, then meaningful P2, then P3 where it is visibly inconsistent). Don't wait until the end to start fixing.
4. Verify each fix in the browser (screenshot or scripted assertion) and run tsc + eslint on your files. Run relevant unit tests.
5. Record everything in `docs/frontend/findings/<your-agent-name>.md` and keep it updated as you go:

```
## <PREFIX>-<n>: <short title>
- Severity: P0|P1|P2|P3
- Route / component / file:line
- Defect (what a user sees):
- Root cause:
- Fix (what you changed), or "Needs other owner: <file> + exact change":
- Verification (command / script / screenshot path + result):
- Status: FIXED-VERIFIED | FIXED-UNVERIFIED | OPEN | NEEDS-OWNER | WONT-FIX (reason)
```

Severity: P0 = crash, data loss/corruption, cooking workflow blocked. P1 = broken main interaction, serious a11y failure, major layout defect. P2 = noticeable UX friction, inconsistent styling, poor responsive behaviour. P3 = minor cosmetic.

## Final reply to the lead
Keep it short: counts by severity and status, the list of files you changed, anything needing another owner, and anything you could NOT verify. Be honest. Never claim a check you didn't run.
