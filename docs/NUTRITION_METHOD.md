# Nutrition method

The current 300-recipe catalogue contains **182 ingredient-calculated estimates** and **118 publisher-based estimates**. There are 128 main meals with at least 25g estimated protein per serving; across all categories, 99 recipes have at least 30g, 47 have at least 40g and 15 have at least 50g.

The authoritative formula, edible-weight assumptions, Australian Food Composition Database mappings, publisher-estimate criteria, metric conversion rules and uncertainties are in [NUTRITION-AND-RESEARCH.md](NUTRITION-AND-RESEARCH.md). Recipe-level references are preserved in the [source register](../research/source-register.json) and each recipe's disclosure panel.

Calculation: sum each edible ingredient's grams × nutrient per 100g ÷ 100, then divide the batch total by the stated yield. Ingredient scaling changes the quantity prepared, not a recipe's per-serving estimate. It never scales the air-fryer temperature or automatically multiplies cook time.

The UI labels estimates and keeps planned, prepared and explicitly consumed servings separate. Tried/favourite/checklist actions do not add dietary intake. Missing fibre stays unknown. Cooking loss, discarded marinade, brands and substitutions can change actual nutrients; no laboratory precision or immutable historical nutrient snapshot is claimed.

The upgrade reran structural/arithmetic validation with zero errors or warnings and left the canonical nutrition records unchanged. See [RECIPE_PROVENANCE.md](RECIPE_PROVENANCE.md) for the matching file hashes.
