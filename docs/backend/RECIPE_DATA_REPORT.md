# Recipe data and nutrition audit (DATA-*)

Date: 2026-10-11. Scope: the 300 canonical recipes in `src/data/recipes-savoury.json` and `src/data/recipes-plant.json`, the research evidence in `research/`, and the checks in `scripts/validate-data.ts`, `scripts/data-rules.ts` and `tests/unit/backend-data-catalogue.test.ts`. No source was re-fetched online in this pass except the one tempeh page the lead verified. No recipe was cooked or lab-tested.

## Current state

| Measure | Count |
|---|---:|
| Recipes | 300 (150 savoury, 150 plant) |
| Unique IDs, slugs, normalised titles | 300 / 300 / 300 |
| Distinct primary source URLs | 300 (344 across all sources) |
| Parse against `recipeSchema` | 300 / 300 |
| `npm run validate:data` errors | **0** (exit 0) |
| `npm run validate:data` warnings | 113 (review items, not failures) |
| Fully validated (no errors and no flags) | 257 |
| Recipes needing manual review (any flag) | 43 |
| Incomplete source evidence (web read, no HTTP status) | 13 |
| Publisher-based (`source-estimate`) nutrition | 118 |
| Calorie cross-check outside tolerance | 36 (12 publisher, 24 AFCD) |
| Fibre unknown (`null`) | 6 |
| Calculated nutrition reproduced from AFCD | 179 of 182 (3 use product-label profiles absent locally) |
| Near-duplicate candidate pairs | 2 |
| NSW 75 °C mince/rolled decision candidates | 26 |
| Volume units on solid ingredients | 31 lines |

Warnings by kind: 26 NSW 75 °C, 36 calorie cross-check, 31 volume-on-solids, 17 short instruction sets (2 steps), 3 total times above 480 min. Total 113.

## Claims checked

- **128 main meals with at least 25 g protein per serving: TRUE.** Counted over 213 mains (every category except breakfast, snacks-sides and desserts): chicken-turkey 24/32, meat 27/38, seafood 23/31, vegetarian 9/45, quick-dinners 45/67. The definition includes the vegetarian category. Without vegetarian it is 119 of 168. Now stated in `README.md` and `docs/NUTRITION_METHOD.md`.
- **99 / 47 / 15 recipes at least 30 / 40 / 50 g protein:** TRUE.
- **Plant README counts:** 56 recipes at most 35 min, 16 mains at least 25 g, 18 quick-dinners: TRUE.
- **182 calculated and 118 publisher estimates:** TRUE.
- **Air-fryer temperatures** 120–220 C, inside the 60–240 C appliance range: TRUE.
- **Poultry, fish and meat core temperatures:** no violation after DATA-1 was resolved as a false positive (see below).
- **Allergen and dietary labels:** no undeclared keyword and no label conflict after documented false-positive exclusions (coconut milk and cream, cream-style mustard, nut butters, corn tortilla chips, vegetarian mincemeat).
- **`air-fryer-chicken-thighs`:** the record has 4 bone-in thighs for 4 servings, portion "One of 4 equal portions". The portion count is consistent. See DATA-4 for the magnitude question.

## Proposed corrections and status

