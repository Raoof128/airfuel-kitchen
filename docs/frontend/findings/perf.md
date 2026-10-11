# Performance findings (perf agent)

Method and numbers: `docs/frontend/PERFORMANCE_AUDIT.md`. All measurements are from production builds on a
390x844 @2x mobile profile (CPU 4x, Fast 4G), median of 5 runs, with the same source snapshot for before and after.

## PERF-1: Category illustrations are 1536 px originals, far larger than they are shown
- Severity: P1
- Route / component / file:line: Today, Explore, Recipe (hero), CustomRecipes. `public/images/*.webp`. Rendered in `src/components/UI.tsx:120-126`.
- Defect (what a user sees): On a phone, the card picture takes 4-8 s to appear on Explore and Today, so the page looks unfinished for longer. The recipe hero is still loading after 5.7 s.
- Root cause: The eight WebPs are 1536x1024 at q88, 300-400 kB each (2.66 MB total). Cards render at 348-358 CSS px and the hero at 350-678 CSS px. The illustration is the LCP element on three of the four routes.
- Fix (what you changed): Re-encoded all eight at 1200 px wide, WebP q80, same filenames. 2.66 MB → 1.04 MB. `scripts/prepare-images.mjs` now uses the same settings. Originals kept at `/private/tmp/claude-501/airfuel-perf/orig-images/`.
- Verification: Before/after on the same source snapshot. LCP Today 6708 → 4352 ms, Explore 8644 → 4652 ms, Recipe 5760 → 4112 ms. Images downloaded Explore 975 → 383 kB. Visual check: `docs/frontend/screenshots/agents/perf/explore-390-final.png` (390 px, DPR 2, crisp). Side-by-side crop (original left, re-encoded right): `/private/tmp/claude-501/airfuel-perf/compare-meat.png`.
- Status: FIXED-VERIFIED

## PERF-2: The whole recipe catalogue is loaded and validated before first paint
- Severity: P1
- Route / component / file:line: `src/data/catalogue.ts:2-4` (`import.meta.glob(..., { eager: true })`), used by `src/App.tsx:20` and every page.
- Defect (what a user sees): First load downloads about 1.2 MB of recipe JSON (132 kB gzip) before the app can render. On a slow connection this delays FCP and the first image.
- Root cause: `eager: true` pulls both recipe chunks (`recipes-savoury`, `recipes-plant`, 589 kB and 599 kB raw) into the entry's modulepreload list. Zod validation of 300 recipes takes about 6 ms in Node, so bytes are the cost, not parsing.
- Fix: Needs other owner: `src/data/catalogue.ts` (logic/data owner). Make the catalogue load on demand, e.g.
  ```ts
  // src/data/catalogue.ts
  const loaders = import.meta.glob("./recipes-*.json", { import: "default" });
  let cache: Promise<Recipe[]> | undefined;
  export function loadCatalogue(): Promise<Recipe[]> {
    cache ??= Promise.all(Object.values(loaders).map((load) => load()))
      .then((parts) => parts.flatMap((v) => recipeSchema.array().parse(v)));
    return cache;
  }
  ```
  Then `App.tsx` and the pages must wait for `loadCatalogue()` before rendering recipe data (a loading state, and `categoryLabels` moved to a constant module). Estimated saving about 130 kB gzip on the first load. Not prototyped, because consumers read `catalogue` synchronously.
- Verification: Estimated from build output (recipe chunks 63.4 + 68.8 kB gzip). Not measured in the browser.
- Status: NEEDS-OWNER

## PERF-3: Settings (and the Supabase SDK) is loaded on every first visit
- Severity: P1
- Route / component / file:line: `src/App.tsx:35` `import { SettingsPage, Help } from "./pages/Settings";`. `src/pages/Settings.tsx:27` imports `../cloud` → `@supabase/supabase-js`.
- Defect (what a user sees): The first page waits for code that most visits never use. Cloud sync is optional, yet the SDK is always downloaded and parsed.
- Root cause: Static import in `App.tsx`. The supabase chunks are part of the initial graph.
- Fix: Needs other owner: `src/App.tsx` (shell owner):
  ```tsx
  // replace line 35
  import { lazy, Suspense } from "react";
  const SettingsPage = lazy(() => import("./pages/Settings").then((m) => ({ default: m.SettingsPage })));
  const Help = lazy(() => import("./pages/Settings").then((m) => ({ default: m.Help })));
  // line ~238-239: wrap the two uses
  else if (path === "/settings") page = <Suspense fallback={null}><SettingsPage /></Suspense>;
  else if (path === "/help") page = <Suspense fallback={null}><Help /></Suspense>;
  ```
  The vite config change (PERF-5) already isolates the SDK into its own chunk group, so it stays out of the first load.
- Verification: Prototype in a scratch copy (`/private/tmp/claude-501/airfuel-perf/proto/lazy`, not shipped). Initial JS 2040 → 1798 kB raw, 377 → 309 kB gzip. Against the images-only build, FCP 0.2-0.5 s faster on every route, Explore TBT 18 → 0 ms, LCP unchanged (the illustration is LCP). Build succeeded. Not behaviour-tested in the app. The Settings route and the Help route need a manual check (`#/settings`, `#/help`) before shipping.
- Status: NEEDS-OWNER

