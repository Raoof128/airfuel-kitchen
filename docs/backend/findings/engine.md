# Engine findings (ENG)

Owner: `src/lib/engine.ts`. Tests: `tests/unit/backend-engine-*.test.ts`, fixtures in `tests/unit/backend-engine-fixtures.ts`.

## What the recommender is
Rule-based scoring. No ML, no model, no server. `recommendRecipes` applies hard constraints first (allergens, dietary claims, avoided ingredients, oil-free, fast-mode time cap), then adds signed points per signal. The only randomness is `surprise` mode (`random() * 50`), which is now injectable via `options.random`. The clock for the "cooked recently" window is injectable via `options.now`.

Signals (points): fits `maxMinutes` 20 + up to 8 (over-time: minus the overrun minutes); protein at or above target +20; protein toward target up to +6 (silent); untried +12; favourite +16; rating (rating-3)*8 (silent when rating below 4); category rated highly +10 (now needs 2 recipes rated 4+); preferred protein +10; favourite ingredient +8; favourite cuisine +6; each disliked ingredient -25; cooked in the last 7 days -25 (silent); pantry match (matched/total)*20, or *90 in pantry mode. Diversity: -10 per category already on the list (ordering only). Reasons: the four with the most points, positive only.

## FIXED findings

## ENG-1: free-text avoid list matched substrings
- Severity: P2
- Module / file: `src/lib/engine.ts` `recommendRecipes` (avoid, dislike, preferred protein, favourite ingredient, cuisine matching)
- Reproduction: avoid `egg` removes 4 eggplant/aubergine recipes. Avoid `pea` removes all 5 peanut recipes (`tests/unit/backend-engine-safety.test.ts`, "avoided ingredients match words").
- Root cause: `haystack.includes(needle)` on the joined text.
- Fix: `mentions()` matches whole words and their head-noun endings with plurals (`egg` matches `eggs`, `peanut butter`; not `eggplant`; `pea` not `peanut`). Empty entries match nothing. Known over-match, deliberately conservative: `pea` still matches `chickpea`.
- Regression test: `backend-engine-safety.test.ts` avoid-list block.
- Status: FIXED-VERIFIED
- DECISION for lead: a bare `nut` now also matches `peanut`, `walnut`, `coconut` via the suffix rule. That is the intended conservative direction. Free-text avoid entries are not allergen declarations, so the allergen enum remains the authority.

## ENG-2: a free-text avoid entry of `eggs` was briefly a regression during ENG-1
- Status: FIXED-VERIFIED. My first version of ENG-1 dropped plural matching, so `avoid egg` kept egg recipes. Caught by the safety test before it shipped. Plural forms are now explicit (`s`, `es`, `ies`).

## ENG-3: search avoid list not applied on search surfaces
- Severity: P2
- Module / file: `src/lib/engine.ts` `filterRecipes` (new `avoidIngredients` filter); callers `src/pages/Explorer.tsx:94`, `src/pages/Planning.tsx:130`
- Reproduction: `filterRecipes` ignored `preferences.avoidIngredients`, so Explorer and Planning search returned recipes the user said never to recommend.
- Root cause: avoid list was applied only inside `recommendRecipes`.
- Fix: `RecipeFilters.avoidIngredients` added and applied before any other check. Needs other owner: `src/pages/Explorer.tsx` (the `filterRecipes` options object near line 94) and `src/pages/Planning.tsx` (line 130) must pass `avoidIngredients: data.preferences.avoidIngredients`.
- Regression test: `backend-engine-safety.test.ts` "avoid lists are hard in search and recommendations".
- Regression test: see above.
- Status: NEEDS-OWNER for the two UI call sites (engine side FIXED-VERIFIED).

## ENG-4: wheat and gluten not treated as one allergen
- Severity: P2 (defence in depth; the current catalogue is consistent, so no recipe leaks today)
- Module / file: `src/lib/engine.ts` `filterRecipes`
- Reproduction: no bypass found in the catalogue (checked: no recipe declares wheat without gluten). The engine trusted declarations alone.
- Fix: `allergenClosure()` makes excluding gluten also exclude wheat, and the reverse.
- Regression test: `backend-engine-safety.test.ts` "treats a gluten exclusion as also excluding wheat".
- Status: FIXED-VERIFIED

