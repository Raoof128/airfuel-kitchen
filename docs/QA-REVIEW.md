# Integration and security review

Reviewed 11 October 2026. Scope: local app, IndexedDB memory, catalogue boundaries, recommendations, backup import, shopping, accessibility and optional cloud code. The final execution results are in `VALIDATION.md`. This review is not a penetration test or physical cooking qualification.

## Resolved findings

| Finding | Resolution and evidence |
|---|---|
| Custom recipes could omit allergens or assert unsupported dietary claims. | Unverified custom records are excluded whenever an allergen or dietary requirement is active. Engine and browser regressions cover this conservative boundary. Direct access still allows personal use. |
| Imported canonical overrides could erase safety/allergens or add dietary claims. | Effective recipes preserve baseline allergens and safety notes, cannot lower core temperature, and intersect dietary/oil-free claims with the baseline. Malicious-import regressions cover these cases. |
| Time/temperature edits could contradict unchanged method steps. | The adjustment form requires method review when those settings change. Baseline thermometer targets remain visible. User-written directions are not culinary verification. |
| Session and tried/rating writes could partially succeed. | A single transaction commits the journal and recipe state. Failure injection proves rollback and a single successful retry. |
| Finishing a cook left its timer/checklist active. | The explicit Finished action closes only the matching activity in the same transaction. Historical edits preserve other activity. Browser coverage verifies selected servings and completion. |
| Concurrent tabs could overwrite checklist/timer fields. | Transactional field updates read the latest activity. Unit and two-tab browser checks retain simultaneous independent changes. Matching active servings also refresh the recipe view. |
| View-only records could supersede real memories during backup merge. | Viewing preserves the last explicit memory-edit timestamp. Export/reset/view/import regression restores notes while preserving genuinely newer edits. |
| Saving notes could overwrite text entered while the save was pending. | Draft revisions determine whether a completed save may clear dirty state. Newer typing remains editable and protected. |
| Repeated create submissions could make duplicate plans or items. | Synchronous ref guards and disabled pending submit buttons prevent duplicates. Browser checks repeat submissions in the same task and verify one resulting record. |
| Editing a custom title could erase imported metadata that the form does not expose. | Edits preserve unexposed fields, additional sources, fibre, substitutions, safety, and rest time. Browser coverage compares the exported record after a title-only edit. |
| Newer background operations could hide failed saves. | Errors always surface and successful/background toasts cannot replace a currently displayed failure. Pending writes trigger a browser-unload warning. |
| Shopping ticks survived changes to required quantity. | Generated ticks are tied to the saved quantity and selected week; manual item edits reset ticks. Distinct units and raw/cooked forms remain separate. |
| Tiny positive serving denominators could produce infinite scaled amounts. | Schemas bound denominators to 0.01–100 and scaling guards invalid values independently. Import regression rejects extreme values. |
| Optional cloud SQL could allow JSON null through a CHECK. | The constraint now requires the JSON ID to have string type. Static SQL assertions pass; actual database enforcement remains unqualified until live setup. |

## Other verified boundaries

- Notes and recipe prose render as text, never HTML. Hostile markup stays inert in browser tests.
- Strict versioned backup validation checks nested fields, sizes, IDs, URL schemes, dates and duplicates. Integrity-checked previews reject changed/stale data before atomic merge or replacement.
- Migration preserves old records and defaults legacy consumed servings to zero. Prepared meals, plans, recipe views and tried flags never imply food intake.
- Recommendations respect hard restrictions before scoring, cap the protein-fit benefit and encourage category variety. Scores use local rules rather than an AI API.
- Runtime recipe images, fonts and canonical data are local assets. No analytics, runtime recipe scraping or remote image tracking is required.
- Cloud unit tests cover durable retries, acknowledgement loss, receipt recovery, deterministic conflicts, tombstones, distinct journal IDs, account binding and cross-owner response rejection. They use a mock adapter.
- The registry dependency audits reported no known advisories for either the runtime-only or complete installed dependency tree. This is an advisory check, not proof that dependencies contain no defects.

## Catalogue review

Final records are subject to strict schema validation, unique IDs/titles, ingredient-proportion duplicate checks, arithmetic checks, source registration and editorial review. Additional manual scans look for obvious allergen, oil-free and thermometer inconsistencies; these cannot certify allergen absence. Composite products and substitutions still require packet checks.

An access-policy audit rejected three late plant candidates and the US SharkNinja stream. The research reports distinguish individual-page verification from unavailable policy endpoints and unresolved content-use ambiguity. No publisher images or full publisher methods are delivered as app content.

## Practical limits

Recipes and nutrition are documentary adaptations and estimates, not physical appliance or laboratory tests. Generated images represent categories. Browser accessibility automation and desktop Chromium tests do not establish physical iOS/Android or screen-reader compatibility. Cloud Auth, SQL migration, RLS and real two-device sync have not been exercised because no project was configured. Whole-record cloud conflict resolution can supersede concurrent edits. Device-only memories can be lost if storage is cleared; use the tested backup workflow.
