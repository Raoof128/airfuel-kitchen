# Recipe data findings (prefix DATA)

Full report: [../RECIPE_DATA_REPORT.md](../RECIPE_DATA_REPORT.md). Corrections are listed there with evidence. Summary:

- DATA-1: P1 (reported), resolved as false positive. Cooked, chilled chicken is exempt when all poultry or meat ingredients are `form: "cooked"` and a safety line covers handling. Fish is never exempt. Tests: `backend-data-catalogue.test.ts`. Status: FIXED-VERIFIED.
- DATA-2: P2, resolved. One evidence record added to `research/plant/verified-sources.json` for air-fryer-maple-soy-tempeh. Status: FIXED-VERIFIED.
- DATA-3: P2, OPEN, research owner. 13 savoury records have no HTTP status. Status: OPEN.
- DATA-4: P2, OPEN, needs a weighed thigh. air-fryer-chicken-thighs nutrition is likely understated. Status: OPEN.
- DATA-5: P1, DECISION, owner. 26 minced, stuffed or rolled recipes below NSW 75 °C. Status: DECISION.
- DATA-6: P2, OPEN, research owner. 36 calorie cross-check outliers. Status: OPEN.
- DATA-7: P2, OPEN, research owner. 31 volume units on solid ingredients. Status: OPEN.
- DATA-8: P3, OPEN, editorial. Two near-duplicate pairs. Status: OPEN.
- DATA-9: P3, OPEN, research owner. Slug and title mismatches; IDs stay stable. Status: OPEN.
- DATA-10: P3, OPEN. Three total times above 480 min. Status: OPEN.
- DATA-11: P3, OPEN, editorial. 17 recipes with two steps. Status: OPEN.
- DATA-12: P3 docs, FIXED-VERIFIED. Stale validation claims updated.

Files changed by the DATA sweep: `scripts/validate-data.ts`, `scripts/data-rules.ts` (new), `tests/unit/backend-data-catalogue.test.ts` (new), `research/plant/verified-sources.json` (one record), `research/validation-report.json` and `research/source-register.json` (regenerated), `README.md`, `docs/NUTRITION_METHOD.md`, `docs/RECIPE_PROVENANCE.md`, `research/README.md` (claims only), and the two `docs/backend/` files.
