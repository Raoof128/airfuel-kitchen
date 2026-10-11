# Nutrition and recipe research

## What a verified record means

A researcher opened the individual source page, checked that its main method uses an air fryer, compared ingredients, timings and serving conventions, and wrote original Australian-English instructions. Each app record includes the source title, HTTPS link and check date. Discovery search results and collection pages alone do not qualify a recipe. This is documentary verification, not a claim of physical kitchen testing or nutrition laboratory analysis.

The catalogue is adapted for a basket-style appliance, metric edible weights and everyday ingredients. Prep, preheating, resting/marinating and sequential batches must be reflected in the total time. Appliance capacity is editable, but the app cannot infer the dimensions of a specific basket or accessory. Size, spacing and thermometer endpoints take precedence over an assumed exact cooking time. Quantities labelled cooked, drained or frozen must be measured in that state.

Research decisions, ingredient mappings, concise source facts, HTTP evidence where available, and rejections are saved separately in `research/plant/` and `research/savoury/`. `research/expansion/` contains shared candidate research; candidates there are not automatically accepted catalogue records. Automated retrieval respects checked crawl restrictions and failures. Restricted or inaccessible sources were excluded, with no claim that access was verified. No source photographs are bundled.

## Two nutrition methods

**Publisher estimates** are retained only when the adaptation and serving convention support them. They are labelled `source-estimate`. Missing fibre remains unknown, not zero. Changing the serving yield requires scaling the entire ingredient list consistently; per-serving macros cannot be multiplied independently to reach a protein target.

**Ingredient calculations** use the Australian Food Composition Database (FSANZ, Release 3) as the preferred reference. The local reference table and original nutrient workbook are saved under `research/plant/`. Ingredient-specific mappings and gram assumptions are recorded in recipe calculation notes or the stream provenance register. Approximate analogue mappings are named; branded sauces, pastry, tofu and meat fat content can vary substantially.

For each nutrient:

```
batch nutrient = sum(edible input grams / 100 × reference nutrient per 100 g)
per-serving nutrient = batch nutrient / stated recipe servings
energy kcal = energy kJ / 4.184
```

Use raw reference food for raw edible input, and cooked/drained reference food for a stated cooked/drained input. Bone, shell and peel are excluded from edible gram assumptions. Cooking-related water loss changes the final food weight, not the total assumed protein of the batch. These estimates generally count all listed edible inputs, including coatings/oil, unless a documented mapping says otherwise. They do not claim measured retention factors for discarded marinade, drippings, coating left in a bowl or an individual appliance. This limitation is stated in calculation methods; nutrients are not falsely presented as measured cooked-food values.

Display rounding avoids laboratory-like precision. The app labels nutrient estimates and separates planned totals from food explicitly logged as eaten. Personal ingredient changes in the journal do not automatically recalculate the recipe's nutrition; edit the recipe estimate if a revised calculation is available.

## Australian measurements

The structured dataset uses grams, millilitres, each, 5 mL teaspoons and **20 mL Australian tablespoons**. US tablespoon sources need conversion rather than a silent one-to-one substitution. Each-based foods have explicit edible-weight assumptions for calculations. Shopping aggregation never assumes 1 g = 1 mL and does not combine raw and cooked forms.

## Safety and dietary labels

Relevant [NSW Food Authority guidance](https://www.foodauthority.nsw.gov.au/media/871) and the linked safety references in each record inform handling and thermometer notes. Temperature controls in a recipe describe the air fryer; internal food temperatures are separate. Poultry recipes require at least 74°C internally. Raw food must be kept separate from ready-to-eat ingredients. Secure liners beneath food, maintain airflow, and follow the appliance/accessory manufacturer's instructions.

Allergen labels describe the specified ingredients, not factory cross-contact certification. Check the actual packets, especially sauces, seasoning blends and substitutions. Unverified custom recipes are excluded from recommendations and filtered results whenever a saved allergy or dietary restriction applies. Canonical overrides cannot remove baseline safety/allergen protections simply by changing a label.

## Updating the collection

1. Check the site's current access policies and individually open a candidate source.
2. Compare the proposed dish against existing titles, ingredient proportions, methods and meal structure. Reject seasoning-only duplicates.
3. Record the source and actual verification date. Keep concise factual research notes, not copied articles or publisher instructions.
4. Write complete original steps; convert quantities and audit yield, batch timing, food safety, allergens and accessory requirements.
5. Recalculate nutrients using explicit reference mappings when the publisher's estimate no longer applies.
6. Edit the owned JSON or use the stream's documented authored-data builder. Keep stable IDs for existing recipes and preserve user data in IndexedDB.
7. Run `npm run validate:data`, inspect warnings and semantic differences, run tests/build, and review the affected recipe in the browser before release.

The validation report checks every bundled record and publishes the actual count, categories and protein thresholds. Schema and duplicate-signature checks cannot by themselves establish culinary distinctness, source accuracy or safety; editorial review is also required. Regenerating JSON from saved facts is repeatable; it does not constitute a fresh source verification on a later date.

## Consolidated source register

`npm run research:index` creates `research/source-register.json` from the exact canonical files, recording a SHA-256 snapshot for each file and the source dates, links and nutrition method for every recipe. It performs no network requests and never changes source-verification dates. Regenerate it after an editorial update and retain the stream reports alongside it. A matching snapshot hash ties the register to the delivered data; it does not prove the source remains unchanged online.