| ID | Severity | Recipe(s) | Finding | Proposed correction | Status |
|---|---|---|---|---|---|
| DATA-1 | P1 (was) | roast-cauliflower-chickpea-chicken-salad | `internalTempC` null for chicken | No change. Only pre-cooked, chilled chicken (ingredient `form: "cooked"`), with a safety line on refrigeration. The rule now exempts this case and fails raw poultry or meat with no temperature. | **Resolved: false positive.** Rule and tests added. |
| DATA-2 | P2 | air-fryer-maple-soy-tempeh | No evidence record for https://dailydish.co.uk/air-fryer-tempeh/ | Added one record to `research/plant/verified-sources.json`: HTTP 200, 2026-10-11, sha256 `c1b6bc…454a41`, title. No nutrition or timing invented. | **Resolved.** |
| DATA-3 | P2 | 13 savoury records with `httpStatus: null`: meat-and-rice-stuffed-peppers, air-fryed-egg-rolls, harissa-alaska-cod-rice-bowls, air-fried-alaska-salmon-with-israeli-salad-couscous, air-fryer-chicken-kiev, chicken-katsu-curry, garlic-butter-lobster-tails, air-fried-teriyaki-bacon-wrapped-dates, air-fryer-buffalo-chicken-livers-with-blue-cheese-dipping-sauce, ginger-tamari-fish-parcels, pork-souvlaki-skewers, roast-cauliflower-chickpea-chicken-salad, salmon-gnocchi-spinach-pesto | Web read only, no transport-level evidence. `garlic-butter-lobster-tails` cites a NOAA `/insight/` article, which may not be an individual recipe page. | Re-open each source, record status and date. Confirm the lobster URL is an individual recipe. | Open, for research owner |
| DATA-4 | P2 | air-fryer-chicken-thighs | 11 g protein, 111 kcal, 8 g fat per portion from a publisher estimate with no thigh weight. Fibre 0.3 g; AFCD chicken fibre is 0. The stated values are internally consistent with about 48 g cooked edible per thigh (11/0.231, 8/0.161 and 111/2.36 all give 47–50 g). That is light for a bone-in, skin-on thigh. Premise corrected: 4 thighs for 4 servings, not 2 for 2. | Weigh the cooked edible meat and skin from the 4 thighs and divide by 4. Recalculate with AFCD F002807 (baked, skin and fat: 23.1 g P, 16.1 g F, 987 kJ per 100 g). Set fibre to 0. | Open, needs a weighed thigh; not invented here |
| DATA-5 | P1 owner decision | 26 minced, stuffed or rolled meat and poultry recipes below 75 °C. At 71 °C (18): air-fryer-meatballs, air-fryer-pork-apple-sage-sausage-rolls, air-fryer-meatball-potato-traybake, air-fryer-pork-apple-burgers, air-fryer-lamb-kofta-kebabs, air-fryer-meatloaf, air-fryer-pork-in-blanket-turnovers, air-fryer-pork-potato-kofte, air-fryer-smash-burgers-with-cheese-bacon, air-fryer-harissa-sausage-veg-traybake, air-fryer-toad-in-the-hole, big-mac-tacos-in-air-fryer, air-fryer-chilli-con-carne, air-fryer-doner-kebab, air-fryer-harvest-casserole, air-fryer-pizza-fries, how-to-make-the-best-ever-juicy-lucy-cheese-burger-in-the-airfryer, spicy-italian-sausage-capsicum-mushroom-onion-subs-recipe. At 74 °C (8): air-fryer-turkey-meatballs, air-fryer-turkey-burgers, copycat-kfc-zinger-chicken-burger-in-the-airfryer, bell-pepper-stuffed-chicken-roll-ups, pandan-leaf-chicken, thai-chicken-meatballs, bruschetta-chicken, chicken-patties-and-one-dish-chicken-rice. | Owner decides whether NSW 75 °C applies. If adopted, raise these 26 to 75 °C. | **Owner decision.** Warning in the validator, pinned count in the test. |
| DATA-6 | P2 | 36 calorie outliers. Publisher (12): air-fryer-sweet-potato-fries, air-fryer-sweet-potato-hash, air-fryer-brussels-sprouts, air-fryer-parsnips, air-fryer-veggie-curry, air-fryer-veggie-sausage-casserole, air-fryer-spiced-carrot-fries, air-fryer-roasted-veg, air-fryer-miso-aubergine, air-fryer-broccoli, air-fryer-buffalo-cauliflower-wings, air-fryer-sweetcorn-fritters. AFCD (24) largest: white-bean-polenta-bruschetta (560 vs 474), dal-with-air-fryer-tofu (685 vs 602), air-fryer-chestnuts (130 vs 85), whole-30-life-changing-airfryer-veggie-pakoras (305 vs 240), air-fryer-roasted-artichokes (180 vs 124). | Tolerance is max(10 % of kcal, 10 kcal); fibre counted at 2 kcal/g. | Review the 12 publisher estimates. For the AFCD ones, document the energy-factor difference or change the method. | Open, for research owner |
| DATA-7 | P2 | 31 `ml` lines on solids: e.g. almond-hemp-granola (355 ml rolled oats, 118 ml almonds), tandoori-paneer-naan-pizza (118 ml paneer, 177 ml mozzarella), broccoli-ricotta-stuffed-shells (118 ml ricotta), air-fryer-fishcakes (75 ml plain flour), air-fryer-stollen-bites (60 ml icing sugar), air-fryer-soda-bread (30 ml porridge oats), malai-broccoli (59 ml processed cheese). | Contract asks for edible weights. Shopping never converts ml to g, so these cannot aggregate with weighed items. | Convert to grams with a stated density, per research decision. | Open, for research owner |
| DATA-8 | P3 | Duplicate candidates: air-fryer-omelette and air-fryer-scrambled-eggs-on-toast (same ingredient names: eggs and butter); air-fryer-steak-fajitas and air-fryer-chicken-fajitas (same method and seasoning, protein swap) | Two near-duplicate pairs | Editorial: merge, or make the dishes meaningfully different (the contract asks for that). | Open, editorial decision |
| DATA-9 | P3 | Slug and title mismatch: apricot-orange-horseradish-…-rainbow-confetti-salad (title "Apricot chicken with crunchy pecan salad"); cod-in-air-fryer (title "Hoki with roast cherry tomatoes"); coconut-lime-cod-cauliflower-rice (title "Coconut fish", uses hoki); spicy-italian-sausage-…-subs-recipe (title "rolls", beef sausages); fish-otah | IDs are stable keys for user data | Keep IDs. Correct titles and descriptions only. | Open, for research owner |
| DATA-10 | P3 | Total time over 480 min: air-fryer-tea-loaf (833), best-ever-philips-airfryer-new-york-cheesecake (777), air-fryer-tandoori-chicken-kebabs (520) | Warning only | Confirm an overnight soak or chill is intended. Consider separating active and passive time. | Open, for research owner |
| DATA-11 | P3 | 17 recipes with only 2 steps, e.g. air-fryer-onions, air-fryer-cabbage, paneer-tikka, malai-broccoli | Possibly incomplete instructions | Editorial check for times, temperatures and doneness criteria. | Open, for research owner |
| DATA-12 | P3 docs | `README.md`, `docs/NUTRITION_METHOD.md`, `docs/RECIPE_PROVENANCE.md`, `research/README.md` claimed zero errors and warnings | Stale | Updated to 0 errors and 113 warnings, with the 128-mains definition stated. | **Resolved.** |

## Owner decisions still open

- DATA-5: whether NSW 75 °C applies to the 26 minced, stuffed or rolled recipes.
- DATA-4: a weighed thigh is needed before the chicken-thigh nutrition can change.

## Test ledgers

`tests/unit/backend-data-catalogue.test.ts` holds no known defects now. The core-temperature and plant-evidence ledgers are empty. Pinned counts (13 web-read-only, 26 NSW candidates, 128 protein mains, 36 Atwater outliers at most, 31 volume lines at most, 2 near-duplicate pairs) make new drift visible.

## Not verified

- No live re-fetch of sources, apart from the tempeh page the lead verified.
- No kitchen or laboratory test.
- The NSW guidance was taken from the lead's description, not re-read.
- Image generation IDs cannot be checked offline.
- Three label-profile records (salmon-gnocchi-spinach-pesto, pesto-mozzarella-gnocchi, air-fryer-black-bean-burgers) were not recomputed.
