# Performance audit: AirFuel Kitchen production build

Date: 2026-10-11. Owner: perf agent. Findings: `docs/frontend/findings/perf.md` (IDs `PERF-n`).

All numbers come from production builds (`vite build`), never the dev server.

## Method and commands

Source snapshot: the working tree was being edited by other agents, so the before/after comparison uses
two builds made from one copy of `src/`, `public/`, `index.html` and the configs. The only difference is
`public/images/*.webp`.

```bash
# 1. Snapshot the source (other agents keep editing the live tree)
P=/private/tmp/claude-501/airfuel-perf/proto
mkdir -p $P/before && cd /Users/raoof.r12/Desktop/Raouf/Fun
cp -R src public index.html vite.config.ts tsconfig*.json package.json $P/before/
ln -s /Users/raoof.r12/Desktop/Raouf/Fun/node_modules $P/before/node_modules
cp /private/tmp/claude-501/airfuel-perf/orig-images/*.webp $P/before/public/images/   # pre-change images
cp -R $P/before $P/after && cp public/images/*.webp $P/after/public/images/            # re-encoded images

# 2. Production builds (isolated output dirs)
cd $P/before && npx vite build --outDir $P/dist-before --emptyOutDir
cd $P/after  && npx vite build --outDir $P/dist-after  --emptyOutDir

# 3. Serve one build at a time on the perf port, then kill it
npx vite preview --outDir $P/dist-before --port 4190 --strictPort --host 127.0.0.1 &

# 4. Bundle sizes (initial-load JS/CSS raw + gzip, all chunks, service-worker precache)
node scripts/frontend-audit/tmp/perf/bundle-report.mjs $P/dist-before

# 5. Browser measurements: 390x844 @2x, CPU 4x, Fast 4G (150 ms RTT, 1.6 Mbps down, 0.75 Mbps up),
#    service worker blocked, fresh context per load, median of 5 runs
RUNS=5 node scripts/frontend-audit/tmp/perf/measure.mjs http://127.0.0.1:4190 $P/run-before.json

# 6. Startup catalogue validation cost (Node, median of 15)
npx tsx scripts/frontend-audit/tmp/perf/zod-parse.ts

# 7. Rendered illustration sizes per width
node scripts/frontend-audit/tmp/perf/image-sizes.mjs http://127.0.0.1:4190
```

Throwaway scripts live in `scripts/frontend-audit/tmp/perf/`. `measure.mjs` uses CPU throttling and
PerformanceObserver for LCP, CLS and long tasks. TBT is the sum of (long task − 50 ms) after first paint.
Lighthouse was not run: `lighthouse` is not installed and no offline copy exists in the repo.

Caveat: `vite preview` does not gzip responses, so transfer times are for raw bytes. Production hosts
compress them, which makes the network part of the Fast 4G numbers pessimistic for JS and CSS. Image
bytes are already compressed, so their numbers hold.

## Before / after (production, mobile profile, median of 5)

| Route | Metric | Before | After | Notes |
|---|---|---|---|---|
| Today `/` | LCP | 6708 ms (img) | 4352 ms (img) | LCP element is a category illustration |
| Today `/` | Images downloaded | 620 KB | 239 KB | |
| Explore `/explore` | LCP | 8644 ms (img) | 4652 ms (img) | |
| Explore `/explore` | Images downloaded | 975 KB | 383 KB | |
| Recipe `/recipe/air-fryer-chicken-thighs` | LCP | 5760 ms (img) | 4112 ms (img) | Hero image is LCP |
| Recipe | Hero image done | 5728 ms | 4090 ms | |
| Planner `/planner` | LCP | 3264 ms (h1) | 2608 ms (h1) | No images; run-to-run noise |
| All four routes | FCP | 2.9–3.5 s | 2.5–2.7 s | |
| All four routes | TBT | 80–231 ms | 0–92 ms | |
| All four routes | Longest task | 126–246 ms | 0–142 ms | |
| All four routes | CLS | 0–0.002 | 0–0.008 | Today: 0.008 from a text block, see PERF-8 |
| Explore | Typing latency, input → painted frame, 21 keys | median 16 ms, p90 38 ms, max 132 ms | median 24 ms, p90 37 ms, max 207 ms | Single run, noisy. Both are well inside budget and the code path is unchanged. |
| Memory, 5 passes over 8 routes | Heap | 7.5 → 8.6 MB, flat after pass 2 | same | No growth trend, so no leak found |

Bundle and precache (same source snapshot):