## PERF-4: Every other route is also statically imported
- Severity: P2
- Route / component / file:line: `src/App.tsx:22-34` (`Dashboard`, `Explorer`, `RecipeDetail`, `Planning`, `Journal`, `CustomRecipes`, `CookMode`).
- Defect (what a user sees): Only indirectly. All code for every screen is in the entry chunk (149 kB raw, 43 kB gzip) and the vendor chunks.
- Root cause: No `lazy()` on routes.
- Fix: Needs other owner: `src/App.tsx`. Use the same `lazy` pattern as PERF-3 for `CookMode`, `Journal`, `Planning` (Planner and Shopping and Pantry), `CustomRecipes`. Keep `Dashboard` and `Explorer` eager, since they are the first screens.
- Verification: Not prototyped beyond Settings. Expect a further 20-60 kB gzip reduction. Needs a measurement after the change.
- Status: NEEDS-OWNER

## PERF-5: Vendor chunking splits the first load into 18 requests
- Severity: P2
- Route / component / file:line: `vite.config.ts` (rolldownOptions.codeSplitting.groups).
- Defect (what a user sees): Eighteen requests before the app renders. Each one adds round-trip time on mobile.
- Root cause: The `vendor` group caps chunks at 400 kB, which splits React, Supabase and the rest into many small files.
- Fix (what I changed): Added a `supabase` group (`/node_modules\/@supabase\//`, max 400 kB) and raised `vendor` `maxSize` to 2 MB. The Supabase group is only useful together with PERF-3: without it, the raised vendor limit would pull the SDK into the first load.
- Verification: `npx vite build` clean. Initial files 18 → 12. Initial gzip 376.8 → 374.7 kB (same source snapshot). Measured: FCP and load are a little faster, but this is within noise. The bytes saving comes from PERF-3. `npx eslint vite.config.ts` and `npx tsc -p tsconfig.node.json --noEmit` pass.
- Status: FIXED-VERIFIED (small effect on its own)

## PERF-6: The service worker precaches 3.25 MB, including all recipe JSON, on first visit
- Severity: P2
- Route / component / file:line: `vite.config.ts` (`VitePWA`, `workbox.globPatterns`, `includeAssets`).
- Defect (what a user sees): The first visit downloads roughly 3.3 MB in the background before the offline cache is ready, on top of the page itself. Repeat visits are unaffected.
- Root cause: `generateSW` precaches every JS chunk and every category image so the app works offline.
- Fix: Not changed. Offline use is a stated feature (`index.html` description). Options: precache only the recipe chunks on first open (runtime cache), or keep as is. Product decision.
- Verification: Precache 4876 kB → 3252 kB after PERF-1. Precache list checked in `dist-*/sw.js`.
- Status: OPEN (product decision: which assets must work offline on first install)

## PERF-7: Illustrations have no intrinsic size, so the browser cannot reserve space before load
- Severity: P2
- Route / component / file:line: `src/components/UI.tsx:120-126` (`<img src alt loading decoding onError>`).
- Defect (what a user sees): No layout shift is measured today, because the card has a fixed aspect ratio in CSS. The gap is a fragile dependency on CSS and not on the image's own dimensions.
- Root cause: No `width`/`height` attributes on the `<img>`.
- Fix: Needs other owner: `src/components/UI.tsx` (shared component). Add `width={1200} height={800}` (the source size of the re-encoded files). That lets the browser set the aspect ratio before the file loads.
- Verification: Not changed. CLS measured 0 to 0.002 on Explore, Recipe and Planner; 0.008 on Today (see PERF-8).
- Status: NEEDS-OWNER

## PERF-8: Today's hero text block collapses after data loads, causing a layout shift
- Severity: P2
- Route / component / file:line: Today (`/`), hero block with class `hero-facts` (Dashboard page).
- Defect (what a user sees): Around 2.9 s, the hero's facts line disappears and the paragraph above it shrinks (44 → 37 px). The content below moves up. The shift is small (CLS 0.0075) but visible.
- Root cause: The facts block renders only after data is available (Dexie read), with no reserved height.
- Fix: Needs other owner: Dashboard owner. Reserve `min-height` on `.hero-facts` (and render a placeholder row while loading), or render it with the first paint.
- Verification: Probe of layout-shift sources (`scripts/frontend-audit/tmp/perf/probe-cls.mjs`): sources `hero-facts 9.5 → 0`, `P 44.8 → 37.2`. Not fixed.
- Status: NEEDS-OWNER

## PERF-9: The hero heading font is discovered late
- Severity: P3
- Route / component / file:line: `index.html` (head); `src/main.tsx:7-9` imports the Fraunces subsets.
- Defect (what a user sees): The Fraunces heading renders with the fallback serif until the font arrives (about 0.5-1 s on Fast 4G). `font-display: swap` means no invisible text, so this is a small visual swap, not a block.
- Root cause: The font is found only after the CSS downloads.
- Fix: Needs other owner: `index.html` (shell owner). Add `<link rel="preload" href="/assets/fraunces-latin-500-normal-<hash>.woff2" as="font" type="font/woff2" crossorigin>`. The hash changes per build, so this needs a Vite plugin or a fixed-name import. Not worth it unless the swap is visible on real devices.
- Verification: Not measured. Font bytes on first load: 60-93 kB (7 woff2 files).
- Status: NEEDS-OWNER

## PERF-10: Explorer typing and heap growth (checked, no defect)
- Severity: P3
- Route / component / file:line: `src/pages/Explorer.tsx:140-150` (search input over 300 recipes).
- Defect: None found. Typing (21 keys, input → painted frame, 4x CPU): median 16-24 ms, p90 37 ms. Heap over 5 passes over 8 routes: 7.5 → 8.6 MB and flat after pass 2, +0.3 MB total.
- Root cause: n/a
- Fix: None needed.
- Verification: `scripts/frontend-audit/tmp/perf/measure.mjs`. Single typing run, so it is indicative only.
- Status: WONT-FIX (no defect found)
