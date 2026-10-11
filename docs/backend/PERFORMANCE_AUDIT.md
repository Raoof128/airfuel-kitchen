# Backend performance audit

Status: **partial.** The dedicated data-layer benchmark agent (`bperf`) ran for more than an hour but never produced results, and it was stopped. Its harness is not committed. Nothing below comes from it, and none of its numbers are claimed.

## Measured (engine agent, `docs/backend/findings/engine.md`)

Dataset: the full 300-recipe catalogue, 2,000 cooking sessions, 300 recipe states and 200 pantry items. Node 24.21 on Apple silicon. The machine load average was 20 to 26 during the run, so absolute times are noisy.

| Operation | p50 | Note |
| --- | --- | --- |
| `recommendRecipes` | ≈ 2 ms | Variety pick changed from O(n² log n) to linear (ENG-8) |
| `filterRecipes` / search | < 1 ms | Per-recipe word cache, about 5× faster filtering (ENG-17) |
| Pathological 1,500-token query | 387 ms → 0.4 ms | The red-team reproduced 0.25–0.34 ms after the fix. The headline gain is mostly from de-duplicating repeated tokens; distinct-token queries improved about 4× (ENG-7). |
| 64 KB search query | ≈ 918 ms → 4.9 ms | Security agent (SEC-5) |
| Weekly shopping aggregation | ≈ 1.2 ms | |

## Measured (production build, lead)

- First-load JavaScript: **295.6 kB gzip** (377 kB before the frontend sweep). The Supabase SDK and five screens are lazy-loaded, and every lazy chunk is in the service-worker precache.
- The frontend LCP, image and precache measurements are in `docs/frontend/PERFORMANCE_AUDIT.md`.

## Not measured

The following were not measured, and nothing is claimed about them:
- Dexie open/read/write latency distributions on large personal histories (5,000 sessions, 52 weeks of plans).
- Backup export/import time at the 20 MB cap.
- Main-thread blocking during import.

**PERF-2** (the 1.2 MB recipe JSON, about 130 kB gzip, loads before first render) remains **open**. The candidate options are:
1. Strip research-only fields from the runtime payload.
2. Load the catalogue asynchronously behind the existing "Opening your kitchen…" loader.

Neither has been benchmarked or implemented.
