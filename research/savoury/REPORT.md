# Savoury recipe research

Final count: **150 recipes**, checked 11 October 2026. The complete catalogue validates at **300 recipes, zero structural errors and zero warnings**. This stream has 32 chicken/turkey, 38 meat, 31 seafood and 49 quick-dinner records. There are 112 recipes with at least 25 g estimated protein per serving and nine editorial budget tags; no price claims were made.

## Rebuild and validate

From the project root:

```sh
python3 research/savoury/build_dataset.py
npm run validate:data
```

The canonical editorial input is `authored.json`. The builder reads four factual source registers (`source-facts-review.json`, `more-source-facts-review.json`, `me-source-facts-review.json`, `expansion-source-facts.json`), the local `afcd-reference.json` subset and `product-profiles.json`. It writes `src/data/recipes-savoury.json` and `provenance.json`. It does not need network access or files from another research stream. Historical `author_*.py` scripts document drafting; **do not run them as the canonical regeneration command**, because later editorial corrections live in `authored.json`.

## Evidence and nutrition

Every counted recipe is linked to an individually read recipe page, with individual page retrieval/review and a review date in its factual record. Numeric HTTP evidence is retained where the retrieval tool exposed it; web-only reads use a null transport status, not an inferred 200. Research used public page views and structured ingredient metadata; the register records source yields, ingredient facts and published macros where present. Original instructions and measured adaptations were written separately. Current primary-source distribution: Recipe This 64; Good Food UK 29; Good Food Middle East 18; Ninja Malaysia 19; Ninja Australia 8; Ninja Philippines 1; Sunbeam Australia 4; Alaska Seafood 2; Food For Fitness 2; NOAA/Seafood Nutrition Partnership 1; Kikkoman 1; Paula Deen 1.

- **60 publisher estimates:** retained with the source ingredient and serving proportions, flagged `source-estimate`. They are not independently recalculated or laboratory verified. Source approximations, rounding, brands, count-to-weight conversions and actual serving sizes remain limitations.
- **89 AFCD calculations:** explicit edible gram weights and exact Australian Food Composition Database Release 3 IDs, summed and divided by the stated number of portions. Raw versus cooked forms are recorded. The ingredient-level mappings are in `provenance.json`.
- **One hybrid calculation:** salmon with gnocchi uses AFCD plus the independently viewed [San Remo Fresh Gnocchi label](https://sanremo.com.au/products/fresh-gnocchi/). Its uncooked per-100-g profile is retained in `product-profiles.json`; fibre is `null`, because the product label does not report it.

AFCD source: [Food Standards Australia New Zealand](https://www.foodstandards.gov.au/science-data/food-nutrient-databases/afcd), Release 3 nutrient profiles. Calculations count all listed oil, coating and marinade, even when some may remain in a bowl or basket. They do not model discarded drippings or cooking loss. This is conservative accounting, not a claim of measured absorption. Nutrient totals and ingredients scale together; cooking time does not scale linearly.

## Editorial and safety review

The existing recipe IDs were retained while adding distinct preparations and complete meals. New records include specific shapes or thicknesses, arrangements, turning points and thermometer endpoints. Poultry is 74°C, pork and mince 71°C, fish 63°C, and reheated mixed fillings 75°C; the site safety guide supplies broader handling guidance. Chilling, marinating, preheating, resting and known sequential batches are included or explicitly described as capacity-dependent additional time. Whole-joint scaling is cautioned separately.

A Sunbeam fish-parcel source suggested serving raw-contact marinade. The adaptation instead reserves a clean portion **before** adding raw fish and discards raw-contact excess. The cooked-chicken salad keeps chicken chilled and does not tell the cook to treat it as raw poultry. Prawn cucumber boats check temperature before chilling. Four misleading oil-free flags involving pastry or mayonnaise were removed, as was the chorizo quesadilla flag. Budget tags are qualitative ingredient-based judgements, not cost estimates.

Some recipes require bake mode, high-temperature capability, an approved accessory, a larger basket or multiple batches. Publisher techniques adapted from fixed-mode appliances are disclosed in their nutrition/editorial notes. These dishes have **not been kitchen-tested on the user's appliance**, and no claim of appliance-specific validation is made. Structural validation cannot establish texture, yield after cooking, allergen absence, nutritional accuracy or safety independent of actual handling and thermometer checks.

## Access, exclusions and retained material

Robots and terms were checked during source selection. Regional Ninja AU/MY clauses restrict copyrighted material and marks; the retained material is ingredient/technique facts plus new prose, with no copied photographs. The US SharkNinja terms expressly prohibit automated extraction: that stream was stopped, no US recipe was counted, and its temporary downloads/collector were removed. Allrecipes/EatingWell data-mining restrictions, Skinnytaste aggregation restrictions, The Dinner Bite's ChatGPT-User robots exclusion and Supergolden's text/data-mining prohibition were respected by excluding those streams. Access-limited pages were not bypassed.

Specific rejects include frozen convenience reheats, recipes that only use a grill/pressure cooker, seasoning-only variations, the MY chicken/rice recipe with an implausible three-minute rice instruction, the MY patties page with missing cooking time, and additional salmon-rice bowls and bacon-wrapped prawns that overlapped existing concepts. Several publisher nutrition figures conflicted with their quantities and were replaced with explicit AFCD calculations instead of being copied.

No publisher images are used. Full publisher instructions and temporary HTML have been removed from this directory. `finalise.py` removes temporary prose while retaining concise factual metadata and numerical temperature mentions. The source registers are an audit trail, not a licensed republication of the source recipes. Access findings are date-specific; collectors are historical research utilities and terms should be rechecked before any new fetch.
