# Recipe data, personal memory and recommendations

## Separation of data

Bundled JSON files are the canonical catalogue. `src/data/catalogue.ts` validates every record with Zod and rejects duplicate IDs during application loading. Runtime user mutations never write those files. Source URLs, source-check dates and nutrient-method evidence belong to recipe records; they do not imply the adaptation was physically kitchen-tested.

User data live in the IndexedDB database `airfuel-kitchen`, schema version 2, managed by Dexie. React subscribes with `useLiveQuery`, including changes observed from other tabs. The app needs no account or cloud connection for these features.

| Table | Key and meaning |
|---|---|
| `recipeStates` | Recipe ID; explicit tried flag/date, favourite, optional 1–5 rating, notes and last-viewed timestamp. |
| `sessions` | Stable unique session ID; recipe ID, calendar date, prepared and explicitly consumed servings, optional rating/time/settings, changes, notes and repeat preference. Multiple sessions per recipe are preserved. |
| `plans` | Unique entry ID; recipe, calendar date, meal slot and planned servings. |
| `pantry` | Unique item ID; ingredient name, form, quantity and unit. |
| `shopping` | Manual rows and saved generated-row ticks; name, form, amount, unit, aisle and checkbox. The UI scopes generated ticks to the selected week. |
| `customRecipes` | Namespaced `custom-` ID and a complete validated personal recipe. |
| `overrides` | Recipe ID and a complete validated personal adaptation, kept separate from the canonical recipe. |
| `preferences` | Singleton profile/settings: Sydney, Australian English, Ninja 6.7L with no assumed model, two servings, 30g protein target and 35-minute preference by default. All are editable. |
| `activeCooking` | Singleton active recipe, scaled servings, ingredient/step checklists and timer deadline/remaining seconds. |

Every saved record has an `updatedAt` timestamp. Recipe/preference writes merge only the supplied fields after reading current state in a transaction. Checklist operations modify one membership against the latest stored set. This avoids replacing independent fields or checkbox changes from another tab with stale React objects.

`saveCookingSession` atomically writes the journal plus tried/rating state. Its optional `completeCooking=true` also clears the matching active recipe in that transaction. Editing a prior session defaults to false and does not stop a current cook. Opening a recipe changes only its viewed timestamp; it preserves the last explicit memory-edit timestamp, or zero for a view-only record. This prevents simply opening a recipe after a reset from making blank memory beat an older backup during merge. A tried flag is not consumption evidence.

Version 1 to 2 migration preserves existing records, fills missing preference defaults and sets a legacy session's missing consumed-servings field to zero. It never infers consumption from prepared servings. Migration tests reopen a legacy database and re-export its preserved records. Changes beyond these migrations require a new explicit versioned migration; clearing IndexedDB is not an upgrade strategy.

## Validation and rendering

Schemas reject unknown object properties, unsupported enum values, invalid calendar dates, unsafe source URL schemes, malformed IDs, negative/nonfinite quantities and oversized arrays/text. Sources must be HTTPS; images must use permitted local `/images/` paths. Nutrition descriptions may contain detailed method explanations up to 3,000 characters. Nutrient values are per serving and estimates, with nullable fibre when unavailable.

Recipe/default/planned/prepared/active serving counts are bounded to 0.01–100; normal UI controls use at least 0.5. Consumed portions can be zero. Ingredient scaling independently checks both the requested servings and recipe denominator. It multiplies every quantity by requested servings divided by original recipe servings, leaving the source record intact. Larger quantities may require multiple batches, not proportional time or temperature changes.

Notes and imported text are rendered as React text or input values. The app never interprets a note as HTML or code. The import boundary uses strict nested schemas; plain text resembling a script can be stored without being executed. Rendering guarantees still depend on keeping future UI changes free of HTML injection.

Effective overrides retain baseline allergen tags and safety notes and cannot lower a required baseline internal temperature. They cannot introduce unsupported dietary claims or promote a baseline recipe to oil-free. This is deliberately conservative: removing an ingredient in a personal note does not establish a verified new dietary claim. User-authored methods still require the user's review, and safety temperatures remain separate from air-fryer settings.

## Backup and restoration

`exportBackup` serialises every user table in a consistent read transaction. The format is `airfuel-kitchen`, version 2, with an export timestamp and nine table arrays. Canonical JSON is not duplicated except within user-owned recipe/override records.

