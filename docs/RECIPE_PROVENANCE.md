# Recipe provenance

The delivered catalogue contains **300 recipes**, retaining the user's requested total during the UI upgrade. It has **300 distinct primary source URLs** and **344 distinct reference URLs** overall. Documentary verification and original Australian-metric adaptations were completed during the preceding research/build stage on 11 October 2026. This upgrade did not invent later verification dates or count collection/search pages as individual recipes.

Authoritative records:

- [Per-recipe source register](../research/source-register.json): titles, source URLs, recorded check dates, nutrition method and canonical file hashes.
- [Structural/arithmetic validation](../research/validation-report.json): 300 records; the current `npm run validate:data` run reports 0 errors and 113 warnings. The review list is in [docs/backend/RECIPE_DATA_REPORT.md](backend/RECIPE_DATA_REPORT.md).
- [Research method and update procedure](NUTRITION-AND-RESEARCH.md): access-policy decisions, adaptations, provenance criteria and source-check limitations.
- `research/plant/` and `research/savoury/`: individual factual research, ingredient mappings, acceptance/rejection decisions and stream reports.
- [Image provenance](IMAGES.md): eight authorised generated category illustrations. These are explicitly labelled category illustrations, not exact photographs of the recipes.

Both canonical SHA-256 hashes were recomputed during the upgrade and match the source register:

| File | Recipes | SHA-256 |
|---|---:|---|
| recipes-plant.json | 150 | `3380da6b240b68f741c715f2e8eb0151da7eeea73bfb789ff5fabded6cb7b446` |
| recipes-savoury.json | 150 | `97730df5aeb2a0f78d2d7293152abba3e7635914da3d21a94a4abd64ec1dbc5e` |

Source checking is not physical kitchen testing. Source access and content may change after the recorded check. Unaccepted research candidates are not counted as published recipes. Rebuilding the register is an offline indexing operation and never constitutes a fresh web verification.