## ENG-5: explanations listed the first four reasons, not the strongest
- Severity: P2 (explanation does not match the ranking)
- Module / file: `src/lib/engine.ts` `recommendRecipes` reasons
- Reproduction: in pantry mode, the pantry match was the strongest signal (up to 90 points) but was pushed past the 4-reason cut by earlier, weaker signals, so the UI never showed why the recipe was there.
- Root cause: reasons were sliced in insertion order, not by weight.
- Fix: reasons carry their points, are sorted by points, and only positive reasons appear. "Cooked recently" is no longer listed, since it demotes and is not a reason to recommend.
- Regression test: `backend-engine-scenarios.test.ts` "explains the pantry match in pantry mode", "explanations match the signal that produced the rank".
- Status: FIXED-VERIFIED

## ENG-6: one rating lifted every untried recipe in its category
- Severity: P2 (ranking)
- Module / file: `src/lib/engine.ts` `likedCategories`
- Reproduction: a single 5-star rating gave +10 to every untried recipe in that category.
- Fix: a category counts as liked after two recipes are rated 4 or more (`minimumLikedCategory`).
- Regression test: `backend-engine-scenarios.test.ts` "one rating is not overweighted".
- Status: FIXED-VERIFIED

## ENG-7: pathological search queries were slow
- Severity: P2
- Module / file: `src/lib/engine.ts` `filterRecipes`
- Reproduction: a 1,500-token query (`"chicken "` repeated) took about 390 ms per call in the probe, because the recipe word list was rebuilt for every token.
- Fix: word list built once per recipe, duplicate tokens removed.
- Regression test: `backend-engine-search.test.ts` "pathological search input" (long-query timing budget, deduplicated tokens).
- Status: FIXED-VERIFIED (1,500-token query 387 ms before, 0.42 ms after)

## ENG-8: `recommendRecipes` was O(n^2 log n) in the variety loop
- Severity: P3 (measured hotspot)
- Module / file: `src/lib/engine.ts` `recommendRecipes`
- Fix: one linear pass per pick instead of re-sorting the whole pool. Same order (ties by id). Before the fix, a 300-item limit call took several hundred milliseconds.
- Status: FIXED-VERIFIED (existing engine tests and the new scenario tests pass with unchanged ordering)

## ENG-9: returned `score` depended on the other results in the same list
- Severity: P3
- Module / file: `src/lib/engine.ts` `recommendRecipes`
- Root cause: the returned `score` was the diversity-adjusted value at the moment of selection, so a recipe scored differently in different lists. The UI does not read `score` (grep confirms), so the change is safe.
- Fix: the returned `score` is the recipe's own score. Diversity still decides order.
- Status: FIXED-VERIFIED

## ENG-10: "surprise" and "recent" used the wall clock and Math.random
- Severity: P3 (testability)
- Fix: `RecommendOptions { now?, random? }` as the optional 5th parameter. Defaults keep the existing call sites unchanged.
- Status: FIXED-VERIFIED

## ENG-11: shopping rows with a zero-rounded quantity were listed
- Severity: P2
- Module / file: `src/lib/engine.ts` `buildShoppingList`
- Reproduction: a 0.0003 g need was kept (row > 1e-8) then rounded to 0, shown as "0 g".
- Fix: drop rows after rounding.
- Status: FIXED-VERIFIED

## ENG-12: positive shopping amounts formatted as "0 tsp" or "0 g"
- Severity: P2 (wrong display of a real need)
- Module / file: `src/lib/engine.ts` `formatShoppingAmount`
- Reproduction: `formatShoppingAmount(0.4, "ml")` = "0 tsp"; `formatShoppingAmount(0.04, "g")` = "0 g".
- Fix: a positive need never reads as zero: `nearestSpoonsForNeed` floors at a quarter teaspoon; `atLeastTenth` keeps small positive values at 0.1.
- Regression test: `backend-engine-nutrition.test.ts` (added below)
- Status: FIXED-VERIFIED