`previewImport` validates the complete document before mutation. It rejects malformed or unsupported input, duplicate IDs within a table and files above the library's 20 MiB limit. The Settings file picker currently uses a stricter 10 MiB limit. Preview counts show new IDs, matching IDs, conflicting records and existing record count. A private integrity token binds the preview to its exact validated contents and current database fingerprint.

Merge imports preserve rows absent from the backup. For a matching ID, the larger `updatedAt` wins; equal timestamps keep the local row. Replace imports clear the user tables and insert the backup in one transaction, after explicit UI confirmation. Either mode rejects if the local database changed since preview, including another tab's writes. The user must generate a fresh preview rather than unknowingly overwrite those changes.

Backups contain private notes, preferences and custom recipes and should be stored privately. They are not encrypted by this application. Clearing browser storage, private-browsing teardown or device loss can remove local data even after a persistent-storage request. Export regularly; neither a local database nor an untested cloud setup promises permanent preservation.

## Search and suggestions

Search operates entirely on the bundled/effective catalogue. It searches names, descriptions, tags and ingredient names and recognises `no oil`, `under 20 minutes` and `more than 40g protein`. “Under” and “more than” are strict comparisons; numeric filter controls use inclusive maximum/minimum values. Filters cover category, time, calories, protein, diet, allergens, difficulty, oil-free status and tried/favourite state.

Recommendations are rules, not an AI model. First they enforce allergen/dietary exclusions, oil-free preference and explicit ingredient avoids. Unverified custom records are omitted when any allergen or dietary requirement is active, even when their declared tags claim compatibility. They remain directly accessible in the user's custom collection. Ingredient avoids use case-insensitive phrase matching, not semantic food identification; use the dedicated allergen controls and check package labels.

Eligible recipes receive scores for fitting available time, meeting the protein target, novelty, favourites, personal ratings, liked categories, preferred proteins, favourite ingredients/cuisines and pantry overlap. Disliked ingredients and recently logged recipes reduce scores. A bounded time bonus favours quicker recipes within the preference. Protein-fit rewards stop at the target, so excess protein or inflated portions earn no extra bonus. Stable greedy selection subtracts ten points for each previously selected recipe in the same category, encouraging variety without overriding hard restrictions.

Modes support tonight, new, favourites, pantry, fast and surprise. Fast requires no more than 20 minutes and the user's smaller maximum if applicable. Pantry requires at least one matching positive-quantity ingredient; it does not claim the pantry contains sufficient quantities for the whole meal. Surprise adds randomness only after exclusions. Explanations report actual contributing rules; default ranking is otherwise stable.

## Nutrition and shopping semantics

Planned totals multiply recipe per-serving nutrients by planned servings. Consumed totals multiply by explicitly recorded consumed servings only. Missing recipes are counted and exposed to the UI, not silently assigned zero as if known. A tried flag, favourite, preparation count or completed checklist never adds intake. Custom ingredient changes and cooking losses are not recalculated automatically; journal totals use the effective recipe estimate and can change if that recipe's nutrient data are edited. They are not immutable historical nutrient snapshots.

Shopping aggregation keys use normalised ingredient name, explicit form and a compatible unit. Raw/cooked, fresh/dried and grams/millilitres remain separate. Teaspoons and Australian tablespoons convert to 5 ml and 20 ml respectively; there is no guessed mass–volume density conversion. Exact matching pantry quantities subtract without going below zero. Manual items remain editable. Generated purchase ticks reset when the required quantity changes, and manual ticks reset after an edited name/form/unit/quantity. Pantry amounts are not automatically consumed by a journal entry; users update them after cooking.

## Optional cloud limits

See `CLOUD.md` for the setup and protocol. Cloud support is opt-in and unconfigured here. No live Supabase authentication, migration, RLS or physical two-device tests have been executed. Local mock tests and SQL string assertions are not substitutes for those checks.

The implementation uses verified, pinned access tokens, per-account/project binding, authenticated ownership checks, a server migration with SELECT RLS and a narrowly scoped write RPC, durable IndexedDB outbox/tombstones, Lamport revision plus UUID tie-breaking, cross-tab Web Locks and recoverable write-ahead receipts. It resolves whole-record conflicts, not field-by-field concurrent editing across devices. Tombstones must be retained while older devices can return. Foreground retries require an open enabled tab; reopening requires enabling sync again. Invalid/expired authentication or network failures retain queued data.

Signing out leaves local user data and account binding. A full device-content reset clears both normal user tables and the sync cache after sign-out; it leaves remote data untouched, which can return on a later enabled sync. No end-to-end encryption is claimed. Deployment owners must run the live qualification list in `CLOUD.md` before relying on cloud protection.