| Measure | Before | After (shipped config) | Prototype: Settings lazy (not shipped) |
|---|---|---|---|
| Initial-load files | 18 | 12 | 7 |
| Initial JS+CSS raw | 2040 kB | 2040 kB | 1798 kB |
| Initial JS+CSS gzip | 376.8 kB | 374.7 kB | 309.2 kB |
| Category illustrations (`public/images`) | 2663 kB | 1039 kB (−61%) | 1039 kB |
| Service-worker precache | 39 URLs, 4876 kB | 33 URLs, 3252 kB | 34 URLs, 3252 kB |

The 1.2 MB of recipe catalogue JSON is the largest item on the first-load path. It is 132 kB of gzip in
the two recipe chunks, which are preloaded because `src/App.tsx` imports the catalogue eagerly. Zod
validation of the 300 recipes takes about 6 ms in Node, so the cost is bytes, not parse time.

## What changed in owned files

1. **`public/images/*.webp`**: re-encoded the eight category illustrations at 1200 px wide, WebP q80
   (was 1536 px, q88). Cards render at 348–358 CSS px and the recipe hero at 350–678 CSS px, so 1200 px
   still covers DPR 2 on phones and DPR 1.8 on desktop. Visual check: side-by-side crop
   `scripts/frontend-audit/tmp/perf/crop-compare.mjs`, and `docs/frontend/screenshots/agents/perf/explore-390-final.png`
   at 390 px, DPR 2. The original webp files are kept at `/private/tmp/claude-501/airfuel-perf/orig-images/`.
   The source PNGs are not in the repo, so re-encoding from the existing WebP was the only option.
   The filenames are unchanged, so no source edits were needed.
2. **`scripts/prepare-images.mjs`**: same resize and quality settings, so a future regeneration matches.
3. **`vite.config.ts`**: split the Supabase SDK into its own chunk group and raised the vendor
   `maxSize` to 2 MB. First-load requests dropped from 18 to 12. Gzip is flat (+1.2 kB) on its own. The
   Supabase group only pays off together with PERF-3, which needs a change in a file I do not own.
   Build verified with `npx vite build`; eslint and `tsc -p tsconfig.node.json` pass on the two files.

Not changed: the PWA precache config. Offline use is a product feature, so the precache stays. The
largest remaining precache item is the recipe JSON (1.2 MB raw). Caching only the recipe chunk on first
open, rather than on install, is a product decision (see PERF-6).

## Needs other owners (exact changes are in the findings file)

- **PERF-2** (`src/data/catalogue.ts`, logic/data owner): make the catalogue async, so the recipe JSON
  leaves the first-load path. Estimated saving about 130 kB gzip. Not prototyped, because consumers read
  `catalogue` synchronously.
- **PERF-3** (`src/App.tsx`, shell owner): lazy-load `SettingsPage` and `Help`. Prototyped in a scratch copy
  only. Result against the images-only build: initial JS 2040 → 1798 kB raw, 377 → 309 kB gzip, Explore TBT 18 → 0 ms, FCP 0.2–0.5 s faster on every route. LCP does not move, because the LCP element is the illustration.
- **PERF-4** (`src/App.tsx`): other routes (CookMode, Journal, Planning, CustomRecipes) are also static
  imports. Estimated but not measured.
- **PERF-7** (`src/components/UI.tsx:120`): add `width="1200" height="800"` to the `<img>` so the browser
  reserves the aspect ratio before load.
- **PERF-8** (Dashboard, Today hero): the `hero-facts` block collapses from 9.5 px to 0 once data loads,
  which causes the only layout shift measured (0.0075 at about 2.9 s). Reserve its height.
- **PERF-9** (`index.html`, shell owner): add `<link rel="preload">` for the Fraunces 500 woff2 that the
  hero heading uses. Not measured.

## Verified as fine

- Fonts: `@fontsource` Latin subsets only, `font-display: swap`, 7 woff2 files (60–93 kB on first load).
  Text is never blocked.
- Recipe illustrations below the fold use `loading="lazy"`. Only the hero is eager.
- Duplicate dependencies: `npm ls` shows only `deduped` entries for react, zod and dexie.
- Typing and memory: see the table above.

## Limits

- One machine, one Chromium (Playwright), simulated throttling, five runs per route. Expect ±300 ms run to run on LCP.
- Prototype numbers (PERF-3, the vendor split) come from scratch copies. They are not shipped.
- Lighthouse, real-device, and field (CrUX) data were not collected.
- The shipped build is measured on the snapshot taken at the start, not the live tree.