## ENG-16: the same recipes cycled for a year (diversity)
- Severity: P2 (ranking: "endless repeats")
- Module / file: `src/lib/engine.ts` `recommendRecipes` recency
- Reproduction: `scripts/backend-audit/tmp/engine/bench.ts` simulates a year of cooking the top "tonight" pick each day. Before: 17 distinct recipes, one recipe 46 times, returns every 8 days (median gap 8).
- Root cause: the only repeat control was a flat -25 for 7 days, after which the same high-protein recipes won again.
- Fix: graded recency. -25 cooked in the last 7 days (unchanged), -10 cooked in the last 28 days, and -10 per cooking in the last 90 days (capped at -40). Sweep results (same simulation): cost 3/cap 12: 54 distinct, max 36, median gap 28. Cost 5/cap 20: 57 distinct, max 29. Cost 8/cap 30: 58 distinct, max 16, min gap 14. Cost 10/cap 40 (chosen): 58 distinct, max 13, min gap 25, median gap 33.
- Behaviour change to flag: a recipe cooked twice in 90 days now ranks noticeably lower than before. The scenario test "repeat a favourite" pins the new shape (-35 yesterday, -20 ten days ago, 0 after 100 days).
- Regression test: `backend-engine-scenarios.test.ts` "diversity over a month of cooking" and "repeat a favourite".
- Status: FIXED-VERIFIED, constants ACCEPTED by lead

