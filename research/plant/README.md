# Plant recipe research and reproduction

Frozen 11 October 2026: **150 distinct recipes** in `src/data/recipes-plant.json`.
Canonical SHA-256: `3380da6b240b68f741c715f2e8eb0151da7eeea73bfb789ff5fabded6cb7b446`.

| Category | Records |
|---|---:|
| Vegetarian | 45 |
| Breakfast | 27 |
| Snacks and sides | 38 |
| Desserts | 22 |
| Quick dinners | 18 |

There are 56 recipes with a declared total time of at most 35 minutes, 16 with estimated protein of at least 25 g per stated portion, and 19 tagged Budget-friendly. The latter is an editorial pantry-ingredient classification, not a surveyed price claim. Dessert and vegetable recipes are not falsely described as high protein.

## What was verified

Each retained recipe has an individually opened public technique/recipe source. Structured recipe facts, accessible article methods and recipe cards were checked, not just search snippets or collection titles. `verifiedAt` means the public source was checked on that date. It does **not** mean the adaptation was kitchen-tested, dietitian-reviewed, or tested on every Ninja model. Some manual source checks were performed by the collaborating researcher and handed over with explicit factual evidence and caveats. The final original methods include deliberate quantity, temperature, ingredient and equipment adaptations where stated.

The largest technique sources are Recipe This (59), Good Food Middle East (48), Indian Veggie Delight (10), and Good Food UK (5); the remaining 28 use 23 other publishers. Source attribution remains on each recipe. No commercial photographs are included. Instructions and descriptions are original prose. Saved provenance is limited to ingredient/serving/timing/nutrient facts, URLs, response status or hash where available, and editorial decisions; no full pages or publisher instruction passages are required to build the data.

Evidence files:

- `verified-sources.json`, `source-facts.json`, `yields.json`: Good Food page evidence and yield checks.
- `rt-evidence.json`, `rt-more-evidence.json`, `rt-facts.json`, `extra-facts.json`, `expansion-facts.json`, `indian-facts.json`: checked structured source facts. Some entries are research candidates rather than accepted recipes.
- `manual-facts.json`: concise evidence for individually reviewed additions and source caveats.
- `afcd-calculations.json`: exact edible ingredient grams, food-reference IDs, unrounded recipe totals and rounded per-portion results for all 92 calculated recipes.
- `afcd-reference.json` and `AFCD-nutrients.xlsx`: FSANZ AFCD Release 3 reference values and the official downloaded workbook.
- `product-profiles.json`: two explicitly attributed current Australian product-label profiles, used for gnocchi and black beans.

## Nutrition limits

**58 records retain publisher estimates** with the source serving convention and proportional ingredient quantities. Overseas tablespoons are converted to 15 ml explicitly rather than accidentally treated as Australian 20 ml tablespoons; cups are stated as metric volume, not invented ingredient gram weights. The source's rounded estimate may not sum exactly using 4/4/9 energy factors. The squash source leaves oil as a splash; its record openly states a 5 ml allowance and the resulting uncertainty. Publisher estimates are not laboratory measurements.

**92 records are recalculated**, including 90 using FSANZ profiles alone and two combining FSANZ with named manufacturer/retailer labels. Ingredient grams are multiplied by edible per-100-g composition values, summed, and divided by the stated number of portions. Protein, fat, carbohydrate and fibre are rounded to whole grams, energy to approximately 5 kcal. These are food-composition estimates, without cooking-retention, food-brand, evaporation or absorption modelling. All listed oil, batter and coating are counted; actual discarded coating changes intake. Cooked versus raw versus drained inputs are explicit. The gnocchi manufacturer does not report fibre; that recipe and its calculation evidence retain fibre as unknown, never zero. Mapped cheese and other generic profiles remain estimates for the named food type, not claims about a specific brand's exact formulation.

## Editorial and access exclusions

`editorial-rejections.json` has 13 original editorial decisions: one retired unsafe poached-egg method, seven other excluded/duplicate candidates, two assigned to the savoury stream, and three rejected publisher estimates retained only after explicit recalculation. This is a decision ledger, not 13 permanently absent dishes.

`expansion-decisions.json` records 10 additional notable decisions, including three excluded publishers. These ledgers are not a claim that every discovered URL received a full review. Factory reheats, seasoning-only variants, unresolved quantity/nutrition records, and oven/deep-fry recipes without a verified air-fryer technique were not used to fill the quota.

- Supergolden Bakes, Forks Over Knives and Silver Hills were removed after explicit automated-access/data-use restrictions were found; their recipe facts and derived authoring records were removed from this stream. Only policy URLs and exclusion reasons remain.
- Skinnytaste aggregation restrictions, blocked sources, paywalls and challenges were not bypassed. SharkNinja US, Kitchen Stories and inaccessible Ninja EU material did not become plant recipes.
- Recipe This and the main batch-research hosts had recipe-path robots checks. Public browser/web reads on other hosts are recorded as such. Robots allowance is not a copyright licence or a blanket permission claim.
- Red Sun Farms' salad page was publicly read, but its robots/home requests returned HTTP 502. Its policy status is explicitly unconfirmed. Sandhya's later privacy check hit a challenge. Neither outcome is described as permission granted.
- SecondRecipe has a broad content-reuse clause; factual adaptation with attribution and original instructions was retained after the root audit, with that policy ambiguity documented in the shared host audit.

The final host audit and wider source register are maintained by the root researcher outside this stream. Local use does not establish commercial republication rights.

## Food and label checks

Raw-egg bakes use an explicit set-centre/temperature check where needed. The COSORI pasta adaptation requires a 75°C filling and safely secured cover, with its original very-hot broil finish explicitly adapted. Ramekin poached eggs were retired after the current Good Food guide discouraged that method. Rice recipes require properly chilled rice and thorough reheating; the crispy-rice salad is served immediately. Times assume the stated basket capacity; extra batches increase time. Allergen checks include soy sauce's wheat and gluten, peanuts, egg, dairy, and the pine nuts in the stuffed shells. Vegetarian cheese and stock should be selected as named. Users still need actual package-label checks for compound ingredients and cross-contact; dietary tags do not certify an allergen-free kitchen.

## Rebuild and checks

From the project root, using Python 3 and the retained factual inputs:

```sh
python3 research/plant/build_adapted.py
python3 research/plant/validate.py
```

The builder composes `build.py`, the AFCD authoring modules, publisher-estimate modules, and `polish.py`. It writes only the plant canonical JSON and plant evidence files. The validation command is read-only and uses no network. It verifies count/IDs, quantities, time components, banned-host absence, explicit allergen/dietary conflicts, and independently recomputes all 92 calculated nutrition records from the saved composition profiles. It passes with zero errors. A separate temporary-directory rebuild reproduced the canonical bytes exactly, without changing the running application's data.

The `collect*.py`, `crosscheck.py` and `resolve_yields.py` files are historical research utilities, not required build steps. Some expect temporary review files and live pages may change; review current robots/terms and access failures before a fresh research run. Do not interpret a successful offline build as a fresh live source check. Full application/schema/browser checks belong to the root project's validation suite.
