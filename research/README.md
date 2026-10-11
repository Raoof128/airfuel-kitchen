# AirFuel Kitchen research evidence

The canonical catalogue is `src/data/recipes-savoury.json` plus `src/data/recipes-plant.json`. Only those records appear in the app. Candidate lists, rejected sources and exploratory files here do not contribute to its count.

- `source-register.json`: generated crosswalk from every recipe to its attributed sources, check dates and nutrition method, with exact canonical file hashes. Run `npm run research:index` to refresh; this is not a new internet verification.
- `validation-report.json`: schema, count, category, arithmetic, image and duplicate-signature checks from `npm run validate:data`.
- `plant/` and `savoury/`: independently authored records, concise source facts, food-composition mappings, verification/rejection evidence and stream reports. Their reports describe regeneration.
- `expansion/`: shared discovery and factual editorial assistance. Several candidates were rejected or superseded. Their presence does not indicate acceptance.
- `runtime-dependency-audit.json`: npm audit of runtime dependencies at validation time. This checks the registry's published advisories, not every possible vulnerability.

Source verification means that an individual source was retrieved and reviewed for the stated method and quantities on its recorded date. It does not mean the recipe was physically cooked, that the source cannot change, or that nutrition was laboratory measured. Search results alone do not establish recipe verification.

Publisher prose and images are not app assets. Recipe instructions and descriptions in the catalogue are original adaptations. Temporary retrieved methods and page HTML were removed after editorial review; concise factual notes, URLs, dates and hashes remain. Generated food artwork has separate provenance in `docs/IMAGES.md`.

Access decisions are site-specific. Explicit automated-access exclusions were honoured by rejecting the affected candidates. Some public policy endpoints failed or were unavailable; evidence records distinguish that from a successful policy fetch. No authenticated, paywalled or challenged recipe content was bypassed. This is a private local build; public reuse requires reviewing the applicable source and asset terms again.