## ENG-17: recommendation and search cost measured and reduced
- Severity: P3 (measured hotspot)
- Module / file: `src/lib/engine.ts` `recipeWords` (WeakMap cache), `filterRecipes`, `recommendRecipes`
- Measured before: `filterRecipes` about 1.4 ms per call (rebuilt each recipe's word list for every call); a 1,500-token query 387 ms.
- Measured after (load average about 20 on this machine, so numbers are noisy): `filterRecipes` p50 0.24 to 0.49 ms, the 1,500-token query 0.42 ms p50. `recommendRecipes` tonight p50 about 2 ms. Benchmark: `scripts/backend-audit/tmp/engine/bench.final.out`.
- Status: FIXED-VERIFIED

## ENG-18: exhaustive engine tests needed an explicit time budget
- Two exhaustive loops (every allergen by every mode, and 500 random filter combinations) hit vitest's 5 s default when the machine was loaded. Assertions are unchanged; each now has a 30 s budget.
- Status: FIXED-VERIFIED

## ENG-19: override ingredients could add an excluded allergen (P1, SEC-1)
- Severity: P1 (allergen-exclusion bypass, reached from backup import on every surface, via `effectiveRecipes` in `App.tsx`)
- Module / file: `src/lib/engine.ts` `effectiveRecipes`
- Reproduction: a backup override of `air-fryer-sweet-potato-fries` adding `roasted peanuts` was returned by `recommendRecipes` and `filterRecipes` under `excludeAllergens: ["peanut"]`. An override adding `chicken thighs` was returned under `dietary: ["vegetarian"]`. (`scripts/backend-audit/tmp/engine/sec1.ts`.) The canonical allergen and diet claims were kept, but the ingredient list was trusted.
- Root cause: the merge only intersected claims. It never compared the override's ingredients with the canonical recipe's.
- Fix: when the override's ingredients differ from the canonical list, the recipe fails closed: `allergens` becomes every allergen name, `dietary` becomes `[]`, `oilFree` becomes false. Overrides with unchanged ingredients behave as before.
- Regression test: `backend-engine-safety.test.ts` "an override that changes ingredients fails closed".
- Status: FIXED-VERIFIED. The `it.fails` cases in `tests/unit/backend-security-integrity.test.ts` (SEC-1) should now be converted to plain `it` by the security owner.

## ENG-20: full-suite flakiness in my tests
- The 30 s budgets I had added were not enough for every run under load. The "allergen under jitter" and "peanut" failures seen in the parallel run were timeouts on exhaustive loops, not a leak on the real catalogue. The override path was the real leak, and the real-catalogue tests could not see it.
- Change: the random-combination test is bounded at 150 seeded rounds (about 0.4 s alone). The exhaustive safety loops keep their 30 s budget. Date-sensitive scenarios pin `now` and use fixed dates, so they do not depend on the wall clock.
- Status: FIXED-VERIFIED (two full runs: my suites green both times)

## OPEN / DECISION

## ENG-13: teaspoon display rounds to nearest, not up
- Severity: P3
- Module / file: `src/lib/engine.ts` `formatShoppingAmount`, `nearestSpoons`
- Evidence: `formatShoppingAmount(1.7, "ml")` = "⅓ tsp" (1.67 ml), 0.03 ml under the need. The existing test `tests/unit/shopping-amounts.test.ts` asserts that value, so changing it would mean weakening a valid test. The comment in engine.ts says amounts are rounded up, which is true only for tablespoons.
- Status: DECISION ACCEPTED by lead: keep nearest rounding, documented in API.md.

## ENG-14: "time cap" is soft outside fast mode
- Severity: P3 (product decision)
- Evidence: in tonight mode a recipe over `maxMinutes` is penalised by its overrun, not removed. The scenario test "only 15 minutes" shows most top results fit, but a long recipe can still appear.
- Status: DECISION ACCEPTED by lead: keep as a soft preference.

## NEEDS OTHER OWNER (lead-owned UI and docs)

1. `src/pages/Explorer.tsx` line ~94 (the `filterRecipes` options object): add `avoidIngredients: data.preferences.avoidIngredients,`. Fixes ENG-3 on the Explorer search surface.
2. `src/pages/Planning.tsx` line ~130 (`choices = filterRecipes(recipes, {...})`): add `avoidIngredients: data.preferences.avoidIngredients,`. Fixes ENG-3 on the meal-planning picker.
3. DONE by engine (lead-approved): `src/lib/API.md` engine sections updated. Original note: document the new optional fifth argument `options: { now?, random? }` for `recommendRecipes`, the `avoidIngredients` filter, and that `score` is the recipe's own score (diversity affects order only). Line 37 says "explicit avoids" are hard constraints, which is now accurate for search as well.

## ENG-15: data safety scan
- No recipe in the catalogue has an ingredient that suggests an undeclared allergen (scan in `backend-engine-safety.test.ts`). No wheat-without-gluten. No vegan or vegetarian claim alongside an animal ingredient. No gluten-free claim alongside wheat or gluten. Keyword matches for "coconut milk", "coconut cream", nut butters and "cream-style" mustard are not dairy or nut allergens, so the test strips them.
- Status: verified, no defect. Guard test added.

## Functions audited (disposition)
- effectiveRecipes: correct. Overrides can add allergens and remove dietary claims, never the reverse. Changed ingredients now fail closed (ENG-19), which corrects the earlier note that overrides could never weaken safety.
- filterRecipes: FIXED (ENG-1, ENG-2, ENG-3, ENG-4, ENG-7, ENG-17).
- recommendRecipes: FIXED (ENG-1, ENG-5, ENG-6, ENG-8, ENG-9, ENG-10, ENG-16, ENG-17).
- recipeWords (new helper): word list cache, see ENG-17.
- mentions (new helper): ENG-1, ENG-2.
- allergenClosure (new helper): ENG-4.
- scaleIngredients: correct, verified over 300 recipes (see nutrition tests).
- plannedNutrition / consumedNutrition: correct. Per-serving nutrition times servings; `tried` does not count.
- ingredientKey / buildShoppingList: ENG-11 fixed. Units are g, ml, each, tsp in the schema (no kg or L), so g/kg mixing cannot arise in data. Only display converts kg and L.
- formatShoppingAmount: ENG-12 fixed (zero display), litre and kilogram boundary fixed (999.96 ml now "1 L", was "1,000 ml"), ENG-13 open.
- localDate / weekDates: correct; covered by existing tests.

## ENG-21: avoid list missed spelling variants (red-team RT-B3, RT-B4, RT-B5)
- Severity: P2
- Module / file: `src/lib/engine.ts` (`fold`, `foldedRecipeWords`, `mentions` callers in `filterRecipes` and `recommendRecipes`)
- Reproduction: avoid `jalapeno` did not exclude "Jalapeño". Avoid `creme fraiche` did not exclude "crème fraîche". A zero-width space inside `e​gg` hid it from avoid `egg`. A Cyrillic `е` in `еgg` hid it too.
- Root cause: word splitting treated combining marks, format characters and Cyrillic letters as non-letters or different letters.
- Fix: the avoid list and preference matching fold both sides with NFKD, removal of combining marks and format characters (`\p{Cf}`, which includes zero-width and soft hyphen), mapping of common Cyrillic and Greek look-alikes to Latin, and lowercasing. Search text is folded too (see the status line below).
- Shopping keys are unchanged, so existing saved generated ticks keep their identity.
- Regression tests: `tests/unit/backend-redteam-engine.test.ts` RT-B3, RT-B4, RT-B5 (flipped from `it.fails` to `it` by the engine owner, as the lead asked).
- Status: FIXED-VERIFIED. Search is folded too (lead decision): "jalapeno" finds "Jalapeño". `search-words.test.ts` now expects that match and checks that `oil` still does not match `boiled`. Recipe objects are not changed, so display keeps the original accented text.
